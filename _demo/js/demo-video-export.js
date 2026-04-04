/* =============================================================
   S.E.A.M — Pack demo video export (MP4 via WebCodecs + mp4-muxer)
   Fully offline: frames rendered to canvas → VideoEncoder → muxer,
   audio → AudioEncoder → muxer, combined into MP4.
   Post-pass: Nero-style chpl chapters in moov.udta (VLC, many players).
   No WASM, no Workers, no fetch — works on file:// and http(s).
   ============================================================= */

(function initDemoVideoExport() {
  'use strict';

  /** Image chosen in-page (File/Blob); wins over fetch/embed so exports always match what you picked. */
  let demoVideoUserBackground = null;

  const MP4_EXPORT_FONT_STORAGE_KEY = 'seam_mp4_export_font_css';

  /** Bundled OFL faces (see css/mp4-export-fonts.css); `value` must match @font-face font-family. */
  const MP4_EXPORT_FONTS = [
    { value: 'SEAM-Export-Space-Mono', preview: 'Space Mono — technical mono (default)' },
    { value: 'SEAM-Export-JetBrains-Mono', preview: 'JetBrains Mono — code / UI' },
    { value: 'SEAM-Export-Inter', preview: 'Inter — UI grotesk' },
    { value: 'SEAM-Export-Bebas-Neue', preview: 'Bebas Neue — tall poster' },
    { value: 'SEAM-Export-Oswald', preview: 'Oswald — condensed industrial' },
    { value: 'SEAM-Export-Barlow-Condensed', preview: 'Barlow Condensed — tight headlines' },
    { value: 'SEAM-Export-Archivo-Narrow', preview: 'Archivo Narrow — narrow news' },
    { value: 'SEAM-Export-Anton', preview: 'Anton — heavy impact' },
    { value: 'SEAM-Export-Teko', preview: 'Teko — sporty tall' },
    { value: 'SEAM-Export-Orbitron', preview: 'Orbitron — sci-fi geometric' },
    { value: 'SEAM-Export-Rajdhani', preview: 'Rajdhani — tech squared' },
    { value: 'SEAM-Export-Exo-2', preview: 'Exo 2 — modern display' },
    { value: 'SEAM-Export-Righteous', preview: 'Righteous — retro bubble' },
    { value: 'SEAM-Export-Fredoka', preview: 'Fredoka — soft rounded' },
    { value: 'SEAM-Export-Sora', preview: 'Sora — clean geometric' },
    { value: 'SEAM-Export-Outfit', preview: 'Outfit — minimal round' },
    { value: 'SEAM-Export-DM-Sans', preview: 'DM Sans — neutral UI' },
    { value: 'SEAM-Export-Manrope', preview: 'Manrope — friendly grotesk' },
    { value: 'SEAM-Export-Montserrat', preview: 'Montserrat — geometric classic' },
    { value: 'SEAM-Export-Raleway', preview: 'Raleway — elegant thin stress' },
    { value: 'SEAM-Export-Libre-Franklin', preview: 'Libre Franklin — readable grotesk' },
    { value: 'SEAM-Export-Poppins', preview: 'Poppins — geometric friendly' },
    { value: 'SEAM-Export-Nunito', preview: 'Nunito — rounded sans' },
    { value: 'SEAM-Export-Rubik', preview: 'Rubik — soft blocks' },
    { value: 'SEAM-Export-Work-Sans', preview: 'Work Sans — workhorse UI' },
    { value: 'SEAM-Export-Playfair-Display', preview: 'Playfair Display — editorial serif' },
    { value: 'SEAM-Export-Lora', preview: 'Lora — book serif' },
    { value: 'SEAM-Export-Merriweather', preview: 'Merriweather — sturdy serif' },
    { value: 'SEAM-Export-Source-Sans-3', preview: 'Source Sans 3 — Adobe UI' },
    { value: 'SEAM-Export-Bitter', preview: 'Bitter — slab readable' },
    { value: 'SEAM-Export-Cabin', preview: 'Cabin — humanist sans' },
    { value: 'SEAM-Export-Bungee', preview: 'Bungee — inline poster' },
    { value: 'SEAM-Export-Audiowide', preview: 'Audiowide — wide future' },
    { value: 'SEAM-Export-Share-Tech', preview: 'Share Tech — HUD mono' },
    { value: 'SEAM-Export-VT323', preview: 'VT323 — terminal CRT' },
    { value: 'SEAM-Export-Press-Start-2P', preview: 'Press Start 2P — 8-bit' },
    { value: 'SEAM-Export-Syncopate', preview: 'Syncopate — spaced caps' },
    { value: 'SEAM-Export-Maven-Pro', preview: 'Maven Pro — tech sans' },
    { value: 'SEAM-Export-Quantico', preview: 'Quantico — military tech' },
    { value: 'SEAM-Export-Ubuntu', preview: 'Ubuntu — distro humanist' },
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
  /** Hold wallpaper + pack hero; music starts after this (2–3 s from export seed). */
  const INTRO_TRANS_SEC = 1.25;
  const OUTRO_FADE_SEC = 1;
  const OUTRO_BLACK_SEC = 1;

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
    const pWord = partTotal === 1 ? 'part' : 'parts';
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

  function buildYoutubeDescription(plans, totalDurationSec, introLeadInSec) {
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

  function drawSeriesNumberBadge(ctx, x, y, w, h, seriesNum, s, fontScale, fontFace) {
    const fs = Math.max(0.5, fontScale);
    const stack = mp4VideoFontStack(fontFace);
    const r = Math.max(8, Math.round(10 * s * fs));
    ctx.save();
    ctx.shadowColor = 'rgba(78, 205, 196, 0.35)';
    ctx.shadowBlur = Math.round(14 * s * fs);
    ctx.shadowOffsetY = Math.round(2 * s * fs);
    ctx.fillStyle = 'rgba(16, 22, 38, 0.97)';
    drawRoundedRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = 'rgba(78, 205, 196, 0.92)';
    ctx.lineWidth = Math.max(2, Math.round(2 * s * fs));
    drawRoundedRect(ctx, x, y, w, h, r);
    ctx.stroke();

    ctx.fillStyle = '#f4f7ff';
    ctx.font = `800 ${Math.max(24, Math.round(36 * s * fs))}px ${stack}`;
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

  function drawFallbackVideoBackground(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#1b2240');
    g.addColorStop(0.45, '#0d1117');
    g.addColorStop(1, '#122040');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /**
   * VideoFrame rejects canvases that drew from "tainted" sources (e.g. <img> from
   * file:// or cross-origin without CORS). Only draw backgrounds from fetch→Blob→
   * ImageBitmap (same-origin http(s)), or use the gradient fallback.
   */
  /**
   * @param {object} timeline introHoldSec, introTransSec, musicDurSec, outroFadeSec, outroBlackSec
   */
  function drawFrame(ctx, tVideo, plans, currentIdx, totalPieces, bgBitmap, rawTitles, packMeta, exportYear, timeline, fontFace, packStatsLine) {
    const W = CANVAS_W;
    const H = CANVAS_H;
    const stack = mp4VideoFontStack(fontFace);
    const {
      introHoldSec,
      introTransSec,
      musicDurSec,
      outroFadeSec,
    } = timeline;

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    if (bgBitmap) {
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
      ctx.globalAlpha = 0.62;
      ctx.drawImage(bgBitmap, dx, dy, dw, dh);
      ctx.restore();
    } else {
      drawFallbackVideoBackground(ctx, W, H);
    }

    ctx.fillStyle = 'rgba(8, 12, 22, 0.48)';
    ctx.fillRect(0, 0, W, H);

    const s = VIDEO_UI_SCALE;
    const pad = Math.round(40 * s);
    const playlistH = Math.round(H * 0.14);
    const transEnd = introHoldSec + introTransSec;
    let layoutBlend = 1;
    if (tVideo < introHoldSec) layoutBlend = 0;
    else if (tVideo < transEnd) layoutBlend = easeInOutCubic((tVideo - introHoldSec) / introTransSec);

    const mainUiAlpha =
      tVideo < introHoldSec ? 0 : tVideo < transEnd ? easeInOutCubic((tVideo - introHoldSec) / introTransSec) : 1;

    const tMix = Math.min(Math.max(tVideo - introHoldSec, 0), Math.max(1e-9, musicDurSec));

    ctx.save();
    ctx.globalAlpha = mainUiAlpha;
    ctx.font = `600 ${Math.round(15 * s)}px ${stack}`;
    ctx.textBaseline = 'middle';

    let x = pad;
    let y = pad + Math.round(8 * s);
    const chipH = Math.round(28 * s);
    const chipPad = Math.round(8 * s);
    const chipGap = Math.round(6 * s);
    const chipR = Math.max(4, Math.round(6 * s));
    rawTitles.forEach((rawTitle, i) => {
      const label = playlistChipLabel(i + 1, rawTitle);
      const tw = Math.min(ctx.measureText(label).width + chipPad * 2, W - pad * 2);
      if (x + tw > W - pad) {
        x = pad;
        y += chipH + chipGap;
      }
      if (y > pad + playlistH) return;
      const active = i === currentIdx;
      ctx.fillStyle = active ? 'rgba(233, 69, 96, 0.95)' : 'rgba(45, 65, 112, 0.55)';
      drawRoundedRect(ctx, x, y, tw, chipH, chipR);
      ctx.fill();
      ctx.strokeStyle = active ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = Math.max(1, s);
      ctx.stroke();
      ctx.fillStyle = active ? '#fff' : 'rgba(230, 235, 245, 0.85)';
      ctx.fillText(label, x + chipPad, y + chipH / 2);
      x += tw + Math.round(8 * s);
    });

    const seriesNum = packMeta && packMeta.seriesNum;
    const packLine = (packMeta && (packMeta.packTitle || packMeta.raw)) || '';
    const footerStatsExtra = packLine && packStatsLine ? 52 : 0;
    const footerBand = Math.round(
      ((seriesNum && packLine ? 268 : packLine ? 212 : seriesNum ? 132 : 68) + footerStatsExtra) * s,
    );
    const blockTop = pad + playlistH + Math.round(24 * s);
    const blockH = H - blockTop - pad - footerBand;
    const titleW = Math.round(W * 0.38);
    const waveX = pad + titleW + Math.round(20 * s);
    const waveW = W - waveX - pad;
    const waveY = blockTop;
    const waveH = Math.min(Math.round(200 * s), blockH - Math.round(40 * s));

    const titleX = pad;
    const titleMaxW = Math.max(
      Math.round(120 * s),
      waveX - titleX - Math.round(16 * s),
    );

    const plan = plans[currentIdx];
    if (plan) {
      const rawName = plan.title;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.font = `700 ${Math.round(32 * s)}px ${stack}`;
      const titleLineH = Math.round(38 * s);
      const titleTop = blockTop + Math.round(18 * s);
      const afterTitle = wrapTextReturnBottom(ctx, rawName, titleX, titleTop, titleMaxW, titleLineH);

      ctx.fillStyle = 'rgba(200, 210, 230, 0.78)';
      ctx.font = `400 ${Math.round(14 * s)}px ${stack}`;
      ctx.textBaseline = 'top';
      let metaY = afterTitle + Math.round(14 * s);
      ctx.fillText(`Full track ${fmtMinSec(plan.fullDurationSec)}`, titleX, metaY);
      metaY += Math.round(24 * s);
      ctx.fillText(`Timeline parts in folder: ${plan.partCount}`, titleX, metaY);
      metaY += Math.round(24 * s);
      ctx.fillText(`Demo segment ${currentIdx + 1} of ${totalPieces}`, titleX, metaY);

      drawWaveform(ctx, plan.peaks, waveX, waveY, waveW, waveH, plan.localT(tMix));
    }
    ctx.restore();

    const creditReserve = Math.round(38 * s);
    const footerTop = H - footerBand;
    const finalFootY0 = footerTop + Math.round(12 * s);
    const finalBadgeW = Math.round(132 * s);
    const finalBadgeH = Math.round(88 * s);
    const finalBadgeX = (W - finalBadgeW) / 2;
    const finalBadgeY = finalFootY0;
    let finalTitleTop = finalFootY0;
    if (seriesNum) finalTitleTop = finalBadgeY + finalBadgeH + Math.round(14 * s);

    const introBadgeW = Math.round(158 * s);
    const introBadgeH = Math.round(104 * s);
    const introBadgeX = (W - introBadgeW) / 2;
    const introBadgeY = Math.round(H * 0.3);
    const introTitleY0 = seriesNum ? introBadgeY + introBadgeH + Math.round(22 * s) : Math.round(H * 0.38);
    const introPackFont = Math.round(56 * s);
    const introPackLineH = Math.round(64 * s);
    const finalPackFont = Math.round(39 * s);
    const finalPackLineH = Math.round(47 * s);

    const badgeW = seriesNum ? lerp(introBadgeW, finalBadgeW, layoutBlend) : 0;
    const badgeH = seriesNum ? lerp(introBadgeH, finalBadgeH, layoutBlend) : 0;
    const badgeX = seriesNum ? lerp(introBadgeX, finalBadgeX, layoutBlend) : 0;
    const badgeY = seriesNum ? lerp(introBadgeY, finalBadgeY, layoutBlend) : 0;
    const badgeFontScale = seriesNum ? lerp(1.12, 1, layoutBlend) : 1;
    const packFontPx = Math.round(lerp(introPackFont, finalPackFont, layoutBlend));
    const packLineH = Math.round(lerp(introPackLineH, finalPackLineH, layoutBlend));
    const titleTopLerp = lerp(introTitleY0, finalTitleTop, layoutBlend);

    if (seriesNum) {
      drawSeriesNumberBadge(ctx, badgeX, badgeY, badgeW, badgeH, seriesNum, s, badgeFontScale, fontFace);
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
        const subTop = afterPackTitle + Math.round(12 * s);
        ctx.font = `400 ${Math.round(17 * s)}px ${stack}`;
        ctx.fillStyle = 'rgba(168, 186, 214, 0.72)';
        const subLineH = Math.round(22 * s);
        wrapTextCentered(ctx, packStatsLine, W / 2, subTop, W - pad * 4, subLineH);
      }
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = mainUiAlpha;
    ctx.font = `400 ${Math.round(11 * s)}px ${stack}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`EnthusiastGuy ${exportYear}`, W - pad, H - Math.round(14 * s));
    ctx.textAlign = 'left';
    ctx.restore();

    const tMusic = tVideo - introHoldSec;
    const fadeDur = Math.min(outroFadeSec, musicDurSec > 1e-6 ? musicDurSec : outroFadeSec);
    const fadeStart = Math.max(0, musicDurSec - fadeDur);
    let blackA = 0;
    if (musicDurSec > 0 && tMusic >= fadeStart) {
      blackA = easeInOutCubic((tMusic - fadeStart) / fadeDur);
    }
    if (tMusic >= musicDurSec) blackA = 1;
    if (blackA > 0) {
      ctx.fillStyle = `rgba(0,0,0,${blackA})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawWaveform(ctx, peaks, x, y, w, h, progress01) {
    const n = peaks.length;
    if (n <= 0) return;
    const s = VIDEO_UI_SCALE;
    const wr = Math.max(6, Math.round(10 * s));
    const vm = Math.max(2, Math.round(4 * s));
    ctx.fillStyle = 'rgba(22, 33, 62, 0.9)';
    drawRoundedRect(ctx, x, y, w, h, wr);
    ctx.fill();
    ctx.strokeStyle = 'rgba(78, 205, 196, 0.25)';
    ctx.lineWidth = Math.max(1, s);
    ctx.stroke();

    const mid = y + h / 2;
    const amp = h * 0.42;
    ctx.strokeStyle = 'rgba(78, 205, 196, 0.85)';
    ctx.lineWidth = Math.max(1, Math.round(1.25 * s));
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x + (i / (n - 1)) * w;
      const py = mid - peaks[i] * amp;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
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
    ctx.strokeStyle = 'rgba(233, 69, 96, 0.95)';
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

    if (demoVideoUserBackground && demoVideoUserBackground.size > 0) {
      try {
        const bmp = await createImageBitmap(demoVideoUserBackground);
        if (bmp) return bmp;
      } catch (e) {
        console.warn('[demo-video-export] Could not decode user background image', e);
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

  async function renderMp4Offline(mixedBuffer, plans, rawTitles, bgBitmap, introHoldSec, fontFace, packStatsLine) {
    const musicDurSec = mixedBuffer.duration;
    const totalVideoSec = introHoldSec + musicDurSec + OUTRO_BLACK_SEC;
    const fps = chooseFps(totalVideoSec);
    const totalVideoFrames = Math.max(1, Math.ceil(totalVideoSec * fps));
    const totalPieces = plans.length;
    const packMeta = parsePackFolderName(STATE.rootDir?.name);
    const exportYear = new Date().getFullYear();

    const timeline = {
      introHoldSec,
      introTransSec: INTRO_TRANS_SEC,
      musicDurSec,
      outroFadeSec: OUTRO_FADE_SEC,
      outroBlackSec: OUTRO_BLACK_SEC,
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
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    const keyInterval = Math.max(1, fps * 2);
    const renderStart = performance.now();

    for (let f = 0; f < totalVideoFrames; f++) {
      if (videoError) throw new Error(`Video encoder error: ${videoError.message || videoError}`);

      const tVideo = f / fps;
      const tMix = Math.min(Math.max(tVideo - introHoldSec, 0), musicDurSec);
      const idx = currentPlanIndex(tMix, plans);
      drawFrame(ctx, tVideo, plans, idx, totalPieces, bgBitmap, rawTitles, packMeta, exportYear, timeline, fontFace, packStatsLine);

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
    const hint = document.getElementById('demo-video-hint');
    const order = STATE.order?.[FMT];
    if (!order || order.length === 0) {
      alert('Load a sample pack with at least one song first.');
      return;
    }

    btn.disabled = true;
    showAppLoading('Preparing demo video…');
    showProgress(0, 'Checking browser capabilities…');

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
        meta.push({
          title: song.name,
          fullDurationSec: song.duration || composite.duration || 0,
          partCount: song.parts?.length ?? 0,
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
      const bg = await loadExportSafeBackgroundBitmap();
      const packStatsLine = buildPackExportStatsLine();

      /* ---- full offline render ---- */
      const mp4Blob = await renderMp4Offline(mixedBuffer, plans, rawTitles, bg, introHoldSec, fontFace, packStatsLine);

      /* ---- downloads: MP4 + YouTube description ---- */
      const baseName = sanitizeFileName(STATE.rootDir?.name || 'S.E.A.M_demo');
      triggerDownload(mp4Blob, `${baseName}_demo.mp4`);

      const totalVideoDur = introHoldSec + mixedBuffer.duration + OUTRO_BLACK_SEC;
      const descText = buildYoutubeDescription(plans, totalVideoDur, introHoldSec);
      const descBlob = new Blob([descText], { type: 'text/plain;charset=utf-8' });
      requestAnimationFrame(() => {
        triggerDownload(descBlob, `${baseName}_demo_description.txt`);
      });

      if (hint) {
        hint.textContent =
          'Export complete (MP4 with embedded chapters + description.txt for YouTube). ' +
          (bg
            ? ''
            : 'No background: use “Choose background image…” or add img/video_background.jpg / run npm run vendor:video-bg in _demo. ') +
          'Run again for different random excerpts.';
      }
    } catch (err) {
      console.error('[demo-video-export]', err);
      alert(err?.message || String(err));
    } finally {
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
    if (demoVideoUserBackground) {
      const name =
        demoVideoUserBackground instanceof File && demoVideoUserBackground.name
          ? demoVideoUserBackground.name
          : 'Custom image';
      statusEl.textContent = `Using your file: ${name}`;
      if (resetBtn) resetBtn.hidden = false;
    } else {
      statusEl.textContent = 'Using default (project JPG or embedded copy).';
      if (resetBtn) resetBtn.hidden = true;
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
        const f = fileInput.files && fileInput.files[0];
        if (f && f.size > 0) demoVideoUserBackground = f;
        fileInput.value = '';
        refreshDemoVideoBgStatus();
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        demoVideoUserBackground = null;
        refreshDemoVideoBgStatus();
      });
    }
    refreshDemoVideoBgStatus();

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
      warmMp4ExportFontPreviews();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
