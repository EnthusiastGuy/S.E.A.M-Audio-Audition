/* =============================================================
   S.E.A.M — Pack demo video export (MP4 via WebCodecs + mp4-muxer)
   Fully offline: frames rendered to canvas → VideoEncoder → muxer,
   audio → AudioEncoder → muxer, combined into MP4.
   Post-pass: Nero-style chpl chapters in moov.udta (VLC, many players).
   No WASM, no Workers, no fetch — works on file:// and http(s).
   ============================================================= */

(function initDemoVideoExport() {
  'use strict';

  /** @type {typeof globalThis.SEAM_DEMO_VIDEO_EXPORT} */
  const DV = globalThis.SEAM_DEMO_VIDEO_EXPORT;
  if (!DV) {
    console.error('[demo-video-export] Load js/demo-video-export-helpers.js before demo-video-export.js.');
  }

  /**
   * User background: default (null), static image, or one+ videos (looped crossfade).
   * @type {null | { kind: 'image', file: Blob } | { kind: 'video', files: Blob[] }}
   */
  let demoVideoUserBackground = null;

  /** Lazily built for Preview when video background is selected; cleared on reset / change. */
  let demoVideoBgPreviewAnimator = null;
  let demoVideoBgPreviewAnimatorKey = '';

  let demoVideoPreviewOpen = false;
  let demoPreviewRenderTimer = null;
  let demoPreviewReflowListenersBound = false;

  const MP4_EXPORT_FONT_STORAGE_KEY = 'seam_mp4_export_font_css';
  const MP4_EXPORT_FONT_SIZES_STORAGE_KEY = 'seam_mp4_export_font_size_tiers';
  const MP4_EXPORT_UI_PALETTE_STORAGE_KEY = 'seam_mp4_export_ui_palette';

  /** Fixed “Basic” theme for playlist chips, waveform, playhead, series badge. */
  const DEMO_VIDEO_PALETTE_BASIC = {
    chipInactiveFill: 'rgba(45, 65, 112, 0.55)',
    chipInactiveStroke: 'rgba(255,255,255,0.12)',
    chipInactiveText: 'rgba(230, 235, 245, 0.85)',
    chipActiveFill: 'rgba(233, 69, 96, 0.95)',
    chipActiveStroke: 'rgba(255,255,255,0.35)',
    chipActiveText: '#fff',
    wfPanelFill: 'rgba(22, 33, 62, 0.9)',
    wfBorderDim: 'rgba(78, 205, 196, 0.25)',
    wfWaveBright: 'rgba(78, 205, 196, 0.85)',
    wfWaveMirror: 'rgba(255, 255, 255, 0.08)',
    wfPlayhead: 'rgba(233, 69, 96, 0.95)',
    seriesShadow: 'rgba(78, 205, 196, 0.35)',
    seriesFill: 'rgba(16, 22, 38, 0.97)',
    seriesStroke: 'rgba(78, 205, 196, 0.92)',
    seriesText: '#f4f7ff',
  };

  const DEMO_VIDEO_PALETTE_KEYS = Object.keys(DEMO_VIDEO_PALETTE_BASIC);

  /** Preview-only: frozen Auto palette for static backgrounds until file/reset changes. */
  const demoVideoPreviewAutoPaletteCache = { palette: null, videoSmooth: null };

  function invalidateDemoVideoPreviewAutoPalette() {
    demoVideoPreviewAutoPaletteCache.palette = null;
    demoVideoPreviewAutoPaletteCache.videoSmooth = null;
  }

  /** Per-zone export text scale: normal = 1; steps ±10% / ±15% cumulative from normal. */
  const MP4_FONT_SIZE_TIER_MUL = {
    smallest: 0.75,
    smaller: 0.9,
    normal: 1,
    bigger: 1.1,
    biggest: 1.25,
  };

  const MP4_FONT_SIZE_SELECT_IDS = {
    playlist: 'select-mp4-fs-playlist',
    audioTitle: 'select-mp4-fs-audio-title',
    audioDetails: 'select-mp4-fs-audio-details',
    seriesNumber: 'select-mp4-fs-series-number',
    seriesTitle: 'select-mp4-fs-series-title',
    seriesSubtitle: 'select-mp4-fs-series-subtitle',
    watermark: 'select-mp4-fs-watermark',
  };

  function defaultMp4FontSizeTiersRecord() {
    return {
      playlist: 'normal',
      audioTitle: 'normal',
      audioDetails: 'normal',
      seriesNumber: 'normal',
      seriesTitle: 'normal',
      seriesSubtitle: 'normal',
      watermark: 'normal',
    };
  }

  function mp4FontSizeTierToMul(tier) {
    return MP4_FONT_SIZE_TIER_MUL[tier] ?? 1;
  }

  function parseMp4FontSizesStorageJson(str) {
    let o;
    try {
      o = JSON.parse(str);
    } catch {
      return null;
    }
    if (!o || typeof o !== 'object') return null;
    const base = defaultMp4FontSizeTiersRecord();
    for (const k of Object.keys(MP4_FONT_SIZE_SELECT_IDS)) {
      const v = o[k];
      if (typeof v === 'string' && MP4_FONT_SIZE_TIER_MUL[v] != null) base[k] = v;
    }
    return base;
  }

  function mp4FontSizesStorageLoad() {
    const raw = mp4FontStorageGet(MP4_EXPORT_FONT_SIZES_STORAGE_KEY);
    return parseMp4FontSizesStorageJson(raw) || defaultMp4FontSizeTiersRecord();
  }

  function mp4FontSizesStorageSave(rec) {
    try {
      localStorage.setItem(MP4_EXPORT_FONT_SIZES_STORAGE_KEY, JSON.stringify(rec));
    } catch {
      /* private mode / blocked */
    }
  }

  function readMp4FontSizeTiersFromUi() {
    const rec = defaultMp4FontSizeTiersRecord();
    for (const key of Object.keys(MP4_FONT_SIZE_SELECT_IDS)) {
      const el = document.getElementById(MP4_FONT_SIZE_SELECT_IDS[key]);
      const v = el && el.value;
      if (v && MP4_FONT_SIZE_TIER_MUL[v] != null) rec[key] = v;
    }
    return rec;
  }

  function mp4FontSizeTiersToMuls(rec) {
    return {
      playlist: mp4FontSizeTierToMul(rec.playlist),
      audioTitle: mp4FontSizeTierToMul(rec.audioTitle),
      audioDetails: mp4FontSizeTierToMul(rec.audioDetails),
      seriesNumber: mp4FontSizeTierToMul(rec.seriesNumber),
      seriesTitle: mp4FontSizeTierToMul(rec.seriesTitle),
      seriesSubtitle: mp4FontSizeTierToMul(rec.seriesSubtitle),
      watermark: mp4FontSizeTierToMul(rec.watermark),
    };
  }

  function readMp4FontSizeMultipliersFromUi() {
    return mp4FontSizeTiersToMuls(readMp4FontSizeTiersFromUi());
  }

  function fillMp4FontSizeTierSelect(el) {
    if (!el || el.dataset.seamMp4FsFilled) return;
    el.dataset.seamMp4FsFilled = '1';
    const tiers = [
      ['smallest', 'Smallest (−25%)'],
      ['smaller', 'Smaller (−10%)'],
      ['normal', 'Normal'],
      ['bigger', 'Bigger (+10%)'],
      ['biggest', 'Biggest (+25%)'],
    ];
    for (const [value, label] of tiers) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      el.appendChild(opt);
    }
  }

  function initMp4ExportFontSizeControls() {
    const saved = mp4FontSizesStorageLoad();
    for (const key of Object.keys(MP4_FONT_SIZE_SELECT_IDS)) {
      const el = document.getElementById(MP4_FONT_SIZE_SELECT_IDS[key]);
      if (!el) continue;
      fillMp4FontSizeTierSelect(el);
      const v = saved[key];
      if (v && MP4_FONT_SIZE_TIER_MUL[v] != null) el.value = v;
      if (!el.dataset.seamMp4FsListen) {
        el.dataset.seamMp4FsListen = '1';
        el.addEventListener('change', () => {
          mp4FontSizesStorageSave(readMp4FontSizeTiersFromUi());
          scheduleDemoPreviewRender();
        });
      }
    }
  }

  /**
   * Bundled OFL faces: generated list in js/mp4-export-font-manifest.js (npm run vendor:mp4-fonts).
   * `value` must match @font-face font-family in css/mp4-export-fonts.css.
   */
  const MP4_EXPORT_FONTS =
    typeof window !== 'undefined' &&
    Array.isArray(window.__SEAM_MP4_EXPORT_FONTS__) &&
    window.__SEAM_MP4_EXPORT_FONTS__.length > 0
      ? window.__SEAM_MP4_EXPORT_FONTS__
      : [
          { value: 'SEAM-Export-Space-Mono', preview: 'Space Mono (fallback)' },
          { value: 'SEAM-Export-Inter', preview: 'Inter (fallback)' },
        ];

  function mp4VideoFontFamilyQuoted(cssFamily) {
    const safe = String(cssFamily || 'SEAM-Export-Space-Mono').replace(/'/g, '');
    return `'${safe}'`;
  }

  function mp4VideoFontStack(cssFamily) {
    return `${mp4VideoFontFamilyQuoted(cssFamily)}, sans-serif`;
  }

  function mp4FontStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function mp4FontStorageSet(key, v) {
    try {
      localStorage.setItem(key, String(v));
    } catch {
      /* private mode / blocked */
    }
  }

  async function ensureMp4ExportFontLoaded(cssFamily) {
    if (typeof document === 'undefined' || !document.fonts) return;
    const q = mp4VideoFontFamilyQuoted(cssFamily);
    const specs = [
      `400 11px ${q}`,
      `400 14px ${q}`,
      `400 17px ${q}`,
      `600 15px ${q}`,
      `600 39px ${q}`,
      `600 56px ${q}`,
      `700 11px ${q}`,
      `700 32px ${q}`,
      `800 34px ${q}`,
      `800 38px ${q}`,
    ];
    for (const s of specs) {
      try {
        await document.fonts.load(s);
      } catch (_) {
        /* single-weight faces still render */
      }
    }
    await document.fonts.ready;
  }

  function warmMp4ExportFontPreviews() {
    if (typeof document === 'undefined' || !document.fonts) return;
    void (async () => {
      for (const f of MP4_EXPORT_FONTS) {
        try {
          await document.fonts.load(`15px ${mp4VideoFontFamilyQuoted(f.value)}`);
        } catch (_) {
          /* ignore */
        }
      }
    })();
  }

  const FMT = 'wav';
  const CANVAS_W = 1920;
  const CANVAS_H = 1080;
  const PEAK_BINS = 540;
  const MAX_FPS = 24;
  const VIDEO_BITRATE = 8_000_000;
  const AUDIO_BITRATE = 192_000;
  /** Main profile, level 4.0 — required for 1920×1080 (level 3.1 caps below 1080p). */
  const VIDEO_CODEC_STR = 'avc1.4d4028';
  const AUDIO_CODEC_STR = 'mp4a.40.2';
  /** Scale UI from original 1280-wide layout so text/chips stay readable at 1080p. */
  const VIDEO_UI_SCALE = CANVAS_W / 1280;
  /** Extra horizontal room for the series number pill (wide fonts / multi-digit labels). */
  const SERIES_BADGE_WIDTH_MULT = 1.15;
  const DEFAULT_MP4_CORNER_CREDIT = 'EnthusiastGuy';

  /** @returns {{ text: string, year: number|null }} */
  function readMp4CornerCreditFromUi() {
    const input = document.getElementById('input-demo-video-corner-credit');
    const yearCb = document.getElementById('checkbox-demo-video-credit-year');
    const raw = typeof input?.value === 'string' ? input.value : '';
    const text = raw.trim() || DEFAULT_MP4_CORNER_CREDIT;
    const includeYear = yearCb ? !!yearCb.checked : true;
    return { text, year: includeYear ? new Date().getFullYear() : null };
  }
  /** Hold wallpaper + pack hero; music starts after this (2–3 s from export seed). */
  const INTRO_TRANS_SEC = 1.25;
  const OUTRO_FADE_SEC = 1;
  /** Crossfade when looping video background(s); capped per clip duration. */
  const BG_VIDEO_CROSSFADE_SEC = 1;
  const BG_VIDEO_BITMAP_ALPHA = 0.62;
  /** Auto UI palette when following video: exponential blend toward measured colors (~1 s time constant). */
  const VIDEO_PALETTE_INERTIA_TAU_SEC = 1;
  /** After music: hero flies back to center (matches intro motion, reversed). */
  const OUTRO_FLYBACK_SEC = 3;

  /* ── tiny helpers ────────────────────────────────────────── */

  function easeInOutCubic(t) {
    const x = Math.min(1, Math.max(0, t));
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }

  function smoothstep01(x) {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Deterministic intro hold in [2, 3) seconds from pack hash. */
  function introHoldSecFromSeed(seedU32) {
    return 2 + ((seedU32 >>> 0) % 1000) / 1000;
  }

  function vendorUrl(rel) {
    return new URL(rel, document.baseURI).href;
  }

  function hashStr(s) {
    let h = 2166136261 >>> 0;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function rnd() {
      let t = (seed += 0x6d2b79f5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fmtMinSec(secs) {
    if (!isFinite(secs) || secs < 0) secs = 0;
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /** Pack total duration for footer subtitle (hours when needed). */
  function fmtPackTotalDuration(secs) {
    if (!isFinite(secs) || secs < 0) secs = 0;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const sec = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  /** Line for under pack title: compositions, parts, total time (current playlist order). */
  function buildPackExportStatsLine() {
    const fmt = FMT;
    const order = STATE.order?.[fmt] || [];
    const songs = STATE.songs?.[fmt] || [];
    let partTotal = 0;
    let durTotal = 0;
    for (const idx of order) {
      const song = songs[idx];
      if (!song) continue;
      partTotal += song.parts?.length || 0;
      durTotal += Number(song.duration) || 0;
    }
    const n = order.length;
    const cWord = n === 1 ? 'composition' : 'compositions';
    const pWord = partTotal === 1 ? 'segment' : 'segments';
    return `${n} total audio ${cWord}, ${partTotal} total audio ${pWord}, ${fmtPackTotalDuration(durTotal)} total audio time`;
  }

  /** YouTube clickable chapters: first line must be 0:00; use M:SS or H:MM:SS. */
  function formatYoutubeChapterTimestamp(sec) {
    const s = Math.max(0, Math.floor(sec + 1e-6));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  /** True if the folder name already starts with an index like "1. ", "12) ", "3.Song". */
  function titleAlreadyHasLeadingIndex(name) {
    const s = String(name || '').trim();
    if (/^\d{1,4}[\.)]\s/.test(s)) return true;
    if (/^\d{1,4}[\.)]\S/.test(s)) return true;
    if (/^\d{1,4}\s*[-–—]\s/.test(s)) return true;
    return false;
  }

  function playlistChipLabel(orderOneBased, rawTitle) {
    const t = String(rawTitle || '').trim();
    if (titleAlreadyHasLeadingIndex(t)) return t;
    return `${orderOneBased}. ${t}`;
  }

  function buildYoutubeDescription(plans, totalDurationSec, introLeadInSec, musicDurSec) {
    const lead = Math.max(0, introLeadInSec || 0);
    const lines = [
      'YouTube chapter links (paste into the video description). The first line should start at 0:00.',
      '',
    ];
    lines.push(`${formatYoutubeChapterTimestamp(0)} Intro`);
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      const ts = formatYoutubeChapterTimestamp(lead + p.tStartSec);
      lines.push(`${ts} ${p.title}`);
    }
    const md = isFinite(musicDurSec) && musicDurSec > 0 ? musicDurSec : 0;
    if (md > 0) {
      lines.push(`${formatYoutubeChapterTimestamp(lead + md)} Closing`);
    }
    lines.push('');
    if (isFinite(totalDurationSec) && totalDurationSec > 0) {
      lines.push(`Total demo length: ${fmtMinSec(totalDurationSec)}`);
    }
    return lines.join('\n');
  }

  function triggerDownload(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  /**
   * Parse root folder names like "2301. Dark whimsy & Alchemy" or "12) Pack title".
   * @returns {{ seriesNum: string|null, packTitle: string, raw: string }}
   */
  function parsePackFolderName(rootName) {
    const raw = String(rootName || '').trim();
    if (!raw) return { seriesNum: null, packTitle: '', raw: '' };
    const dot = raw.match(/^\s*(\d{1,6})\s*[\.)]\s+(.+)$/);
    if (dot) return { seriesNum: dot[1], packTitle: dot[2].trim(), raw };
    const paren = raw.match(/^\s*(\d{1,6})\s*\)\s+(.+)$/);
    if (paren) return { seriesNum: paren[1], packTitle: paren[2].trim(), raw };
    const dash = raw.match(/^\s*(\d{1,6})\s*[-–—]\s+(.+)$/);
    if (dash) return { seriesNum: dash[1], packTitle: dash[2].trim(), raw };
    return { seriesNum: null, packTitle: raw, raw };
  }

  /** Draw centered lines (y = top of first line); returns y below last line. */
  function wrapTextCentered(ctx, text, centerX, y, maxW, lineH) {
    ctx.textBaseline = 'top';
    const words = String(text || '').split(/\s+/).filter(Boolean);
    let line = '';
    let yy = y;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        const w = ctx.measureText(line).width;
        ctx.fillText(line, centerX - w / 2, yy);
        line = words[i];
        yy += lineH;
      } else {
        line = test;
      }
    }
    if (line) {
      const w = ctx.measureText(line).width;
      ctx.fillText(line, centerX - w / 2, yy);
      yy += lineH;
    }
    return yy;
  }

  /** Draw wrapped left-aligned text (y = top of first line); returns y below last line. */
  function wrapTextReturnBottom(ctx, text, x, y, maxW, lineH) {
    ctx.textBaseline = 'top';
    const words = String(text || '').split(/\s+/).filter(Boolean);
    let line = '';
    let yy = y;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = words[i];
        yy += lineH;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, x, yy);
      yy += lineH;
    }
    return yy;
  }

  function readDemoVideoUiPaletteMode() {
    const el = document.getElementById('select-demo-video-ui-palette');
    const v = el && el.value;
    return v === 'basic' ? 'basic' : 'auto';
  }

  function clamp255(x) {
    return Math.max(0, Math.min(255, Math.round(x)));
  }

  function srgbChannelToLinear(c) {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }

  function relLum01(rgb) {
    const r = srgbChannelToLinear(rgb[0]);
    const g = srgbChannelToLinear(rgb[1]);
    const b = srgbChannelToLinear(rgb[2]);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        default:
          h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  function hslToRgb(h, s, l) {
    h = ((((h % 360) + 360) % 360) / 360);
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    let r;
    let g;
    let b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function rgbaStr(rgb, a) {
    return `rgba(${clamp255(rgb[0])},${clamp255(rgb[1])},${clamp255(rgb[2])},${a})`;
  }

  function parseCssColorToRgba(str) {
    const s = String(str || '').trim();
    if (s.startsWith('#')) {
      let h = s.slice(1);
      if (h.length === 3) {
        return [
          parseInt(h[0] + h[0], 16),
          parseInt(h[1] + h[1], 16),
          parseInt(h[2] + h[2], 16),
          1,
        ];
      }
      if (h.length === 6) {
        return [
          parseInt(h.slice(0, 2), 16),
          parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16),
          1,
        ];
      }
      if (h.length === 8) {
        return [
          parseInt(h.slice(0, 2), 16),
          parseInt(h.slice(2, 4), 16),
          parseInt(h.slice(4, 6), 16),
          parseInt(h.slice(6, 8), 16) / 255,
        ];
      }
    }
    const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (m) {
      const al = m[4] != null ? parseFloat(m[4]) : 1;
      return [+m[1], +m[2], +m[3], Number.isFinite(al) ? al : 1];
    }
    return [255, 255, 255, 1];
  }

  function paletteStringsToComponents(pal) {
    const o = {};
    for (const k of DEMO_VIDEO_PALETTE_KEYS) {
      o[k] = parseCssColorToRgba(pal[k]);
    }
    return o;
  }

  function formatPaletteChannel(x) {
    return clamp255(Math.round(x));
  }

  function paletteComponentsToStrings(comp) {
    const o = {};
    for (const k of DEMO_VIDEO_PALETTE_KEYS) {
      const [r, g, b, a] = comp[k];
      const rr = formatPaletteChannel(r);
      const gg = formatPaletteChannel(g);
      const bb = formatPaletteChannel(b);
      const aa = Math.max(0, Math.min(1, a));
      if (aa >= 0.998) o[k] = `rgb(${rr},${gg},${bb})`;
      else o[k] = `rgba(${rr},${gg},${bb},${+aa.toFixed(3)})`;
    }
    return o;
  }

  function lerpPaletteComponents(from, to, t) {
    const u = Math.max(0, Math.min(1, t));
    const o = {};
    for (const k of DEMO_VIDEO_PALETTE_KEYS) {
      const a = from[k];
      const b = to[k];
      o[k] = [
        a[0] + (b[0] - a[0]) * u,
        a[1] + (b[1] - a[1]) * u,
        a[2] + (b[2] - a[2]) * u,
        a[3] + (b[3] - a[3]) * u,
      ];
    }
    return o;
  }

  /**
   * @param {{ palette: object|null, videoSmooth?: { smoothed: object|null, lastT: number|null } }} cache
   */
  function smoothVideoAutoPaletteInertia(cache, tVideo, targetPal) {
    const tgtComp = paletteStringsToComponents(targetPal);
    if (!cache.videoSmooth) {
      cache.videoSmooth = { smoothed: null, lastT: null };
    }
    const vs = cache.videoSmooth;
    let dt = 1 / 30;
    if (vs.lastT != null) {
      if (tVideo + 1e-4 < vs.lastT) {
        vs.smoothed = null;
        vs.lastT = null;
      } else {
        dt = Math.min(0.35, tVideo - vs.lastT);
      }
    }
    if (vs.smoothed == null) {
      vs.smoothed = tgtComp;
      vs.lastT = tVideo;
      return paletteComponentsToStrings(vs.smoothed);
    }
    const alpha = 1 - Math.exp(-dt / VIDEO_PALETTE_INERTIA_TAU_SEC);
    vs.smoothed = lerpPaletteComponents(vs.smoothed, tgtComp, alpha);
    vs.lastT = tVideo;
    return paletteComponentsToStrings(vs.smoothed);
  }

  /** Darken sRGB until white text meets ~4.5:1 on solid fill (quick iterative). */
  function darkenForWhiteText(rgb, maxLum = 0.2) {
    let r = rgb[0];
    let g = rgb[1];
    let b = rgb[2];
    for (let i = 0; i < 28 && relLum01([r, g, b]) > maxLum; i++) {
      r *= 0.87;
      g *= 0.87;
      b *= 0.87;
    }
    return [clamp255(r), clamp255(g), clamp255(b)];
  }

  function kMeansRgb(imageData, k, steps) {
    const data = imageData.data;
    const n = (data.length / 4) | 0;
    const centroids = [];
    for (let i = 0; i < k; i++) {
      const o = (((((i + 0.5) / k) * n) | 0) * 4) % data.length;
      centroids.push([data[o], data[o + 1], data[o + 2]]);
    }
    const sums = new Float64Array(k * 3);
    const counts = new Int32Array(k);
    const assign = new Int32Array(n);
    for (let step = 0; step < steps; step++) {
      sums.fill(0);
      counts.fill(0);
      for (let p = 0; p < n; p++) {
        const o = p * 4;
        const r = data[o];
        const g = data[o + 1];
        const b = data[o + 2];
        let best = 0;
        let bestD = 1e18;
        for (let c = 0; c < k; c++) {
          const cr = centroids[c][0];
          const cg = centroids[c][1];
          const cb = centroids[c][2];
          const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        assign[p] = best;
        sums[best * 3] += r;
        sums[best * 3 + 1] += g;
        sums[best * 3 + 2] += b;
        counts[best]++;
      }
      for (let c = 0; c < k; c++) {
        if (counts[c] < 1) continue;
        centroids[c][0] = sums[c * 3] / counts[c];
        centroids[c][1] = sums[c * 3 + 1] / counts[c];
        centroids[c][2] = sums[c * 3 + 2] / counts[c];
      }
    }
    counts.fill(0);
    for (let p = 0; p < n; p++) counts[assign[p]]++;
    return centroids.map((rgb, i) => ({
      rgb: [clamp255(rgb[0]), clamp255(rgb[1]), clamp255(rgb[2])],
      w: counts[i],
    }));
  }

  function buildAutoUiPaletteFromImageData(imageData) {
    const clusters = kMeansRgb(imageData, 6, 10).filter((c) => c.w > 0);
    clusters.sort((a, b) => b.w - a.w);
    if (clusters.length === 0) return { ...DEMO_VIDEO_PALETTE_BASIC };

    const meta = clusters.map((c) => {
      const hsl = rgbToHsl(c.rgb[0], c.rgb[1], c.rgb[2]);
      return { ...c, hsl, L: relLum01(c.rgb) };
    });

    const chromaScore = (m) => {
      const [, s, l] = m.hsl;
      if (l < 6 || l > 97) return -1;
      return s * Math.sqrt(m.w + 1);
    };

    let warmIdx = 0;
    let best = -1;
    for (let i = 0; i < meta.length; i++) {
      const sc = chromaScore(meta[i]);
      if (sc > best) {
        best = sc;
        warmIdx = i;
      }
    }

    const warmM = meta[warmIdx];
    let [h, s, l] = warmM.hsl;
    s = Math.min(100, (s || 18) * 1.12 + 10);
    l = Math.min(60, Math.max(36, l || 48));
    let accentWarm = hslToRgb(h, s, l);
    if ((warmM.hsl[1] || 0) < 14) {
      accentWarm = hslToRgb(warmM.hsl[0], 58, 46);
    }
    accentWarm = darkenForWhiteText(accentWarm, 0.2);

    const hWarm = warmM.hsl[0];
    let accentCool = null;
    for (const m of meta) {
      if (m === warmM) continue;
      let dh = Math.abs(m.hsl[0] - hWarm);
      if (dh > 180) dh = 360 - dh;
      if (dh > 26 && m.hsl[1] > 14) {
        let [h2, s2, l2] = m.hsl;
        s2 = Math.min(90, s2 + 12);
        l2 = Math.min(56, Math.max(40, l2));
        accentCool = hslToRgb(h2, s2, l2);
        break;
      }
    }
    if (!accentCool) {
      accentCool = hslToRgb((hWarm + 172) % 360, Math.min(82, Math.max(48, s)), 50);
    }

    const darkest = meta.reduce((a, b) => (a.L <= b.L ? a : b));
    const panelRgb = [
      darkest.rgb[0] * 0.32 + 18 * 0.68,
      darkest.rgb[1] * 0.32 + 24 * 0.68,
      darkest.rgb[2] * 0.32 + 44 * 0.68,
    ];
    const chipInRgb = [
      accentCool[0] * 0.45 + 32 * 0.55,
      accentCool[1] * 0.45 + 42 * 0.55,
      accentCool[2] * 0.45 + 74 * 0.55,
    ];

    return {
      chipInactiveFill: rgbaStr(chipInRgb, 0.55),
      chipInactiveStroke: 'rgba(255,255,255,0.14)',
      chipInactiveText: 'rgba(236, 240, 250, 0.9)',
      chipActiveFill: rgbaStr(accentWarm, 0.95),
      chipActiveStroke: 'rgba(255,255,255,0.36)',
      chipActiveText: '#fff',
      wfPanelFill: rgbaStr(panelRgb, 0.9),
      wfBorderDim: rgbaStr(accentCool, 0.28),
      wfWaveBright: rgbaStr(accentCool, 0.86),
      wfWaveMirror: 'rgba(255, 255, 255, 0.09)',
      wfPlayhead: rgbaStr(accentWarm, 0.95),
      seriesShadow: rgbaStr(accentCool, 0.36),
      seriesFill: rgbaStr(panelRgb, 0.97),
      seriesStroke: rgbaStr(accentCool, 0.9),
      seriesText: '#f4f8ff',
    };
  }

  function extractAutoPaletteFromSourceCanvas(sourceCanvas, sw, sh) {
    const tw = 80;
    const th = 45;
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return { ...DEMO_VIDEO_PALETTE_BASIC };
    x.drawImage(sourceCanvas, 0, 0, sw, sh, 0, 0, tw, th);
    let id;
    try {
      id = x.getImageData(0, 0, tw, th);
    } catch {
      return { ...DEMO_VIDEO_PALETTE_BASIC };
    }
    return buildAutoUiPaletteFromImageData(id);
  }

  function drawSeriesNumberBadge(ctx, x, y, w, h, seriesNum, s, fontScale, fontFace, seriesNumberSizeMul = 1, pal = null) {
    const theme = pal || DEMO_VIDEO_PALETTE_BASIC;
    const fs = Math.max(0.5, fontScale);
    const snm = Math.max(0.35, seriesNumberSizeMul);
    const stack = mp4VideoFontStack(fontFace);
    const r = Math.max(8, Math.round(10 * s * fs));
    ctx.save();
    ctx.shadowColor = theme.seriesShadow;
    ctx.shadowBlur = Math.round(14 * s * fs);
    ctx.shadowOffsetY = Math.round(2 * s * fs);
    ctx.fillStyle = theme.seriesFill;
    drawRoundedRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = theme.seriesStroke;
    ctx.lineWidth = Math.max(2, Math.round(2 * s * fs));
    drawRoundedRect(ctx, x, y, w, h, r);
    ctx.stroke();

    ctx.fillStyle = theme.seriesText;
    ctx.font = `800 ${Math.max(24, Math.round(36 * s * fs * snm))}px ${stack}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(seriesNum), x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /* ── progress bar ───────────────────────────────────────── */

  function showProgress(pct, label) {
    const wrap = document.getElementById('app-loading-progress-wrap');
    const bar = document.getElementById('app-loading-progress-bar');
    const pctEl = document.getElementById('app-loading-progress-pct');
    if (wrap) {
      wrap.classList.remove('hidden');
      wrap.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct)).toFixed(1)}%`;
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
    if (label) setAppLoadingLabel(label);
  }

  function hideProgress() {
    const wrap = document.getElementById('app-loading-progress-wrap');
    const bar = document.getElementById('app-loading-progress-bar');
    const pctEl = document.getElementById('app-loading-progress-pct');
    if (wrap) {
      wrap.classList.add('hidden');
      wrap.setAttribute('aria-valuenow', '0');
    }
    if (bar) bar.style.width = '0%';
    if (pctEl) pctEl.textContent = '';
  }

  /* ── audio helpers ──────────────────────────────────────── */

  function sliceAudioBuffer(buffer, t0, t1) {
    const rate = buffer.sampleRate;
    const c0 = Math.max(0, Math.min(buffer.length, Math.floor(t0 * rate)));
    const c1 = Math.max(c0, Math.min(buffer.length, Math.ceil(t1 * rate)));
    const len = c1 - c0;
    if (len <= 0) return null;
    const ch = buffer.numberOfChannels;
    const out = AC.createBuffer(ch, len, rate);
    for (let c = 0; c < ch; c++) {
      const src = buffer.getChannelData(c).subarray(c0, c1);
      out.copyToChannel(src, c);
    }
    return out;
  }

  function computePeaks(buffer, bins) {
    const ch0 = buffer.getChannelData(0);
    const n = ch0.length;
    const out = new Float32Array(bins);
    const step = n / bins;
    for (let b = 0; b < bins; b++) {
      const i0 = Math.floor(b * step);
      const i1 = Math.floor((b + 1) * step);
      let m = 0;
      for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(ch0[i]));
      out[b] = m;
    }
    let peak = 0;
    for (let b = 0; b < bins; b++) peak = Math.max(peak, out[b]);
    if (peak < 1e-8) peak = 1;
    for (let b = 0; b < bins; b++) out[b] /= peak;
    return out;
  }

  function mixCrossfaded(excerptBuffers, fadeSec) {
    const n = excerptBuffers.length;
    if (n === 0) return null;
    const rate = excerptBuffers[0].sampleRate;
    const ch = Math.max(...excerptBuffers.map(b => b.numberOfChannels), 1);
    const lengths = excerptBuffers.map(b => b.length);
    let fadeSamps = Math.round(fadeSec * rate);
    fadeSamps = Math.max(256, fadeSamps);
    for (let i = 0; i < n - 1; i++) {
      fadeSamps = Math.min(
        fadeSamps,
        Math.floor(lengths[i] / 2) - 1,
        Math.floor(lengths[i + 1] / 2) - 1,
      );
    }
    fadeSamps = Math.max(64, fadeSamps);

    const offsets = new Array(n);
    let o = 0;
    for (let i = 0; i < n; i++) {
      offsets[i] = o;
      o += lengths[i] - (i < n - 1 ? fadeSamps : 0);
    }
    const totalFrames = o;

    const out = AC.createBuffer(ch, totalFrames, rate);
    for (let c = 0; c < ch; c++) {
      const od = out.getChannelData(c);
      od.fill(0);
      for (let i = 0; i < n; i++) {
        const eb = excerptBuffers[i];
        const cd = eb.getChannelData(Math.min(c, eb.numberOfChannels - 1));
        const len = cd.length;
        const off = offsets[i];
        for (let j = 0; j < len; j++) {
          let w = 1;
          if (i > 0 && j < fadeSamps) w *= j / fadeSamps;
          if (i < n - 1 && j >= len - fadeSamps) w *= (len - 1 - j) / fadeSamps;
          od[off + j] += cd[j] * w;
        }
      }
    }
    return { buffer: out, offsets, fadeSamps, rate };
  }

  async function getSongCompositeBuffer(fmt, songIdx) {
    const song = STATE.songs[fmt]?.[songIdx];
    if (!song) return null;
    ensurePlayerState(fmt, songIdx);
    await preloadSong(fmt, songIdx);
    let buf = await buildPreviewBuffer(fmt, songIdx, { skipDurationCap: true, exportOnly: true });
    if (buf) return buf;

    const ps = STATE.players[`${fmt}_${songIdx}`];
    if (!ps) return null;
    const used = ps.sequence.map(item => ps.buffers[item.partIndex]).filter(Boolean);
    if (used.length === 0) return null;

    const channels = used.reduce((max, b) => Math.max(max, b.numberOfChannels), 1);
    const sampleRate = AC.sampleRate;
    let totalDur = 0;
    for (const b of used) totalDur += b.duration;
    const frameCount = Math.max(1, Math.ceil(totalDur * sampleRate));
    const offline = new OfflineAudioContext(channels, frameCount, sampleRate);
    let offset = 0;
    for (const b of used) {
      const src = offline.createBufferSource();
      src.buffer = b;
      src.connect(offline.destination);
      src.start(offset);
      offset += b.duration;
    }
    return offline.startRendering();
  }

  function pickExcerpt(buffer, rnd) {
    const L = buffer.duration;
    const inner0 = L * 0.1;
    const inner1 = L * 0.9;
    const usable = inner1 - inner0;
    if (usable < 2) return null;
    let clipLen = 20 + rnd() * 10;
    clipLen = Math.min(clipLen, usable);
    if (clipLen < 1.5) return null;
    const startMax = inner1 - clipLen;
    const t0 = inner0 + rnd() * Math.max(1e-6, startMax - inner0);
    const t1 = t0 + clipLen;
    return { t0, t1, clipLen };
  }

  function fadeSecondsFromState() {
    const cf = Number(STATE.crossfade);
    if (!isFinite(cf) || cf <= 0) return 2;
    return Math.min(6, Math.max(0.75, cf));
  }

  /* ── canvas drawing ─────────────────────────────────────── */

  function drawRoundedRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  /** Path length for the same geometry as `drawRoundedRect` (4 quarter-arcs + straights). */
  function roundedRectPerimeterLen(w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    return 2 * (w + h - 4 * rad) + 2 * Math.PI * rad;
  }

  /**
   * Traveling “shiny” highlight on the active playlist chip border (preview + MP4 export).
   * Short segment, soft falloff along the arc, faster orbit.
   * @param {number} tAbs wall-clock seconds along the video timeline
   * @param {number} uiScale stroke scale (~ playlist UI scale)
   */
  function strokeActivePlaylistChipShine(ctx, x, y, w, h, r, tAbs, uiScale) {
    const perim = roundedRectPerimeterLen(w, h, r);
    if (!(perim > 1)) return;
    const u = Math.max(1, uiScale);
    const dashLen = Math.max(11 * u, Math.min(perim * 0.12, 46 * u));
    const speed = 68;
    const off = ((tAbs * speed) % perim + perim) % perim;
    const n = 9;
    const sliceLen = dashLen / n;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      const edge = Math.sin(t * Math.PI);
      const edge2 = edge * edge;
      if (edge2 < 0.002) continue;

      const sliceStart = off + j * sliceLen;
      const os = ((sliceStart % perim) + perim) % perim;

      drawRoundedRect(ctx, x, y, w, h, r);
      ctx.setLineDash([sliceLen, perim - sliceLen]);
      ctx.lineDashOffset = -os;

      ctx.shadowColor = `rgba(255, 255, 255, ${0.72 * edge2})`;
      ctx.shadowBlur = Math.round(4.5 * u * edge2);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineWidth = Math.max(3.2, u * 2.05);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.48 * edge2})`;
      ctx.stroke();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1.65, u * 1.08);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.94 * edge2})`;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawFallbackVideoBackground(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#1b2240');
    g.addColorStop(0.45, '#0d1117');
    g.addColorStop(1, '#122040');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function effectiveBgVideoCrossfadeSec(requested, durations) {
    const n = durations.length;
    if (n < 1) return requested;
    const minD = Math.min(...durations);
    if (!(minD > 0) || !Number.isFinite(minD)) return Math.min(requested, 0.5);
    if (n === 1) {
      return Math.min(requested, Math.max(0.12, minD * 0.35));
    }
    return Math.min(requested, Math.max(0.15, minD * 0.38));
  }

  /**
   * Map wall-clock t to one clip or a crossfade pair (looping).
   * @param {number[]} durations clip lengths in seconds
   */
  function sampleBgVideoTimeline(tAbs, durations, fade) {
    const n = durations.length;
    if (n < 1) return { blend: false, i: 0, t: 0 };
    if (n === 1) {
      const D = Math.max(1e-3, durations[0]);
      const f = Math.min(fade, D * 0.48);
      const L = D;
      let u = tAbs % L;
      if (u < 0) u += L;
      if (u <= D - f - 1e-9) {
        return { blend: false, i: 0, t: Math.min(u, D - 1e-4) };
      }
      const a = (u - (D - f)) / f;
      return {
        blend: true,
        out: { i: 0, t: Math.min(u, D - 1e-4) },
        inn: { i: 0, t: Math.min(Math.max(0, u - (D - f)), D - 1e-4) },
        a: Math.min(1, Math.max(0, a)),
      };
    }
    const sumD = durations.reduce((a, b) => a + b, 0);
    const L = sumD - n * fade;
    const loopLen = Math.max(1e-3, L);
    let u = tAbs % loopLen;
    if (u < 0) u += loopLen;

    if (u < fade) {
      const a = u / fade;
      return {
        blend: true,
        out: {
          i: n - 1,
          t: Math.min(Math.max(0, durations[n - 1] - fade + u), durations[n - 1] - 1e-4),
        },
        inn: { i: 0, t: Math.min(Math.max(0, u), durations[0] - 1e-4) },
        a: Math.min(1, Math.max(0, a)),
      };
    }
    u -= fade;
    for (let i = 0; i < n; i++) {
      const soloLen = Math.max(0, durations[i] - 2 * fade);
      if (u < soloLen) {
        const localT = fade + u;
        return { blend: false, i, t: Math.min(localT, durations[i] - 1e-4) };
      }
      u -= soloLen;
      if (u < fade) {
        const next = (i + 1) % n;
        return {
          blend: true,
          out: { i, t: Math.min(Math.max(0, durations[i] - fade + u), durations[i] - 1e-4) },
          inn: { i: next, t: Math.min(Math.max(0, u), durations[next] - 1e-4) },
          a: Math.min(1, Math.max(0, u / fade)),
        };
      }
      u -= fade;
    }
    return { blend: false, i: 0, t: 0 };
  }

  function seekVideoForExport(video, tSec) {
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return Promise.resolve();
    const eps = 1 / 60;
    const tt = Math.min(Math.max(0, tSec), Math.max(0, d - eps));
    if (Math.abs((video.currentTime || 0) - tt) < 0.001) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done);
        video.removeEventListener('error', onErr);
        resolve();
      };
      const onErr = () => {
        video.removeEventListener('seeked', done);
        video.removeEventListener('error', onErr);
        resolve();
      };
      video.addEventListener('seeked', done, { once: true });
      video.addEventListener('error', onErr, { once: true });
      try {
        video.pause();
        video.currentTime = tt;
      } catch {
        resolve();
      }
    });
  }

  function drawVideoCover(ctx, W, H, video, alpha) {
    const iw = video.videoWidth;
    const ih = video.videoHeight;
    if (!iw || !ih) return;
    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(video, dx, dy, dw, dh);
    ctx.restore();
  }

  async function createDemoVideoBgAnimator(fileBlobs) {
    const blobs = [...fileBlobs].filter(b => b && (b.size ?? 0) > 0);
    if (blobs.length === 0) throw new Error('No video files to use as background.');
    const entries = [];
    for (const blob of blobs) {
      const url = URL.createObjectURL(blob);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.preload = 'auto';
      video.src = url;
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => {
          reject(new Error('Video metadata load timed out'));
        }, 120000);
        const ok = () => {
          clearTimeout(to);
          resolve();
        };
        const bad = () => {
          clearTimeout(to);
          reject(new Error('Could not decode a background video file'));
        };
        if (video.readyState >= 1) {
          clearTimeout(to);
          resolve();
        } else {
          video.addEventListener('loadedmetadata', ok, { once: true });
          video.addEventListener('error', bad, { once: true });
        }
      });
      const duration =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0.25;
      entries.push({ video, url, duration });
    }
    const durations = entries.map(e => e.duration);
    const fade = effectiveBgVideoCrossfadeSec(BG_VIDEO_CROSSFADE_SEC, durations);

    return {
      entries,
      durations,
      fade,
      async draw(ctx, W, H, tVideo) {
        const sample = sampleBgVideoTimeline(tVideo, durations, fade);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (!sample.blend) {
          const e = entries[sample.i];
          await seekVideoForExport(e.video, sample.t);
          drawVideoCover(ctx, W, H, e.video, BG_VIDEO_BITMAP_ALPHA);
        } else if (sample.out.i === sample.inn.i) {
          const e = entries[sample.out.i];
          await seekVideoForExport(e.video, sample.out.t);
          const snap = document.createElement('canvas');
          snap.width = W;
          snap.height = H;
          const sctx = snap.getContext('2d');
          if (sctx) {
            sctx.imageSmoothingEnabled = true;
            sctx.imageSmoothingQuality = 'high';
            drawVideoCover(sctx, W, H, e.video, 1);
          }
          await seekVideoForExport(e.video, sample.inn.t);
          if (sctx) {
            ctx.globalAlpha = BG_VIDEO_BITMAP_ALPHA * (1 - sample.a);
            ctx.drawImage(snap, 0, 0, W, H);
          }
          drawVideoCover(ctx, W, H, e.video, BG_VIDEO_BITMAP_ALPHA * sample.a);
        } else {
          const outE = entries[sample.out.i];
          const innE = entries[sample.inn.i];
          await seekVideoForExport(outE.video, sample.out.t);
          drawVideoCover(ctx, W, H, outE.video, BG_VIDEO_BITMAP_ALPHA * (1 - sample.a));
          await seekVideoForExport(innE.video, sample.inn.t);
          drawVideoCover(ctx, W, H, innE.video, BG_VIDEO_BITMAP_ALPHA * sample.a);
        }
        ctx.restore();
      },
      dispose() {
        for (const e of entries) {
          try {
            e.video.removeAttribute('src');
            e.video.load();
          } catch {
            /* ignore */
          }
          URL.revokeObjectURL(e.url);
        }
      },
    };
  }

  function disposeDemoVideoBgPreviewAnimator() {
    demoVideoBgPreviewAnimator?.dispose();
    demoVideoBgPreviewAnimator = null;
    demoVideoBgPreviewAnimatorKey = '';
  }

  function demoVideoBgPreviewKeyFromState() {
    if (!demoVideoUserBackground || demoVideoUserBackground.kind !== 'video') return '';
    return demoVideoUserBackground.files
      .map((f) => `${f.name || 'video'}:${f.size ?? 0}:${f.lastModified ?? 0}`)
      .join('|');
  }

  async function getOrCreateDemoVideoBgPreviewAnimator() {
    const key = demoVideoBgPreviewKeyFromState();
    if (!key) return null;
    if (demoVideoBgPreviewAnimatorKey === key && demoVideoBgPreviewAnimator) {
      return demoVideoBgPreviewAnimator;
    }
    disposeDemoVideoBgPreviewAnimator();
    demoVideoBgPreviewAnimatorKey = key;
    demoVideoBgPreviewAnimator = await createDemoVideoBgAnimator(demoVideoUserBackground.files);
    return demoVideoBgPreviewAnimator;
  }

  /**
   * VideoFrame rejects canvases that drew from "tainted" sources (e.g. <img> from
   * file:// or cross-origin without CORS). Only draw backgrounds from fetch→Blob→
   * ImageBitmap (same-origin http(s)), or use the gradient fallback.
   */
  /**
   * @param {object} timeline introHoldSec, introTransSec, musicDurSec, outroFadeSec, outroFlySec
   * @param {{ text: string, year: number|null }} cornerCredit bottom-right label; year appended when non-null
   * @param {object} [fontSizeMuls] per-zone multipliers (1 = default); from readMp4FontSizeMultipliersFromUi()
   * @param {null|{ draw: function, dispose: function }} [videoBgAnimator] looping video background from createDemoVideoBgAnimator
   * @param {'basic'|'auto'} [uiPaletteMode]
   * @param {{ palette: object|null }} [autoPaletteCache] frozen Auto palette for static bg (not used when videoBgAnimator set)
   */
  async function drawFrame(
    ctx,
    tVideo,
    plans,
    currentIdx,
    totalPieces,
    bgBitmap,
    rawTitles,
    packMeta,
    cornerCredit,
    timeline,
    fontFace,
    packStatsLine,
    fontSizeMuls,
    videoBgAnimator,
    uiPaletteMode,
    autoPaletteCache,
  ) {
    if (!DV) throw new Error('SEAM_DEMO_VIDEO_EXPORT missing (demo-video-export-helpers.js)');
    const W = CANVAS_W;
    const H = CANVAS_H;
    const stack = mp4VideoFontStack(fontFace);
    const {
      introHoldSec,
      introTransSec,
      musicDurSec,
      outroFadeSec,
      outroFlySec: timelineOutroFly = 0,
    } = timeline;

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    if (videoBgAnimator) {
      await videoBgAnimator.draw(ctx, W, H, tVideo);
    } else if (bgBitmap) {
      const iw = bgBitmap.width;
      const ih = bgBitmap.height;
      const scale = Math.max(W / iw, H / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (W - dw) / 2;
      const dy = (H - dh) / 2;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = BG_VIDEO_BITMAP_ALPHA;
      ctx.drawImage(bgBitmap, dx, dy, dw, dh);
      ctx.restore();
    } else {
      drawFallbackVideoBackground(ctx, W, H);
    }

    const mode = uiPaletteMode === 'basic' ? 'basic' : 'auto';
    let uiPal = DEMO_VIDEO_PALETTE_BASIC;
    const cache = autoPaletteCache || { palette: null, videoSmooth: null };
    if (mode === 'auto') {
      if (videoBgAnimator) {
        const measured = extractAutoPaletteFromSourceCanvas(ctx.canvas, W, H);
        uiPal = smoothVideoAutoPaletteInertia(cache, tVideo, measured);
      } else {
        cache.videoSmooth = null;
        if (!cache.palette) {
          cache.palette = extractAutoPaletteFromSourceCanvas(ctx.canvas, W, H);
        }
        uiPal = cache.palette;
      }
    }

    ctx.fillStyle = 'rgba(8, 12, 22, 0.48)';
    ctx.fillRect(0, 0, W, H);

    const s = VIDEO_UI_SCALE;
    const fsm = fontSizeMuls || mp4FontSizeTiersToMuls(defaultMp4FontSizeTiersRecord());
    const pl = Math.max(0.35, fsm.playlist);
    const at = Math.max(0.35, fsm.audioTitle);
    const ad = Math.max(0.35, fsm.audioDetails);
    const sn = Math.max(0.35, fsm.seriesNumber);
    const st = Math.max(0.35, fsm.seriesTitle);
    const ss = Math.max(0.35, fsm.seriesSubtitle);
    const wm = Math.max(0.35, fsm.watermark);

    const pad = Math.round(40 * s);
    const chipStrip = DV.resolvePlaylistChipStrip(
      ctx,
      rawTitles,
      currentIdx,
      W,
      pad,
      playlistChipLabel,
      s,
      stack,
      pl,
      DV.MAX_PLAYLIST_ROWS,
    );
    const { items: playlistItems, chipH, chipGap, topInset, chipPad, chipXGap } = chipStrip;
    const playlistRowCap = DV.playlistBandHeightCap(topInset, chipH, chipGap);
    const playlistH = DV.resolvePlaylistBandHeight(chipStrip.bandHeightFromPad, topInset, chipH, chipGap, s);
    const gapBase = Math.round(24 * s);
    const gapFloor = Math.round(14 * s);
    const oneRowBandFloor = topInset + chipH + Math.round(6 * s);
    const extraPlaylist = Math.max(0, playlistH - oneRowBandFloor);
    const gapBelowPlaylist = Math.max(gapFloor, Math.round(gapBase - extraPlaylist * 0.22));

    const seriesNum = packMeta && packMeta.seriesNum;
    const packLine = (packMeta && (packMeta.packTitle || packMeta.raw)) || '';
    const footerStatsExtra = packLine && packStatsLine ? 52 : 0;
    const slackSix = Math.max(0, playlistRowCap - playlistH);
    const footerBand = Math.round(
      ((seriesNum && packLine ? 268 : packLine ? 212 : seriesNum ? 132 : 68) + footerStatsExtra) * s +
        slackSix * 0.35,
    );
    const blockTop = pad + playlistH + gapBelowPlaylist;
    const blockH = H - blockTop - pad - footerBand;
    const titleW = Math.round(W * 0.38);
    const waveX = pad + titleW + Math.round(20 * s);
    const waveW = W - waveX - pad;
    const waveY = blockTop;
    const waveCapPx = Math.round((200 + Math.min(95, slackSix * 0.12)) * s);
    const waveAvail = Math.max(0, blockH - Math.round(40 * s));
    const waveH = Math.min(waveCapPx, waveAvail);

    const titleX = pad;
    const titleMaxW = Math.max(
      Math.round(120 * s),
      waveX - titleX - Math.round(16 * s),
    );

    const transEnd = introHoldSec + introTransSec;
    const musicEndT = introHoldSec + musicDurSec;
    const outroFlySec = Number(timelineOutroFly) > 0 ? Number(timelineOutroFly) : 0;

    let layoutBlend = 1;
    if (tVideo < introHoldSec) layoutBlend = 0;
    else if (tVideo < transEnd) layoutBlend = easeInOutCubic((tVideo - introHoldSec) / introTransSec);
    else if (outroFlySec > 0 && tVideo >= musicEndT) {
      layoutBlend = 1 - easeInOutCubic(Math.min(1, (tVideo - musicEndT) / outroFlySec));
    }

    let mainUiAlpha = 1;
    if (tVideo < introHoldSec) mainUiAlpha = 0;
    else if (tVideo < transEnd) mainUiAlpha = easeInOutCubic((tVideo - introHoldSec) / introTransSec);
    else if (outroFlySec > 0 && tVideo >= musicEndT) {
      mainUiAlpha = 1 - easeInOutCubic(Math.min(1, (tVideo - musicEndT) / outroFlySec));
    }

    const tMix = Math.min(Math.max(tVideo - introHoldSec, 0), Math.max(1e-9, musicDurSec));

    ctx.save();
    ctx.globalAlpha = mainUiAlpha;
    ctx.font = `600 ${Math.round(15 * s * pl)}px ${stack}`;
    ctx.textBaseline = 'middle';

    let x = pad;
    let y = pad + topInset;
    const chipR = Math.max(4, Math.round(6 * s * pl));
    const ellText = DV.ELLIPSIS_CHIP_TEXT;
    playlistItems.forEach((item) => {
      let label;
      let tw;
      if (item.kind === 'ellipsis') {
        label = ellText;
        const w = ctx.measureText(label).width + chipPad * 2;
        tw = Math.max(Math.round(34 * pl), Math.min(w, W - pad * 2));
      } else {
        label = playlistChipLabel(item.index + 1, rawTitles[item.index]);
        tw = Math.min(ctx.measureText(label).width + chipPad * 2, W - pad * 2);
      }
      if (x + tw > W - pad) {
        x = pad;
        y += chipH + chipGap;
      }
      if (y > pad + playlistH) return;
      const active = item.kind === 'song' && item.index === currentIdx;
      const isEllipsis = item.kind === 'ellipsis';
      if (isEllipsis) ctx.save();
      if (isEllipsis) ctx.globalAlpha *= 0.58;
      ctx.fillStyle = active ? uiPal.chipActiveFill : uiPal.chipInactiveFill;
      drawRoundedRect(ctx, x, y, tw, chipH, chipR);
      ctx.fill();
      ctx.strokeStyle = active ? uiPal.chipActiveStroke : uiPal.chipInactiveStroke;
      ctx.lineWidth = Math.max(1, s);
      ctx.stroke();
      if (active) {
        strokeActivePlaylistChipShine(ctx, x, y, tw, chipH, chipR, tVideo, Math.max(1, s * pl));
      }
      ctx.fillStyle = active ? uiPal.chipActiveText : uiPal.chipInactiveText;
      ctx.fillText(label, x + chipPad, y + chipH / 2);
      if (isEllipsis) ctx.restore();
      x += tw + chipXGap;
    });

    const plan = plans[currentIdx];
    if (plan) {
      const rawName = plan.title;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.font = `700 ${Math.round(32 * s * at)}px ${stack}`;
      const titleLineH = Math.round(38 * s * at);
      const titleTop = blockTop + Math.round(18 * s);
      const afterTitle = wrapTextReturnBottom(ctx, rawName, titleX, titleTop, titleMaxW, titleLineH);

      ctx.fillStyle = 'rgba(200, 210, 230, 0.78)';
      ctx.font = `400 ${Math.round(14 * s * ad)}px ${stack}`;
      ctx.textBaseline = 'top';
      const metaY = afterTitle + Math.round(14 * s * ad);
      const detailLineH = Math.round(22 * s * ad);
      const detailRowGap = Math.round(10 * s * ad);
      const colGap = Math.round(14 * s * ad);
      const colW = Math.max(Math.round(108 * s), (titleMaxW - colGap) / 2);
      const metaRightX = titleX + colW + colGap;
      const row2Y = metaY + detailLineH + detailRowGap;
      ctx.fillText(`Full track ${fmtMinSec(plan.fullDurationSec)}`, titleX, metaY);
      ctx.fillText(`Audio segments: ${plan.partCount}`, metaRightX, metaY);
      ctx.fillText(`Demo audio ${currentIdx + 1} of ${totalPieces}`, titleX, row2Y);
      ctx.fillText(DV.formatFlacSizeDetailLine(plan.totalSourceBytes), metaRightX, row2Y);

      drawWaveform(ctx, plan.peaks, waveX, waveY, waveW, waveH, plan.localT(tMix), uiPal);
    }
    ctx.restore();

    const creditReserve = Math.round(38 * s * Math.max(1, wm));
    const footerTop = H - footerBand;
    const finalFootY0 = footerTop + Math.round(12 * s);
    const finalBadgeW = Math.round(132 * SERIES_BADGE_WIDTH_MULT * s);
    const finalBadgeH = Math.round(88 * s);
    const finalBadgeX = (W - finalBadgeW) / 2;
    const finalBadgeY = finalFootY0;
    let finalTitleTop = finalFootY0;
    if (seriesNum) finalTitleTop = finalBadgeY + finalBadgeH + Math.round(14 * s);

    const introBadgeW = Math.round(158 * SERIES_BADGE_WIDTH_MULT * s);
    const introBadgeH = Math.round(104 * s);
    const introBadgeX = (W - introBadgeW) / 2;
    const introBadgeY = Math.round(H * 0.3);
    const introTitleY0 = seriesNum ? introBadgeY + introBadgeH + Math.round(22 * s) : Math.round(H * 0.38);
    const introPackFont = Math.round(56 * s * st);
    const introPackLineH = Math.round(64 * s * st);
    const finalPackFont = Math.round(39 * s * st);
    const finalPackLineH = Math.round(47 * s * st);

    const badgeW = seriesNum ? lerp(introBadgeW, finalBadgeW, layoutBlend) : 0;
    const badgeH = seriesNum ? lerp(introBadgeH, finalBadgeH, layoutBlend) : 0;
    const badgeX = seriesNum ? lerp(introBadgeX, finalBadgeX, layoutBlend) : 0;
    const badgeY = seriesNum ? lerp(introBadgeY, finalBadgeY, layoutBlend) : 0;
    const badgeFontScale = seriesNum ? lerp(1.12, 1, layoutBlend) : 1;
    const packFontPx = Math.round(lerp(introPackFont, finalPackFont, layoutBlend));
    const packLineH = Math.round(lerp(introPackLineH, finalPackLineH, layoutBlend));
    const titleTopLerp = lerp(introTitleY0, finalTitleTop, layoutBlend);

    if (seriesNum) {
      drawSeriesNumberBadge(ctx, badgeX, badgeY, badgeW, badgeH, seriesNum, s, badgeFontScale, fontFace, sn, uiPal);
    }

    if (packLine) {
      ctx.font = `600 ${packFontPx}px ${stack}`;
      ctx.fillStyle = 'rgba(225, 232, 245, 0.62)';
      ctx.textBaseline = 'top';
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        pad * 2,
        titleTopLerp,
        W - pad * 4,
        Math.max(0, H - creditReserve - titleTopLerp - Math.round(4 * s)),
      );
      ctx.clip();
      const afterPackTitle = wrapTextCentered(ctx, packLine, W / 2, titleTopLerp, W - pad * 4, packLineH);
      if (packStatsLine) {
        const subTop = afterPackTitle + Math.round(12 * s * ss);
        ctx.font = `400 ${Math.round(17 * s * ss)}px ${stack}`;
        ctx.fillStyle = 'rgba(168, 186, 214, 0.72)';
        const subLineH = Math.round(22 * s * ss);
        wrapTextCentered(ctx, packStatsLine, W / 2, subTop, W - pad * 4, subLineH);
      }
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = mainUiAlpha;
    ctx.font = `400 ${Math.round(11 * s * wm)}px ${stack}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    const creditParts = [];
    if (cornerCredit && cornerCredit.text) creditParts.push(String(cornerCredit.text));
    if (cornerCredit && cornerCredit.year != null) creditParts.push(String(cornerCredit.year));
    const creditLine = creditParts.join(' ');
    if (creditLine) {
      ctx.fillText(creditLine, W - pad, H - Math.round(14 * s * wm));
    }
    ctx.textAlign = 'left';
    ctx.restore();

    const tMusic = tVideo - introHoldSec;
    const fadeDur = Math.min(outroFadeSec, musicDurSec > 1e-6 ? musicDurSec : outroFadeSec);
    const fadeStart = Math.max(0, musicDurSec - fadeDur);
    let blackA = 0;
    if (musicDurSec > 0 && tMusic >= fadeStart && tMusic < musicDurSec) {
      blackA = easeInOutCubic((tMusic - fadeStart) / fadeDur) * 0.45;
    }
    if (blackA > 0) {
      ctx.fillStyle = `rgba(0,0,0,${blackA})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawWaveform(ctx, peaks, x, y, w, h, progress01, pal = null) {
    const theme = pal || DEMO_VIDEO_PALETTE_BASIC;
    const n = peaks.length;
    if (n <= 0) return;
    const s = VIDEO_UI_SCALE;
    const wr = Math.max(6, Math.round(10 * s));
    const vm = Math.max(2, Math.round(4 * s));
    ctx.fillStyle = theme.wfPanelFill;
    drawRoundedRect(ctx, x, y, w, h, wr);
    ctx.fill();
    ctx.strokeStyle = theme.wfBorderDim;
    ctx.lineWidth = Math.max(1, s);
    ctx.stroke();

    const mid = y + h / 2;
    const amp = h * 0.42;
    ctx.strokeStyle = theme.wfWaveBright;
    ctx.lineWidth = Math.max(1, Math.round(1.25 * s));
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x + (i / (n - 1)) * w;
      const py = mid - peaks[i] * amp;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.strokeStyle = theme.wfWaveMirror;
    ctx.lineWidth = Math.max(1, s);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x + (i / (n - 1)) * w;
      const py = mid + peaks[i] * amp;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    const playX = x + progress01 * w;
    ctx.strokeStyle = theme.wfPlayhead;
    ctx.lineWidth = Math.max(2, Math.round(2 * s));
    ctx.beginPath();
    ctx.moveTo(playX, y + vm);
    ctx.lineTo(playX, y + h - vm);
    ctx.stroke();
  }

  function currentPlanIndex(tSec, plans) {
    let idx = 0;
    for (let i = 0; i < plans.length; i++) {
      if (tSec + 1e-4 >= plans[i].tStartSec) idx = i;
    }
    return idx;
  }

  function getDemoPreviewTitles() {
    const fmt = FMT;
    const order = STATE.order?.[fmt] || [];
    const songs = STATE.songs?.[fmt] || [];
    if (!order.length) {
      return ['Stellar Drift', 'Moon Unit', 'Analog Heart', 'Echo Chamber', 'Night Shift'];
    }
    return order.map((idx) => songs[idx]?.name || `Song ${idx + 1}`);
  }

  function buildDemoPreviewMockPlans(rawTitles) {
    const n = rawTitles.length;
    const excerptLen = 22;
    const fadeBetween = 2;
    const peaks = new Float32Array(PEAK_BINS);
    for (let i = 0; i < PEAK_BINS; i++) {
      peaks[i] = 0.18 + 0.82 * Math.abs(Math.sin((i / PEAK_BINS) * Math.PI * 5) * Math.cos(i / 23));
    }
    let off = 0;
    return rawTitles.map((title, i) => {
      const tStartSec = off;
      off += excerptLen - (i < n - 1 ? fadeBetween : 0);
      return {
        title,
        tStartSec,
        fullDurationSec: 240 + i * 35,
        partCount: 4 + (i % 5),
        totalSourceBytes: Math.round((2.1 + i * 0.27) * 1024 * 1024),
        excerptLenSec: excerptLen,
        peaks,
        localT(globalMixSec) {
          const local = globalMixSec - tStartSec;
          return Math.min(1, Math.max(0, local / excerptLen));
        },
      };
    });
  }

  function positionDemoVideoPreviewPopover() {
    const main = document.getElementById('main-content-area');
    const pop = document.getElementById('demo-video-preview-popover');
    const dialog = pop?.querySelector('.demo-video-preview-dialog');
    if (!main || !pop || !dialog || pop.hidden) return;
    const r = main.getBoundingClientRect();
    const edge = 10;
    const horizPad = 22;
    const headBlock = 44;
    const vertPad = 26;
    const ar = CANVAS_H / CANVAS_W;
    const previewUiScale = 0.8;
    const targetW = (CANVAS_W + horizPad) * previewUiScale;
    const vwCap = (window.innerWidth - 24) * previewUiScale;
    let maxW = Math.min(
      vwCap,
      Math.max(240, r.width - edge * 2),
      targetW,
    );
    maxW = Math.max(320, maxW);
    let canvasDispW = maxW - horizPad;
    let totalH = headBlock + vertPad + canvasDispW * ar;
    const maxH = window.innerHeight - edge * 2;
    if (totalH > maxH) {
      const maxCanvasH = Math.max(120, maxH - headBlock - vertPad);
      const maxCanvasW = maxCanvasH / ar;
      maxW = Math.max(320, Math.min(maxW, maxCanvasW + horizPad));
    }
    dialog.style.boxSizing = 'border-box';
    dialog.style.width = `${Math.round(maxW)}px`;
    const rect = dialog.getBoundingClientRect();
    let left = r.left + (r.width - rect.width) / 2;
    let top = r.top + (r.height - rect.height) / 2;
    left = Math.max(edge, Math.min(left, window.innerWidth - rect.width - edge));
    top = Math.max(edge, Math.min(top, window.innerHeight - rect.height - edge));
    dialog.style.left = `${Math.round(left)}px`;
    dialog.style.top = `${Math.round(top)}px`;
  }

  function scheduleDemoPreviewRender() {
    if (!demoVideoPreviewOpen) return;
    clearTimeout(demoPreviewRenderTimer);
    demoPreviewRenderTimer = setTimeout(() => {
      void renderDemoVideoPreviewFrame();
    }, 100);
  }

  async function renderDemoVideoPreviewFrame() {
    const canvas = document.getElementById('demo-video-preview-canvas');
    const pop = document.getElementById('demo-video-preview-popover');
    if (!canvas || !pop || pop.hidden || !demoVideoPreviewOpen) return;
    const fontSel = document.getElementById('select-demo-video-font');
    let fontFace = fontSel && fontSel.value;
    if (!fontFace || !MP4_EXPORT_FONTS.some(f => f.value === fontFace)) {
      fontFace = 'SEAM-Export-Space-Mono';
    }
    try {
      await ensureMp4ExportFontLoaded(fontFace);
    } catch (_) {
      /* ignore */
    }
    let bg = null;
    let videoBgAnimator = null;
    try {
      if (demoVideoUserBackground && demoVideoUserBackground.kind === 'video') {
        videoBgAnimator = await getOrCreateDemoVideoBgPreviewAnimator();
      } else {
        disposeDemoVideoBgPreviewAnimator();
        bg = await loadExportSafeBackgroundBitmap();
      }
    } catch (e) {
      console.warn('[demo-video-export] Preview background', e);
      disposeDemoVideoBgPreviewAnimator();
      invalidateDemoVideoPreviewAutoPalette();
      bg = await loadExportSafeBackgroundBitmap();
    }
    const rawTitles = getDemoPreviewTitles();
    const plans = buildDemoPreviewMockPlans(rawTitles);
    let musicTail = 0;
    for (const p of plans) musicTail = Math.max(musicTail, p.tStartSec + 45);
    const musicDurSec = Math.max(120, musicTail + 24);
    const introHoldSec = 2.5;
    const timeline = {
      introHoldSec,
      introTransSec: INTRO_TRANS_SEC,
      musicDurSec,
      outroFadeSec: OUTRO_FADE_SEC,
      outroFlySec: OUTRO_FLYBACK_SEC,
    };
    const afterIntro = introHoldSec + INTRO_TRANS_SEC;
    const tVideo = afterIntro + Math.min(52, musicDurSec * 0.3);
    const tMix = tVideo - introHoldSec;
    const currentIdx = currentPlanIndex(tMix, plans);
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_W;
    offscreen.height = CANVAS_H;
    const octx = offscreen.getContext('2d', { willReadFrequently: readDemoVideoUiPaletteMode() === 'auto' });
    if (!octx) return;
    const packMeta = parsePackFolderName(STATE.rootDir?.name);
    let packStatsLine = '';
    try {
      packStatsLine = buildPackExportStatsLine();
    } catch (_) {
      packStatsLine = '';
    }
    await drawFrame(
      octx,
      tVideo,
      plans,
      currentIdx,
      plans.length,
      bg,
      rawTitles,
      packMeta,
      readMp4CornerCreditFromUi(),
      timeline,
      fontFace,
      packStatsLine,
      readMp4FontSizeMultipliersFromUi(),
      videoBgAnimator,
      readDemoVideoUiPaletteMode(),
      demoVideoPreviewAutoPaletteCache,
    );
    const ctx2 = canvas.getContext('2d');
    if (!ctx2) return;
    ctx2.imageSmoothingEnabled = true;
    ctx2.imageSmoothingQuality = 'high';
    ctx2.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    positionDemoVideoPreviewPopover();
  }

  /* ── background image (must not taint canvas for VideoFrame) ─ */
  /* 1) User-picked file (page UI) 2) fetched JPG 3) embedded data URL (file:// fallback). */

  async function bitmapFromDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      if (!blob || blob.size === 0) return null;
      return await createImageBitmap(blob);
    } catch (_) {
      return null;
    }
  }

  async function loadExportSafeBackgroundBitmap() {
    if (typeof createImageBitmap !== 'function') return null;

    if (demoVideoUserBackground && demoVideoUserBackground.kind === 'image') {
      const f = demoVideoUserBackground.file;
      if (f && f.size > 0) {
        try {
          const bmp = await createImageBitmap(f);
          if (bmp) return bmp;
        } catch (e) {
          console.warn('[demo-video-export] Could not decode user background image', e);
        }
      }
    }

    const embedded =
      typeof globalThis.SEAM_VIDEO_BG_DATA_URL === 'string'
        ? globalThis.SEAM_VIDEO_BG_DATA_URL
        : '';

    const base = vendorUrl('img/video_background.jpg');
    const busted = `${base}${base.includes('?') ? '&' : '?'}seam_bg=${Date.now()}`;
    try {
      const res = await fetch(busted, { cache: 'no-store' });
      if (res.ok) {
        const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
        const buf = await res.arrayBuffer();
        if (buf && buf.byteLength > 0) {
          const mime = ct && ct !== 'application/octet-stream' ? ct : 'image/jpeg';
          const blob = new Blob([buf], { type: mime });
          const bmp = await createImageBitmap(blob);
          if (bmp) return bmp;
        }
      }
    } catch (_) {
      /* fall through to embed */
    }

    return bitmapFromDataUrl(embedded);
  }

  /* ── WebCodecs capability check ─────────────────────────── */

  async function checkWebCodecsSupport() {
    if (typeof VideoEncoder === 'undefined')
      throw new Error('VideoEncoder is not available. Use Chrome/Edge 94+ for video export.');
    if (typeof AudioEncoder === 'undefined')
      throw new Error('AudioEncoder is not available. Use Chrome/Edge 94+ for video export.');

    const vidCheck = await VideoEncoder.isConfigSupported({
      codec: VIDEO_CODEC_STR,
      width: CANVAS_W,
      height: CANVAS_H,
      bitrate: VIDEO_BITRATE,
    });
    if (!vidCheck.supported)
      throw new Error(`H.264 encoding (${VIDEO_CODEC_STR}) is not supported by this browser.`);

    const audCheck = await AudioEncoder.isConfigSupported({
      codec: AUDIO_CODEC_STR,
      numberOfChannels: 2,
      sampleRate: 44100,
      bitrate: AUDIO_BITRATE,
    });
    if (!audCheck.supported)
      throw new Error(`AAC encoding (${AUDIO_CODEC_STR}) is not supported by this browser.`);
  }

  /* ── MP4 chapter metadata (Nero chpl in moov > udta) ─────── */

  function mp4ReadU32BE(u8, o) {
    return (
      (u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]
    ) >>> 0;
  }

  function mp4WriteU32BE(u8, o, v) {
    u8[o] = (v >>> 24) & 255;
    u8[o + 1] = (v >>> 16) & 255;
    u8[o + 2] = (v >>> 8) & 255;
    u8[o + 3] = v & 255;
  }

  function mp4ReadFourCC(u8, o) {
    return String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  }

  const MP4_BOX_CONTAINERS = new Set([
    'moov',
    'trak',
    'mdia',
    'minf',
    'stbl',
    'dinf',
    'edts',
    'tref',
    'udta',
    'mvex',
  ]);

  function mp4FindTopLevelBox(u8, type) {
    let p = 0;
    while (p + 8 <= u8.length) {
      const sz = mp4ReadU32BE(u8, p);
      if (sz < 8) return null;
      if (p + sz > u8.length) return null;
      if (mp4ReadFourCC(u8, p + 4) === type) return { offset: p, size: sz };
      p += sz;
    }
    return null;
  }

  /** Add delta to every chunk offset in stco/co64 under [moovStart, moovEnd). */
  function mp4PatchChunkOffsetsInMoov(u8, moovStart, moovEnd, delta) {
    function walk(boxStart, boxEnd) {
      let p = boxStart + 8;
      while (p + 8 <= boxEnd) {
        const sz = mp4ReadU32BE(u8, p);
        if (sz < 8 || p + sz > boxEnd) break;
        const typ = mp4ReadFourCC(u8, p + 4);
        if (typ === 'stco' && sz >= 16) {
          const n = mp4ReadU32BE(u8, p + 12);
          let o = p + 16;
          for (let i = 0; i < n && o + 4 <= p + sz; i++) {
            mp4WriteU32BE(u8, o, mp4ReadU32BE(u8, o) + delta);
            o += 4;
          }
        } else if (typ === 'co64' && sz >= 16) {
          const n = mp4ReadU32BE(u8, p + 12);
          let o = p + 16;
          for (let i = 0; i < n && o + 8 <= p + sz; i++) {
            const hi = BigInt(mp4ReadU32BE(u8, o));
            const lo = BigInt(mp4ReadU32BE(u8, o + 4));
            let val = (hi << 32n) | lo;
            val += BigInt(delta);
            mp4WriteU32BE(u8, o, Number((val >> 32n) & 0xffffffffn));
            mp4WriteU32BE(u8, o + 4, Number(val & 0xffffffffn));
            o += 8;
          }
        } else if (MP4_BOX_CONTAINERS.has(typ)) {
          walk(p, p + sz);
        }
        p += sz;
      }
    }
    walk(moovStart, moovEnd);
  }

  /**
   * Build moov > udta > chpl (Nero-style, FFmpeg-compatible).
   * Inner layout matches libavformat mov_read_chpl: version 0, flags, uint8 count,
   * then per chapter uint64 start (100ns), uint8 title len, UTF-8 title.
   * @param {{ startSec: number, title: string }[]} chapters
   */
  function buildUdtaChplBox(chapters) {
    const enc = new TextEncoder();
    const body = [];
    body.push(0, 0, 0, 0);
    let list = chapters;
    if (list.length > 255) list = list.slice(0, 255);
    body.push(list.length);
    for (const ch of list) {
      let t = BigInt(Math.round(Math.max(0, ch.startSec) * 1e7));
      for (let b = 7; b >= 0; b--) {
        body.push(Number((t >> BigInt(b * 8)) & 0xffn));
      }
      let titleBytes = enc.encode(String(ch.title || '').trim());
      if (titleBytes.length > 255) titleBytes = titleBytes.slice(0, 255);
      body.push(titleBytes.length);
      for (let i = 0; i < titleBytes.length; i++) body.push(titleBytes[i]);
    }
    const inner = new Uint8Array(body);
    const chplSize = 8 + inner.byteLength;
    const udtaSize = 8 + chplSize;
    const out = new Uint8Array(udtaSize);
    mp4WriteU32BE(out, 0, udtaSize);
    out[4] = 0x75;
    out[5] = 0x64;
    out[6] = 0x74;
    out[7] = 0x61;
    mp4WriteU32BE(out, 8, chplSize);
    out[12] = 0x63;
    out[13] = 0x68;
    out[14] = 0x70;
    out[15] = 0x6c;
    out.set(inner, 16);
    return out;
  }

  /**
   * Append udta+chpl inside moov (before following top-level box), fix stco/co64.
   */
  function injectNeroChaptersIntoMp4(arrayBuffer, chapters) {
    if (!chapters || chapters.length === 0) return arrayBuffer;
    const src = new Uint8Array(arrayBuffer);
    const moov = mp4FindTopLevelBox(src, 'moov');
    if (!moov) return arrayBuffer;
    const insertAt = moov.offset + moov.size;
    if (insertAt > src.length) return arrayBuffer;
    const udta = buildUdtaChplBox(chapters);
    const delta = udta.byteLength;
    const out = new Uint8Array(src.length + delta);
    out.set(src.subarray(0, insertAt));
    out.set(udta, insertAt);
    out.set(src.subarray(insertAt), insertAt + delta);
    const newMoovSize = moov.size + delta;
    mp4WriteU32BE(out, moov.offset, newMoovSize);
    mp4PatchChunkOffsetsInMoov(out, moov.offset, moov.offset + newMoovSize, delta);
    return out.buffer.slice(0, out.length);
  }

  /* ── offline MP4 render via WebCodecs + mp4-muxer ───────── */

  function chooseFps(durationSec) {
    if (durationSec > 600) return 10;
    if (durationSec > 300) return 16;
    return MAX_FPS;
  }

  function audioGainAtVideoTime(tVideo, timeline) {
    const { introHoldSec, introTransSec, musicDurSec, outroFadeSec } = timeline;
    const t = tVideo - introHoldSec;
    if (t <= 0) return 0;
    if (t >= musicDurSec) return 0;
    let g = 1;
    if (t < introTransSec) g *= smoothstep01(t / introTransSec);
    const fadeDur = Math.min(outroFadeSec, musicDurSec > 1e-6 ? musicDurSec : outroFadeSec);
    const fadeStart = Math.max(0, musicDurSec - fadeDur);
    if (musicDurSec > 0 && t > fadeStart) {
      g *= 1 - smoothstep01(Math.min(1, (t - fadeStart) / fadeDur));
    }
    return g;
  }

  async function renderMp4Offline(
    mixedBuffer,
    plans,
    rawTitles,
    bgBitmap,
    videoBgAnimator,
    introHoldSec,
    fontFace,
    packStatsLine,
    cornerCredit,
    fontSizeMuls,
  ) {
    const musicDurSec = mixedBuffer.duration;
    const totalVideoSec = introHoldSec + musicDurSec + OUTRO_FLYBACK_SEC;
    const fps = chooseFps(totalVideoSec);
    const totalVideoFrames = Math.max(1, Math.ceil(totalVideoSec * fps));
    const totalPieces = plans.length;
    const packMeta = parsePackFolderName(STATE.rootDir?.name);

    const timeline = {
      introHoldSec,
      introTransSec: INTRO_TRANS_SEC,
      musicDurSec,
      outroFadeSec: OUTRO_FADE_SEC,
      outroFlySec: OUTRO_FLYBACK_SEC,
    };

    const audioChannels = Math.min(2, mixedBuffer.numberOfChannels);
    const audioRate = mixedBuffer.sampleRate;
    const mixLen = mixedBuffer.length;
    const mixChCount = mixedBuffer.numberOfChannels;

    const { Muxer, ArrayBufferTarget } = Mp4Muxer;
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width: CANVAS_W,
        height: CANVAS_H,
        frameRate: fps,
      },
      audio: {
        codec: 'aac',
        numberOfChannels: audioChannels,
        sampleRate: audioRate,
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    let videoError = null;
    let audioError = null;

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { videoError = e; },
    });
    videoEncoder.configure({
      codec: VIDEO_CODEC_STR,
      width: CANVAS_W,
      height: CANVAS_H,
      bitrate: VIDEO_BITRATE,
      framerate: fps,
    });

    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { audioError = e; },
    });
    audioEncoder.configure({
      codec: AUDIO_CODEC_STR,
      numberOfChannels: audioChannels,
      sampleRate: audioRate,
      bitrate: AUDIO_BITRATE,
    });

    /* ---- Phase 1: Encode video frames ---- */
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const uiPaletteMode = readDemoVideoUiPaletteMode();
    const autoPalExportCache = { palette: null };
    const ctx = canvas.getContext('2d', { willReadFrequently: uiPaletteMode === 'auto' });
    const keyInterval = Math.max(1, fps * 2);
    const renderStart = performance.now();

    for (let f = 0; f < totalVideoFrames; f++) {
      if (videoError) throw new Error(`Video encoder error: ${videoError.message || videoError}`);

      const tVideo = f / fps;
      const tMix = Math.min(Math.max(tVideo - introHoldSec, 0), musicDurSec);
      const idx = currentPlanIndex(tMix, plans);
      await drawFrame(
        ctx,
        tVideo,
        plans,
        idx,
        totalPieces,
        bgBitmap,
        rawTitles,
        packMeta,
        cornerCredit,
        timeline,
        fontFace,
        packStatsLine,
        fontSizeMuls,
        videoBgAnimator,
        uiPaletteMode,
        autoPalExportCache,
      );

      const vf = new VideoFrame(canvas, { timestamp: Math.round(tVideo * 1e6) });
      videoEncoder.encode(vf, { keyFrame: f % keyInterval === 0 });
      vf.close();

      while (videoEncoder.encodeQueueSize > 8) {
        await new Promise(r => setTimeout(r, 1));
      }

      if (f % 4 === 0 || f === totalVideoFrames - 1) {
        const done = f + 1;
        const pct = 5 + (done / totalVideoFrames) * 55;
        const elapsed = (performance.now() - renderStart) / 1000;
        const perFrame = elapsed / done;
        const remaining = Math.max(0, (totalVideoFrames - done) * perFrame);
        const eta = remaining < 60
          ? `~${Math.ceil(remaining)}s left`
          : `~${Math.floor(remaining / 60)}m ${Math.ceil(remaining % 60)}s left`;
        showProgress(pct, `Encoding video… ${done} / ${totalVideoFrames}  (${eta})`);
      }

      if (f % 12 === 0) await new Promise(r => setTimeout(r, 0));
    }

    showProgress(62, 'Flushing video encoder…');
    await videoEncoder.flush();
    videoEncoder.close();
    if (videoError) throw new Error(`Video encoder error: ${videoError.message || videoError}`);

    /* ---- Phase 2: Encode audio (intro silence, shaped mix, tail silence) ---- */
    showProgress(65, 'Encoding audio…');
    const audioChunkSize = 8192;
    const totalAudioSamples = Math.ceil(totalVideoSec * audioRate);
    let audioSamplesDone = 0;

    for (let offset = 0; offset < totalAudioSamples; offset += audioChunkSize) {
      if (audioError) throw new Error(`Audio encoder error: ${audioError.message || audioError}`);

      const length = Math.min(audioChunkSize, totalAudioSamples - offset);
      const timestamp = Math.round((offset / audioRate) * 1e6);

      const planar = new Float32Array(length * audioChannels);
      for (let frame = 0; frame < length; frame++) {
        const globalIdx = offset + frame;
        const tVideo = globalIdx / audioRate;
        const gain = audioGainAtVideoTime(tVideo, timeline);
        const tMix = tVideo - introHoldSec;
        for (let ch = 0; ch < audioChannels; ch++) {
          let v = 0;
          if (gain > 0 && tMix >= 0 && tMix < musicDurSec) {
            const srcIdx = Math.min(mixLen - 1, Math.floor(tMix * audioRate));
            const chanData = mixedBuffer.getChannelData(Math.min(ch, mixChCount - 1));
            v = chanData[srcIdx] * gain;
          }
          planar[ch * length + frame] = v;
        }
      }

      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate: audioRate,
        numberOfFrames: length,
        numberOfChannels: audioChannels,
        timestamp,
        data: planar,
      });
      audioEncoder.encode(ad);
      ad.close();

      while (audioEncoder.encodeQueueSize > 8) {
        await new Promise(r => setTimeout(r, 1));
      }

      audioSamplesDone += length;
      if (offset % (audioChunkSize * 50) === 0) {
        const pct = 65 + (audioSamplesDone / totalAudioSamples) * 25;
        showProgress(pct, `Encoding audio… ${Math.round((audioSamplesDone / totalAudioSamples) * 100)}%`);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    showProgress(91, 'Flushing audio encoder…');
    await audioEncoder.flush();
    audioEncoder.close();
    if (audioError) throw new Error(`Audio encoder error: ${audioError.message || audioError}`);

    /* ---- Phase 3: Finalize + Nero chapters (moov.udta.chpl) ---- */
    showProgress(95, 'Finalizing MP4…');
    muxer.finalize();

    showProgress(97, 'Embedding chapter markers…');
    const chapterList = [
      { startSec: 0, title: 'Intro' },
      ...plans.map((p, i) => ({
        startSec: introHoldSec + p.tStartSec,
        title: playlistChipLabel(i + 1, rawTitles[i]),
      })),
      { startSec: introHoldSec + musicDurSec, title: 'Closing' },
    ];
    const mp4WithChapters = injectNeroChaptersIntoMp4(target.buffer, chapterList);

    showProgress(100, 'Done!');
    return new Blob([mp4WithChapters], { type: 'video/mp4' });
  }

  /* ── export orchestrator ────────────────────────────────── */

  function sanitizeFileName(name) {
    return String(name || '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'S.E.A.M_demo';
  }

  async function runExport() {
    const btn = document.getElementById('btn-demo-video');
    const exportStatus = document.getElementById('demo-video-export-status');
    const order = STATE.order?.[FMT];
    if (!order || order.length === 0) {
      alert('Load a sample pack with at least one song first.');
      return;
    }

    btn.disabled = true;
    showAppLoading('Preparing demo video…');
    showProgress(0, 'Checking browser capabilities…');

    let videoBgAnimator = null;
    try {
      await checkWebCodecsSupport();

      const seed = hashStr(STATE.rootDir?.name || 'pack') ^ (order.length * 2654435761);
      const rnd = mulberry32(seed >>> 0);
      const introHoldSec = introHoldSecFromSeed(seed >>> 0);

      /* ---- gather audio excerpts ---- */
      const excerpts = [];
      const meta = [];
      for (let oi = 0; oi < order.length; oi++) {
        const songIdx = order[oi];
        const song = STATE.songs[FMT][songIdx];
        showProgress(
          (oi / order.length) * 3,
          `Loading audio ${oi + 1} / ${order.length}: ${song.name}`,
        );
        const composite = await getSongCompositeBuffer(FMT, songIdx);
        if (!composite || composite.duration < 1) {
          console.warn('Skipping song (no decodable audio)', song.name);
          continue;
        }
        const pick = pickExcerpt(composite, rnd);
        if (!pick) continue;
        const ex = sliceAudioBuffer(composite, pick.t0, pick.t1);
        if (!ex) continue;
        excerpts.push(ex);
        let totalSourceBytes = 0;
        try {
          if (DV) totalSourceBytes = await DV.sumSongSourceAudioBytes(song);
        } catch {
          totalSourceBytes = 0;
        }
        meta.push({
          title: song.name,
          fullDurationSec: song.duration || composite.duration || 0,
          partCount: song.parts?.length ?? 0,
          totalSourceBytes,
          excerptOffsetSec: pick.t0,
          excerptLenSec: pick.clipLen,
          peaks: computePeaks(ex, PEAK_BINS),
        });
      }

      if (excerpts.length === 0) {
        alert('Could not build audio for any song. Check that WAVs decode in this browser.');
        return;
      }

      /* ---- crossfade mix ---- */
      showProgress(3, 'Mixing crossfades…');
      const fadeSec = fadeSecondsFromState();
      const mix = mixCrossfaded(excerpts, fadeSec);
      if (!mix) throw new Error('Crossfade mix failed');

      const { buffer: mixedBuffer, offsets, rate } = mix;
      const plans = meta.map((m, i) => ({
        ...m,
        tStartSec: offsets[i] / rate,
        localT(globalSec) {
          const local = globalSec - this.tStartSec;
          return Math.min(1, Math.max(0, local / this.excerptLenSec));
        },
      }));
      const rawTitles = meta.map((m) => m.title);

      showProgress(4, 'Preparing export (fonts & background)…');
      const fontSel = document.getElementById('select-demo-video-font');
      let fontFace = fontSel && fontSel.value;
      if (!fontFace || !MP4_EXPORT_FONTS.some(f => f.value === fontFace)) {
        fontFace = 'SEAM-Export-Space-Mono';
      }
      await ensureMp4ExportFontLoaded(fontFace);
      if (demoVideoUserBackground && demoVideoUserBackground.kind === 'video') {
        showProgress(4, 'Loading background videos…');
        videoBgAnimator = await createDemoVideoBgAnimator(demoVideoUserBackground.files);
      }
      const bg = videoBgAnimator ? null : await loadExportSafeBackgroundBitmap();
      const packStatsLine = buildPackExportStatsLine();
      const cornerCredit = readMp4CornerCreditFromUi();

      /* ---- full offline render ---- */
      const fontSizeMuls = readMp4FontSizeMultipliersFromUi();
      const mp4Blob = await renderMp4Offline(
        mixedBuffer,
        plans,
        rawTitles,
        bg,
        videoBgAnimator,
        introHoldSec,
        fontFace,
        packStatsLine,
        cornerCredit,
        fontSizeMuls,
      );

      /* ---- downloads: MP4 + YouTube description ---- */
      const baseName = sanitizeFileName(STATE.rootDir?.name || 'S.E.A.M_demo');
      triggerDownload(mp4Blob, `${baseName}_demo.mp4`);

      const totalVideoDur = introHoldSec + mixedBuffer.duration + OUTRO_FLYBACK_SEC;
      const descText = buildYoutubeDescription(plans, totalVideoDur, introHoldSec, mixedBuffer.duration);
      const descBlob = new Blob([descText], { type: 'text/plain;charset=utf-8' });
      requestAnimationFrame(() => {
        triggerDownload(descBlob, `${baseName}_demo_description.txt`);
      });

      if (exportStatus) {
        const hasBg = !!(bg || videoBgAnimator);
        exportStatus.textContent =
          'Export complete (MP4 + description.txt). ' +
          (hasBg
            ? ''
            : 'No background: pick an image or videos, or add img/video_background.jpg / run npm run vendor:video-bg. ') +
          'Run again for different random excerpts.';
      }
    } catch (err) {
      console.error('[demo-video-export]', err);
      alert(err?.message || String(err));
    } finally {
      videoBgAnimator?.dispose();
      hideProgress();
      hideAppLoading();
      btn.disabled = false;
    }
  }

  /* ── bind button ────────────────────────────────────────── */

  function refreshDemoVideoBgStatus() {
    const statusEl = document.getElementById('demo-video-bg-status');
    const resetBtn = document.getElementById('btn-demo-video-reset-bg');
    if (!statusEl) return;
    if (!demoVideoUserBackground) {
      disposeDemoVideoBgPreviewAnimator();
      statusEl.textContent = 'Using default (project JPG or embedded copy).';
      if (resetBtn) resetBtn.hidden = true;
    } else if (demoVideoUserBackground.kind === 'image') {
      disposeDemoVideoBgPreviewAnimator();
      const f = demoVideoUserBackground.file;
      const name = f instanceof File && f.name ? f.name : 'Custom image';
      statusEl.textContent = `Using your image: ${name}`;
      if (resetBtn) resetBtn.hidden = false;
    } else {
      const files = demoVideoUserBackground.files;
      const n = files.length;
      const head = files
        .slice(0, 2)
        .map((f) => (f instanceof File && f.name ? f.name : 'video'))
        .join(', ');
      const tail = n > 2 ? ` (+${n - 2} more)` : '';
      statusEl.textContent = `Animated background: ${n} video clip${n === 1 ? '' : 's'} (${head}${tail}).`;
      if (resetBtn) resetBtn.hidden = false;
    }
    scheduleDemoPreviewRender();
  }

  /** Custom multi-column font gallery; fixed position above preview (z-index in CSS). */
  function initMp4ExportFontPicker(fontSel) {
    const root = document.getElementById('demo-video-font-picker-root');
    const btn = document.getElementById('btn-demo-video-font-picker');
    const panel = document.getElementById('panel-demo-video-font');
    const cols = document.getElementById('demo-video-font-picker-cols');
    const labelSpan = document.getElementById('demo-video-font-picker-label');
    if (!root || !btn || !panel || !cols || !labelSpan || root.dataset.seamMp4PickerInit) return;
    root.dataset.seamMp4PickerInit = '1';

    const scrollEl = document.getElementById('demo-video-font-picker-scroll');
    panel.hidden = true;
    panel.setAttribute('hidden', '');
    root.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');

    function syncTrigger() {
      const opt = fontSel.selectedOptions[0];
      labelSpan.textContent = opt ? opt.textContent : 'Choose font…';
      labelSpan.style.fontFamily = mp4VideoFontStack(fontSel.value);
    }

    function syncOptionsSelected() {
      const v = fontSel.value;
      for (const el of cols.querySelectorAll('.tools-demo-video-font-picker-option')) {
        el.setAttribute('aria-selected', el.dataset.fontValue === v ? 'true' : 'false');
      }
    }

    function positionPanel() {
      if (panel.hidden) return;
      const r = btn.getBoundingClientRect();
      const margin = 10;
      const minPanelW = 640;
      const maxW = Math.min(1200, window.innerWidth - margin * 2);
      let w = Math.max(minPanelW, maxW);
      if (w > maxW) w = maxW;
      let left = r.left;
      if (left + w > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - w);
      if (left < margin) left = margin;
      let top = r.bottom + 6;
      const estH = Math.min(window.innerHeight * 0.72, 560);
      if (top + estH > window.innerHeight - margin) {
        top = Math.max(margin, r.top - estH - 6);
      }
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.width = `${w}px`;
    }

    function closePicker() {
      if (panel.hidden) return;
      panel.hidden = true;
      panel.setAttribute('hidden', '');
      root.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    }

    function openPicker() {
      panel.hidden = false;
      panel.removeAttribute('hidden');
      root.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      positionPanel();
      syncOptionsSelected();
    }

    function togglePicker() {
      if (panel.hidden) openPicker();
      else closePicker();
    }

    cols.innerHTML = '';
    for (const f of MP4_EXPORT_FONTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tools-demo-video-font-picker-option';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', 'false');
      b.dataset.fontValue = f.value;
      b.textContent = f.preview;
      b.style.fontFamily = mp4VideoFontStack(f.value);
      b.addEventListener('click', () => {
        if (fontSel.value !== f.value) {
          fontSel.value = f.value;
          fontSel.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          syncTrigger();
          syncOptionsSelected();
        }
        closePicker();
        btn.focus();
      });
      cols.appendChild(b);
    }

    syncTrigger();
    fontSel.addEventListener('change', () => {
      syncTrigger();
      syncOptionsSelected();
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePicker();
    });

    function stepMp4ExportFontByArrow(delta) {
      const n = MP4_EXPORT_FONTS.length;
      if (n === 0) return;
      let i = MP4_EXPORT_FONTS.findIndex((f) => f.value === fontSel.value);
      if (i < 0) i = 0;
      i = ((i + delta) % n + n) % n;
      const next = MP4_EXPORT_FONTS[i];
      if (fontSel.value !== next.value) {
        fontSel.value = next.value;
        fontSel.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        syncTrigger();
        syncOptionsSelected();
      }
    }

    btn.addEventListener('keydown', (e) => {
      if (!panel.hidden) return;
      let delta = 0;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = 1;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -1;
      else return;
      e.preventDefault();
      stepMp4ExportFontByArrow(delta);
    });

    if (scrollEl && !scrollEl.dataset.seamMp4FontWheel) {
      scrollEl.dataset.seamMp4FontWheel = '1';
      scrollEl.addEventListener(
        'wheel',
        (e) => {
          if (scrollEl.clientWidth >= scrollEl.scrollWidth) return;
          const dy = e.deltaY;
          const dx = e.deltaX;
          if (Math.abs(dx) >= Math.abs(dy)) return;
          e.preventDefault();
          let delta = dy;
          if (e.deltaMode === 1) delta *= 16;
          else if (e.deltaMode === 2) delta *= scrollEl.clientHeight;
          scrollEl.scrollLeft += delta;
        },
        { passive: false },
      );
    }

    function isOutsideFontPicker(target) {
      if (!target || !(target instanceof Node)) return true;
      if (root.contains(target)) return false;
      return true;
    }

    function onDocCloseFontPicker(e) {
      if (panel.hidden) return;
      if (!isOutsideFontPicker(e.target)) return;
      closePicker();
    }

    if (!document.body.dataset.seamMp4FontPickerDoc) {
      document.body.dataset.seamMp4FontPickerDoc = '1';
      document.addEventListener('pointerdown', onDocCloseFontPicker, true);
      document.addEventListener('mousedown', onDocCloseFontPicker, true);
      window.addEventListener('resize', () => {
        if (!panel.hidden) positionPanel();
      });
      const sidebar = document.querySelector('.sidebar-controls');
      const main = document.getElementById('main-content-area');
      const reflowPicker = () => {
        if (!panel.hidden) positionPanel();
      };
      sidebar?.addEventListener('scroll', reflowPicker, { passive: true });
      main?.addEventListener('scroll', reflowPicker, { passive: true });
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || panel.hidden) return;
        closePicker();
        e.preventDefault();
      });
    }

    syncOptionsSelected();
  }

  function bindDemoVideoPreview() {
    const pop = document.getElementById('demo-video-preview-popover');
    const btnOpen = document.getElementById('btn-demo-video-preview');
    const btnClose = document.getElementById('btn-demo-video-preview-close');
    const main = document.getElementById('main-content-area');
    const sidebar = document.querySelector('.sidebar-controls');
    const fontSel = document.getElementById('select-demo-video-font');

    function setDemoVideoPreviewOpen(open) {
      demoVideoPreviewOpen = open;
      if (!pop) return;
      if (open) {
        pop.hidden = false;
        pop.setAttribute('aria-hidden', 'false');
        positionDemoVideoPreviewPopover();
        void renderDemoVideoPreviewFrame();
      } else {
        pop.hidden = true;
        pop.setAttribute('aria-hidden', 'true');
        clearTimeout(demoPreviewRenderTimer);
      }
    }

    if (btnOpen && pop && !btnOpen.dataset.seamPreviewBound) {
      btnOpen.dataset.seamPreviewBound = '1';
      btnOpen.addEventListener('click', () => {
        setDemoVideoPreviewOpen(pop.hidden);
      });
    }
    if (btnClose && pop && !btnClose.dataset.seamPreviewBound) {
      btnClose.dataset.seamPreviewBound = '1';
      btnClose.addEventListener('click', () => setDemoVideoPreviewOpen(false));
    }

    if (!demoPreviewReflowListenersBound) {
      demoPreviewReflowListenersBound = true;
      const onReflow = () => {
        if (demoVideoPreviewOpen) positionDemoVideoPreviewPopover();
      };
      window.addEventListener('resize', onReflow);
      main?.addEventListener('scroll', onReflow, { passive: true });
      sidebar?.addEventListener('scroll', onReflow, { passive: true });
    }

    if (fontSel && !fontSel.dataset.seamPreviewFontListen) {
      fontSel.dataset.seamPreviewFontListen = '1';
      fontSel.addEventListener('change', () => scheduleDemoPreviewRender());
    }

    const creditInput = document.getElementById('input-demo-video-corner-credit');
    const creditYearCb = document.getElementById('checkbox-demo-video-credit-year');
    if (creditInput && !creditInput.dataset.seamPreviewCreditListen) {
      creditInput.dataset.seamPreviewCreditListen = '1';
      creditInput.addEventListener('input', () => scheduleDemoPreviewRender());
    }
    if (creditYearCb && !creditYearCb.dataset.seamPreviewCreditListen) {
      creditYearCb.dataset.seamPreviewCreditListen = '1';
      creditYearCb.addEventListener('change', () => scheduleDemoPreviewRender());
    }

    if (!document.body.dataset.seamPreviewEsc) {
      document.body.dataset.seamPreviewEsc = '1';
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && demoVideoPreviewOpen) setDemoVideoPreviewOpen(false);
      });
    }
  }

  function bind() {
    const btn = document.getElementById('btn-demo-video');
    if (!btn || btn.dataset.seamDemoBound) return;
    btn.dataset.seamDemoBound = '1';
    btn.addEventListener('click', () => void runExport());

    const pickBtn = document.getElementById('btn-demo-video-pick-bg');
    const resetBtn = document.getElementById('btn-demo-video-reset-bg');
    const fileInput = document.getElementById('input-demo-video-bg');
    if (pickBtn && fileInput) {
      pickBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        disposeDemoVideoBgPreviewAnimator();
        invalidateDemoVideoPreviewAutoPalette();
        const list = fileInput.files ? Array.from(fileInput.files) : [];
        fileInput.value = '';
        if (list.length === 0) return;
        const videos = list.filter((f) => typeof f.type === 'string' && f.type.startsWith('video/'));
        const images = list.filter((f) => typeof f.type === 'string' && f.type.startsWith('image/'));
        if (videos.length > 0) {
          demoVideoUserBackground = { kind: 'video', files: videos };
        } else if (images.length > 0) {
          demoVideoUserBackground = { kind: 'image', file: images[0] };
        } else {
          alert('Choose a JPEG, PNG, WebP, or one or more video files (MP4, WebM, MOV, etc.).');
          return;
        }
        refreshDemoVideoBgStatus();
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        demoVideoUserBackground = null;
        disposeDemoVideoBgPreviewAnimator();
        invalidateDemoVideoPreviewAutoPalette();
        refreshDemoVideoBgStatus();
      });
    }
    refreshDemoVideoBgStatus();

    const palSel = document.getElementById('select-demo-video-ui-palette');
    if (palSel && !palSel.dataset.seamMp4PalInit) {
      palSel.dataset.seamMp4PalInit = '1';
      const savedPal = mp4FontStorageGet(MP4_EXPORT_UI_PALETTE_STORAGE_KEY);
      if (savedPal === 'basic' || savedPal === 'auto') palSel.value = savedPal;
      palSel.addEventListener('change', () => {
        mp4FontStorageSet(MP4_EXPORT_UI_PALETTE_STORAGE_KEY, palSel.value);
        invalidateDemoVideoPreviewAutoPalette();
        scheduleDemoPreviewRender();
      });
    }

    const fontSel = document.getElementById('select-demo-video-font');
    if (fontSel && !fontSel.dataset.seamMp4FontsInit) {
      fontSel.dataset.seamMp4FontsInit = '1';
      fontSel.innerHTML = '';
      for (const f of MP4_EXPORT_FONTS) {
        const opt = document.createElement('option');
        opt.value = f.value;
        opt.textContent = f.preview;
        opt.style.fontFamily = mp4VideoFontStack(f.value);
        fontSel.appendChild(opt);
      }
      const saved = mp4FontStorageGet(MP4_EXPORT_FONT_STORAGE_KEY);
      if (saved && MP4_EXPORT_FONTS.some(x => x.value === saved)) fontSel.value = saved;
      fontSel.addEventListener('change', () => {
        mp4FontStorageSet(MP4_EXPORT_FONT_STORAGE_KEY, fontSel.value);
      });
      initMp4ExportFontPicker(fontSel);
      warmMp4ExportFontPreviews();
    }

    initMp4ExportFontSizeControls();
    bindDemoVideoPreview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
