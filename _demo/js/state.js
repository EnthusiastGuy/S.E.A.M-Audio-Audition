/* =============================================================
   S.E.A.M Audio Audition — Global State, Audio Context & Utilities
   ============================================================= */

'use strict';

// ─── Global AudioContext ─────────────────────────────────────
const AC = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = AC.createGain();
masterGain.connect(AC.destination);

// ─── State ───────────────────────────────────────────────────
const STATE = {
  rootDir: null,
  formats: ['wav'],
  currentFormat: 'wav',
  songs: { wav: [] },
  order: { wav: [] },
  crossfade: 0,
  speedPercent: 100,
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
    return JSON.parse(raw);
  } catch(e) { return null; }
}
