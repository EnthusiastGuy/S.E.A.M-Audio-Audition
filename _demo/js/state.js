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
};

// Part sheets currently open
const openPartSheets = new Set();

// ─── PART COLORS ─────────────────────────────────────────────
const PART_COLORS = [
  '#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#cc96ff',
  '#f5a623','#4ecdc4','#ff9f43','#a8dadc','#e94560'
];
function partColor(idx) { return PART_COLORS[idx % PART_COLORS.length]; }

// ─── TIME FORMAT ─────────────────────────────────────────────
function fmtTime(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function fmtTimeHundredths(secs) {
  if (!isFinite(secs) || secs < 0) return '00:00:00';
  const totalHundredths = Math.floor(secs * 100);
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}:${String(hundredths).padStart(2,'0')}`;
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
    return parsed;
  } catch(e) { return null; }
}
