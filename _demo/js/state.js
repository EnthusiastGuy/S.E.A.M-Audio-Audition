/* =============================================================
   S.E.A.M Audio Audition — Global State, Audio Context & Utilities
   ============================================================= */

'use strict';

// ─── Global AudioContext ─────────────────────────────────────
const AC = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = AC.createGain();
const masterAnalyser = AC.createAnalyser();
masterAnalyser.fftSize = 1024;
masterAnalyser.smoothingTimeConstant = 0.72;
masterGain.connect(masterAnalyser);
masterAnalyser.connect(AC.destination);

// ─── State ───────────────────────────────────────────────────
const STATE = {
  rootDir: null,
  formats: ['wav'],
  currentFormat: 'wav',
  songs: { wav: [] },
  order: { wav: [] },
  crossfade: 0,
  speedPercent: 100,
  /** Parts longer than this (seconds) skip waveform UI; 0 = no limit. Default 20. */
  waveformMaxPartDurationSec: 20,
  /** How much of each end of a part to play in seam preview (ms). Default 2000. */
  seamPreviewMs: 2000,
  encoding: {
    mp3: {
      bitrateKbps: 192,
      sampleRateMode: '44100',
      channels: 'auto',
    },
    ogg: {
      quality: 0.5,
      sampleRateMode: 'source',
      channels: 'auto',
    },
  },
  players: {},
  /** Brick playground (per folder via session key): view mode, pan/zoom, brick positions. */
  playground: {
    mode: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    bricks: [],
    /** @type {'wav'|'mp3'|'ogg'} */
    downloadFormat: 'wav',
  },
};

// Part sheets currently open
const openPartSheets = new Set();

// ─── PART COLORS ─────────────────────────────────────────────
const PART_COLORS = [
  '#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#cc96ff',
  '#f5a623','#4ecdc4','#ff9f43','#a8dadc','#e94560'
];
function partColor(idx) { return PART_COLORS[idx % PART_COLORS.length]; }

// ─── TIME FORMAT (mm:ss:xxx — milliseconds shown smaller via fmtTimeHTML) ──
function splitTimeMs(secs) {
  if (!isFinite(secs) || secs < 0) secs = 0;
  const totalMs = Math.floor(secs * 1000 + 1e-6);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const mTotal = Math.floor(totalSec / 60);
  const m = mTotal % 60;
  const h = Math.floor(totalSec / 3600);
  return { h, m, s, ms };
}

/** Plain text, all one size (e.g. alerts). */
function fmtTime(secs) {
  const { h, m, s, ms } = splitTimeMs(secs);
  const msStr = String(ms).padStart(3, '0');
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${msStr}`;
  }
  return `${m}:${String(s).padStart(2, '0')}:${msStr}`;
}

/** HTML: mm:ss with :xxx milliseconds in a smaller span (class dur-ms). */
function fmtTimeHTML(secs) {
  const { h, m, s, ms } = splitTimeMs(secs);
  const msStr = String(ms).padStart(3, '0');
  let main;
  if (h > 0) {
    main = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } else {
    main = `${m}:${String(s).padStart(2, '0')}`;
  }
  return `${main}<span class="dur-ms">:${msStr}</span>`;
}

// ─── SESSION PERSISTENCE (localStorage) ──────────────────────
const LS_KEY_PREFIX = 'seam_session_v4_';

function getSessionKey() {
  return LS_KEY_PREFIX + (STATE.rootDir?.name || 'default');
}

function saveSession() {
  try {
    const data = {
      crossfade: STATE.crossfade,
      speedPercent: STATE.speedPercent,
      order: STATE.order,
      loopSettings: {},
      sequences: {},
      downloadFormats: {},
      currentFormat: STATE.currentFormat,
      openSheets: Array.from(openPartSheets),
      encoding: STATE.encoding,
      waveformMaxPartDurationSec: STATE.waveformMaxPartDurationSec,
      seamPreviewMs: STATE.seamPreviewMs,
      playground: STATE.playground,
    };
    for (const [key, ps] of Object.entries(STATE.players)) {
      data.loopSettings[key] = ps.loopSettings;
      data.sequences[key] = ps.sequence.map(b => b.partIndex);
      data.downloadFormats[key] = ps.downloadFormat || 'wav';
      data.downloadFormats[`${key}__parts`] = ps.partDownloadFormats || {};
    }
    localStorage.setItem(getSessionKey(), JSON.stringify(data));
  } catch(e) {}
}

function loadSession() {
  try {
    let raw = localStorage.getItem(getSessionKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const mp3Saved = parsed?.encoding?.mp3 || {};
    const oggSaved = parsed?.encoding?.ogg || {};
    parsed.encoding = {
      mp3: {
        bitrateKbps: [96, 128, 160, 192, 224, 256, 320].includes(Number(mp3Saved.bitrateKbps))
          ? Number(mp3Saved.bitrateKbps)
          : 192,
        sampleRateMode: ['source', '44100', '48000'].includes(mp3Saved.sampleRateMode)
          ? mp3Saved.sampleRateMode
          : '44100',
        channels: ['auto', 'mono', 'stereo'].includes(mp3Saved.channels)
          ? mp3Saved.channels
          : 'auto',
      },
      ogg: {
        quality: Number.isFinite(Number(oggSaved.quality))
          ? Math.max(0, Math.min(1, Number(oggSaved.quality)))
          : 0.5,
        sampleRateMode: ['source', '44100', '48000'].includes(oggSaved.sampleRateMode)
          ? oggSaved.sampleRateMode
          : 'source',
        channels: ['auto', 'mono', 'stereo'].includes(oggSaved.channels)
          ? oggSaved.channels
          : 'auto',
      },
    };
    const wm = parsed.waveformMaxPartDurationSec;
    const wn = Number(wm);
    if (wm === undefined || wm === null || !Number.isFinite(wn)) {
      parsed.waveformMaxPartDurationSec = 20;
    } else {
      parsed.waveformMaxPartDurationSec = Math.min(86400, Math.max(0, wn));
    }
    const sp = parsed.seamPreviewMs;
    const spn = Number(sp);
    if (sp === undefined || sp === null || !Number.isFinite(spn)) {
      parsed.seamPreviewMs = 2000;
    } else {
      parsed.seamPreviewMs = Math.min(60000, Math.max(50, Math.round(spn)));
    }
    const pg = parsed.playground;
    if (pg && typeof pg === 'object') {
      const df = (pg.downloadFormat || 'wav').toLowerCase();
      parsed.playground = {
        mode: !!pg.mode,
        zoom: Number.isFinite(Number(pg.zoom)) ? Math.min(4, Math.max(0.12, Number(pg.zoom))) : 1,
        panX: Number.isFinite(Number(pg.panX)) ? Number(pg.panX) : 0,
        panY: Number.isFinite(Number(pg.panY)) ? Number(pg.panY) : 0,
        bricks: Array.isArray(pg.bricks) ? pg.bricks : [],
        downloadFormat: df === 'mp3' || df === 'ogg' ? df : 'wav',
      };
    }
    return parsed;
  } catch(e) { return null; }
}
