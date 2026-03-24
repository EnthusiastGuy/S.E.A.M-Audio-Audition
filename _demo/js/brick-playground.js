/* =============================================================
   S.E.A.M Audio Audition — Brick Playground (Lego timeline)
   ============================================================= */

'use strict';

const BP_BRICK_H = 42;
const BP_PX_PER_SEC = 34;
const BP_MIN_W = 48;
const BP_MAX_W = 300;
const BP_SNAP = 18;
const BP_Y_ALIGN = 20;
const BP_PAD = 4;
const BP_GRID_W = 560;
const BP_ORIGIN_X = 32;
const BP_ORIGIN_Y = 40;
const BP_SCATTER = 420;
/** Min gap between brick edges after break so they stay out of magnet snap range (see ufRebuild). */
const BP_BREAK_GAP = Math.max(BP_SNAP + 10, 28);
/** Vertical “comb” spine width; teeth (template bricks) sit to the right with wide gaps. */
const BP_COMB_SPINE_W = 22;
const BP_COMB_TOOTH_GAP = 38;
const BP_COMB_ROW_GAP = 52;
/** Screen pixels: drag farther than this on a template brick spawns a duplicate; shorter gesture = select only. */
const BP_COMB_DUP_THRESHOLD_PX = 5;
const BP_UNDO_MAX = 50;

const PG_SEAM_SCHEDULE_AHEAD = 0.005;
const PG_SEAM_FF_TARGET_WALL_SEC = 0.85;
const PG_SEAM_FF_GAIN = 0.2;

const BP_PLAY_ICON = '&#9654;';
const BP_PAUSE_ICON = '&#9646;&#9646;';
const BP_LOOP_ICON = `${BP_PLAY_ICON}<span class="part-loop-glyph" aria-hidden="true">&#8635;</span>`;
const BP_SEAM_ICON = `${BP_PLAY_ICON}<span class="part-loop-glyph part-seam-glyph" aria-hidden="true">&#8635;</span>`;
const BP_DL_ICON = '&#128229;';
const BP_BREAK_MAGNET_SVG = `<svg class="bp-icon-svg bp-break-icon" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M5.5 3C4 3 3 4.2 3 5.8V11c0 3.2 2.4 5.8 5.5 5.8.6 0 1.1-.1 1.6-.3l-.9-1.4c-.2 0-.4.1-.7.1-2 0-3.5-1.6-3.5-3.8V5.8c0-.7.5-1.2 1.2-1.2.4 0 .7.2.9.5l1-.9C7.4 3.4 6.5 3 5.5 3z"/><path fill="currentColor" d="M14.5 3C16 3 17 4.2 17 5.8V11c0 3.2-2.4 5.8-5.5 5.8-.6 0-1.1-.1-1.6-.3l.9-1.4c.2 0 .4.1.7.1 2 0 3.5-1.6 3.5-3.8V5.8c0-.7-.5-1.2-1.2-1.2-.4 0-.7.2-.9.5l-1-.9c.7-.6 1.6-1 2.6-1z"/><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" d="M8.2 8.5l3.6 3m0-3l-3.6 3"/></svg>`;

let bpViewport = null;
let bpWorld = null;
let bpHudRoot = null;
let combsLayer = null;
let bricksLayer = null;

/** @type {Map<string, { key: string, fmt: string, songIdx: number, x: number, y: number, el: HTMLElement|null }>} */
const combMap = new Map();

/** @type {Map<string, { id: string, fmt: string, songIdx: number, partIndex: number, x: number, y: number, width: number, height: number, el: HTMLElement }>} */
const brickMap = new Map();
const ufParent = new Map();

let bpZoom = 1;
let bpPanX = 0;
let bpPanY = 0;

let dragClusterIds = [];
let dragPointerId = null;
let dragOffX = 0;
let dragOffY = 0;
/** @type {Map<string, { x: number, y: number }>|null} */
let dragStartPos = null;
let panPointerId = null;
let panStartClientX = 0;
let panStartClientY = 0;
let panStartPanX = 0;
let panStartPanY = 0;

let activeBrickId = null;
let saveTimer = null;
let clusterUiEl = null;
let playingRoot = null;
let playLoop = false;
let pgSeamMode = false;
/** @type {Array<{ b: object, buf: AudioBuffer }>|null} */
let pgSeamSegments = null;
/** @type {number[]|null} */
let pgSeamCumDurations = null;
let pgSeamTick = {
  phase: 'head',
  phaseStartAC: 0,
  phaseStartLogical: 0,
  edge: 0,
  ffWallDur: 0,
  ffLogicalSpan: 0,
};

/** @type {Array<Array<{ id: string, fmt: string, songIdx: number, partIndex: number, x: number, y: number }>>} */
let bpUndoStack = [];
/** @type {Array<Array<{ id: string, fmt: string, songIdx: number, partIndex: number, x: number, y: number }>>} */
let bpRedoStack = [];

let pgGain = null;
/** @type {GainNode|null} Per-chain bus so loop iterations do not stack connections on pgGain. */
let pgPlayBus = null;
/** @type {GainNode|null} Seam preview: one bus per session; FF gain rides here so we do not stack automation on pgGain. */
let pgSeamBus = null;
/** Monotonic token: incremented on new transport or full stop; invalidates stale BufferSource onended. */
let pgTransportToken = 0;
/** @type {AudioBufferSourceNode[]} */
let pgSources = [];
let pgRaf = 0;
let pgTimelineStartAC = 0;
let pgTimelineOffset = 0;
let pgSortedBricks = [];
let pgTotalDur = 0;
/** Segment buffer durations in play order (normal + seam cluster playback). */
let pgSegmentDur = null;
/** Last timeline segment index (for transition flash); null until first tick. */
let pgLastSegFlashIdx = null;

function ensurePlaygroundGain() {
  if (!pgGain) {
    pgGain = AC.createGain();
    pgGain.gain.value = 1;
    pgGain.connect(masterGain);
  }
  return pgGain;
}

function bpBrickWidthForDur(sec) {
  const d = Number(sec) > 0 ? Number(sec) : 1;
  return Math.min(BP_MAX_W, Math.max(BP_MIN_W, d * BP_PX_PER_SEC));
}

function bpGetPartDuration(fmt, songIdx, partIndex) {
  const ps = STATE.players[`${fmt}_${songIdx}`];
  if (!ps) return 1;
  if (ps.partDurations && ps.partDurations[partIndex] > 0) return ps.partDurations[partIndex];
  const song = STATE.songs[fmt]?.[songIdx];
  if (!song) return 1;
  if (partIndex === -1) return song._mainFileDur || song.duration || 1;
  return song.parts[partIndex]?._dur || 1;
}

function bpPartLabel(fmt, songIdx, partIndex) {
  const song = STATE.songs[fmt]?.[songIdx];
  if (!song) return '?';
  if (partIndex === -1) return 'Full';
  const p = song.parts[partIndex];
  return p ? String(p.num) : String(partIndex);
}

function bpPartKey(fmt, songIdx, partIndex) {
  return `${fmt}_${songIdx}_${partIndex}`;
}

function bpCanonicalBrickId(fmt, songIdx, partIndex) {
  return `bp_${fmt}_${songIdx}_${partIndex}`;
}

function bpSongKey(fmt, songIdx) {
  return `${fmt}_${songIdx}`;
}

/** Canonical parking-lot template bricks (one per part); duplicates have different ids. */
function bpIsCombTemplateBrick(b) {
  return b.id === bpCanonicalBrickId(b.fmt, b.songIdx, b.partIndex);
}

function groupDescriptorsBySong(descriptors) {
  const order = [];
  const map = new Map();
  for (const d of descriptors) {
    const k = bpSongKey(d.fmt, d.songIdx);
    if (!map.has(k)) {
      order.push(k);
      map.set(k, []);
    }
    map.get(k).push(d);
  }
  return { order, map };
}

function bpCountPartKey(key) {
  let n = 0;
  for (const b of brickMap.values()) {
    if (bpPartKey(b.fmt, b.songIdx, b.partIndex) === key) n++;
  }
  return n;
}

function bpClusterHasRemovableDuplicates(root) {
  const seen = new Set();
  for (const id of clusterMembers(root)) {
    const b = brickMap.get(id);
    if (!b) continue;
    const key = bpPartKey(b.fmt, b.songIdx, b.partIndex);
    if (seen.has(key)) continue;
    seen.add(key);
    if (bpCountPartKey(key) > 1) return true;
  }
  return false;
}

function bpTryDeleteActiveBrick() {
  if (!activeBrickId) return;
  const root = ufFind(activeBrickId);
  const ids = clusterMembers(root).filter(id => !brickMap.get(id)?.combTemplate);
  if (ids.length === 0) return;
  const snap = capturePlaygroundBrickSnapshot();
  for (const id of ids) {
    const b = brickMap.get(id);
    if (!b) continue;
    brickMap.delete(id);
    b.el.remove();
  }
  bpPushUndo(snap);
  ufRebuild();
  stopPlaygroundPlayback();
  if (activeBrickId && !brickMap.has(activeBrickId)) {
    activeBrickId = brickMap.size ? brickMap.keys().next().value : null;
  }
  scheduleSave();
  updateClusterUi();
}

function bpDeleteDuplicatesInCluster(root) {
  const snap = capturePlaygroundBrickSnapshot();
  const ids = clusterMembers(root);
  const items = ids
    .map(id => brickMap.get(id))
    .filter(Boolean)
    .map(b => ({
      b,
      key: bpPartKey(b.fmt, b.songIdx, b.partIndex),
      extra: b.id !== bpCanonicalBrickId(b.fmt, b.songIdx, b.partIndex),
    }))
    .sort((a, b) => Number(b.extra) - Number(a.extra) || a.b.id.localeCompare(b.b.id));

  let removed = false;
  for (const { b, key } of items) {
    if (bpCountPartKey(key) <= 1) continue;
    brickMap.delete(b.id);
    b.el.remove();
    removed = true;
  }
  if (!removed) return;
  bpPushUndo(snap);
  ufRebuild();
  stopPlaygroundPlayback();
  if (activeBrickId && !brickMap.has(activeBrickId)) {
    activeBrickId = brickMap.size ? brickMap.keys().next().value : null;
  }
  scheduleSave();
  updateClusterUi();
}

function ufFind(a) {
  if (!ufParent.has(a)) ufParent.set(a, a);
  let p = ufParent.get(a);
  if (p !== a) {
    p = ufFind(p);
    ufParent.set(a, p);
  }
  return p;
}

function ufUnion(a, b) {
  const ra = ufFind(a);
  const rb = ufFind(b);
  if (ra !== rb) ufParent.set(ra, rb);
}

function ufRebuild() {
  ufParent.clear();
  for (const id of brickMap.keys()) ufParent.set(id, id);
  const list = [...brickMap.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i];
      const B = list[j];
      if (A.combTemplate || B.combTemplate) continue;
      const vOverlap = Math.min(A.y + A.height, B.y + B.height) - Math.max(A.y, B.y);
      if (vOverlap < 10) continue;
      const gapL = B.x - (A.x + A.width);
      const gapR = A.x - (B.x + B.width);
      if (gapL >= -2 && gapL < 5) ufUnion(A.id, B.id);
      else if (gapR >= -2 && gapR < 5) ufUnion(A.id, B.id);
    }
  }
}

function clusterMembers(root) {
  const out = [];
  const canonical = ufFind(root);
  for (const id of brickMap.keys()) {
    if (ufFind(id) === canonical) out.push(id);
  }
  return out;
}

function clusterBBox(ids) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const b = brickMap.get(id);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function screenToWorld(clientX, clientY) {
  const rect = bpViewport.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  return { x: (sx - bpPanX) / bpZoom, y: (sy - bpPanY) / bpZoom };
}

function shiftCluster(ids, dx, dy) {
  for (const id of ids) {
    const b = brickMap.get(id);
    if (!b) continue;
    b.x += dx;
    b.y += dy;
    b.el.style.transform = `translate(${b.x}px,${b.y}px)`;
  }
}

function snapClusterToNeighbors(movedIds) {
  const cluster = new Set(movedIds);
  let guard = 0;
  while (guard++ < 8) {
    let bestScore = Infinity;
    let bestDx = 0;
    let bestDy = 0;
    for (const mid of movedIds) {
      const b = brickMap.get(mid);
      if (!b) continue;
      for (const ob of brickMap.values()) {
        if (cluster.has(ob.id)) continue;
        if (ob.combTemplate) continue;
        const yDist = Math.abs(b.y - ob.y);
        if (yDist > BP_BRICK_H + BP_SNAP) continue;
        const gapR = ob.x - (b.x + b.width);
        if (gapR >= -3 && gapR < BP_SNAP) {
          const score = Math.abs(gapR) + yDist * 0.3;
          if (score < bestScore) {
            bestScore = score;
            bestDx = gapR;
            bestDy = ob.y - b.y;
          }
        }
        const gapL = b.x - (ob.x + ob.width);
        if (gapL >= -3 && gapL < BP_SNAP) {
          const score = Math.abs(gapL) + yDist * 0.3;
          if (score < bestScore) {
            bestScore = score;
            bestDx = -gapL;
            bestDy = ob.y - b.y;
          }
        }
      }
    }
    if (bestScore >= BP_SNAP * 2) break;
    if (Math.abs(bestDx) < 0.05 && Math.abs(bestDy) < 0.05) break;
    shiftCluster(movedIds, bestDx, bestDy);
    playSnapSound();
  }
}

function playSnapSound() {
  const t = AC.currentTime;
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(880, t);
  o.frequency.exponentialRampToValueAtTime(1320, t + 0.04);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.045, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  o.connect(g);
  g.connect(ensurePlaygroundGain());
  o.start(t);
  o.stop(t + 0.08);
}

function playBreakSound() {
  const t = AC.currentTime;
  const len = 0.14;
  const buf = AC.createBuffer(1, AC.sampleRate * len, AC.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.35;
  }
  const src = AC.createBufferSource();
  src.buffer = buf;
  const g = AC.createGain();
  g.gain.value = 0.5;
  src.connect(g);
  g.connect(ensurePlaygroundGain());
  src.start(t);
}

function playClickUiSound() {
  const t = AC.currentTime;
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.frequency.value = 620;
  g.gain.setValueAtTime(0.035, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g);
  g.connect(ensurePlaygroundGain());
  o.start(t);
  o.stop(t + 0.06);
}

function stopPlaygroundSourcesOnly() {
  for (const s of pgSources) {
    try {
      s.stop();
    } catch (e) {}
    try {
      s.disconnect();
    } catch (e) {}
  }
  pgSources = [];
  if (pgPlayBus) {
    try {
      pgPlayBus.disconnect();
    } catch (e) {}
    pgPlayBus = null;
  }
  if (pgSeamBus) {
    try {
      pgSeamBus.disconnect();
    } catch (e) {}
    pgSeamBus = null;
  }
  if (pgRaf) cancelAnimationFrame(pgRaf);
  pgRaf = 0;
  pgSeamMode = false;
  pgSeamSegments = null;
  pgSeamCumDurations = null;
  if (clusterUiEl) {
    clusterUiEl.querySelector('.bp-seek-track')?.classList.remove('bp-seek-seam-ff');
  }
  if (pgGain) {
    try {
      const t = AC.currentTime;
      pgGain.gain.cancelScheduledValues(t);
      pgGain.gain.setValueAtTime(1, t);
    } catch (e) {}
  }
}

function stopPlaygroundPlayback() {
  stopPlaygroundSourcesOnly();
  pgTransportToken++;
  playingRoot = null;
  pgSegmentDur = null;
  pgLastSegFlashIdx = null;
  updateClusterUi();
}

function computePgSeamEdgeSec(dur) {
  const raw = (STATE.seamPreviewMs ?? 2000) / 1000;
  if (!dur || dur <= 0 || !Number.isFinite(dur)) return 0;
  return Math.min(raw, dur / 2);
}

function schedulePgSeamGain(linearGain, atAC) {
  const node = pgSeamBus || pgGain;
  if (!node) return;
  const t = AC.currentTime;
  node.gain.cancelScheduledValues(t);
  node.gain.setValueAtTime(linearGain, Math.max(atAC, t));
}

/** Seam mode uses one active BufferSource at a time; disconnect ended nodes so they do not stack on the bus. */
function clearPgSeamPhaseSources() {
  if (!pgSeamMode) return;
  for (const s of pgSources) {
    try {
      s.stop();
    } catch (e) {}
    try {
      s.disconnect();
    } catch (e) {}
  }
  pgSources = [];
}

function setBpSeamSeekFfClass(on) {
  if (!clusterUiEl) return;
  const tr = clusterUiEl.querySelector('.bp-seek-track');
  if (tr) tr.classList.toggle('bp-seek-seam-ff', !!on);
}

function schedulePgSeamHead(segments, segIdx, clusterRoot) {
  clearPgSeamPhaseSources();
  const buf = segments[segIdx].buf;
  const dur = buf.duration;
  const edgeSec = computePgSeamEdgeSec(dur);
  const audRate = Math.max(1e-6, Math.abs(playbackRateFromKnob()));
  const cum = pgSeamCumDurations[segIdx];
  const startAt = AC.currentTime + PG_SEAM_SCHEDULE_AHEAD;
  const g = pgSeamBus;
  if (!g) return;

  setBpSeamSeekFfClass(false);

  if (!buf.duration || buf.duration < 1e-4) {
    const next = (segIdx + 1) % segments.length;
    schedulePgSeamHead(segments, next, clusterRoot);
    return;
  }

  const rem = dur - 2 * edgeSec;
  if (rem <= 1e-6) {
    schedulePgSeamTail(segments, segIdx, clusterRoot);
    return;
  }

  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = audRate;
  src.connect(g);
  pgSources.push(src);
  schedulePgSeamGain(1, startAt);
  pgSeamTick = {
    phase: 'head',
    phaseStartAC: startAt,
    phaseStartLogical: cum,
    edge: edgeSec,
    ffWallDur: 0,
    ffLogicalSpan: 0,
  };
  pgTimelineStartAC = startAt;
  pgTimelineOffset = cum;

  const headWall = edgeSec / audRate;
  src.start(startAt, 0);
  try {
    src.stop(startAt + headWall);
  } catch (e) {}

  src.onended = () => {
    if (!pgSources.includes(src) || !pgSeamMode) return;
    schedulePgSeamFF(segments, segIdx, clusterRoot);
  };
}

function schedulePgSeamFF(segments, segIdx, clusterRoot) {
  clearPgSeamPhaseSources();
  const buf = segments[segIdx].buf;
  const dur = buf.duration;
  const edgeSec = computePgSeamEdgeSec(dur);
  const rem = dur - 2 * edgeSec;
  const cum = pgSeamCumDurations[segIdx];
  const ffRate = Math.min(64, Math.max(8, rem / PG_SEAM_FF_TARGET_WALL_SEC));
  const startAt = AC.currentTime + PG_SEAM_SCHEDULE_AHEAD;
  const g = pgSeamBus;
  if (!g) return;

  setBpSeamSeekFfClass(true);

  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = ffRate;
  src.connect(g);
  pgSources.push(src);
  schedulePgSeamGain(PG_SEAM_FF_GAIN, startAt);

  const wallFF = rem / ffRate;
  pgSeamTick = {
    phase: 'ff',
    phaseStartAC: startAt,
    phaseStartLogical: cum + edgeSec,
    edge: edgeSec,
    ffWallDur: wallFF,
    ffLogicalSpan: rem,
  };
  pgTimelineStartAC = startAt;
  pgTimelineOffset = cum + edgeSec;

  src.start(startAt, edgeSec);
  try {
    src.stop(startAt + wallFF);
  } catch (e) {}

  src.onended = () => {
    if (!pgSources.includes(src) || !pgSeamMode) return;
    schedulePgSeamTail(segments, segIdx, clusterRoot);
  };
}

function schedulePgSeamTail(segments, segIdx, clusterRoot) {
  clearPgSeamPhaseSources();
  const buf = segments[segIdx].buf;
  const dur = buf.duration;
  const edgeSec = computePgSeamEdgeSec(dur);
  const audRate = Math.max(1e-6, Math.abs(playbackRateFromKnob()));
  const cum = pgSeamCumDurations[segIdx];
  const tailOffset = Math.max(0, dur - edgeSec);
  const startAt = AC.currentTime + PG_SEAM_SCHEDULE_AHEAD;
  const g = pgSeamBus;
  if (!g) return;

  setBpSeamSeekFfClass(false);

  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = audRate;
  src.connect(g);
  pgSources.push(src);
  schedulePgSeamGain(1, startAt);

  const tailWall = edgeSec / audRate;
  pgSeamTick = {
    phase: 'tail',
    phaseStartAC: startAt,
    phaseStartLogical: cum + dur - edgeSec,
    edge: edgeSec,
    ffWallDur: 0,
    ffLogicalSpan: 0,
  };
  pgTimelineStartAC = startAt;
  pgTimelineOffset = cum + dur - edgeSec;

  src.start(startAt, tailOffset);
  try {
    src.stop(startAt + tailWall);
  } catch (e) {}

  src.onended = () => {
    if (!pgSources.includes(src) || !pgSeamMode) return;
    const next = (segIdx + 1) % segments.length;
    schedulePgSeamHead(segments, next, clusterRoot);
  };
}

function scheduleClusterSeamPlay(sorted, clusterRoot) {
  stopPlaygroundSourcesOnly();
  playingRoot = clusterRoot;
  playLoop = false;

  const segments = [];
  for (const b of sorted) {
    const buf = STATE.players[`${b.fmt}_${b.songIdx}`]?.buffers[b.partIndex];
    if (buf) segments.push({ b, buf });
  }
  if (segments.length === 0) {
    playingRoot = null;
    updateClusterUi();
    return;
  }

  pgSortedBricks = sorted;
  pgTotalDur = segments.reduce((s, x) => s + x.buf.duration, 0);
  const cumDurations = [];
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    cumDurations.push(acc);
    acc += segments[i].buf.duration;
  }
  pgSeamSegments = segments;
  pgSeamCumDurations = cumDurations;
  pgSeamMode = true;
  pgSegmentDur = segments.map(s => s.buf.duration);
  pgLastSegFlashIdx = null;

  pgSeamBus = AC.createGain();
  pgSeamBus.gain.value = 1;
  pgSeamBus.connect(ensurePlaygroundGain());

  schedulePgSeamHead(segments, 0, clusterRoot);
}

function scheduleClusterPlayFromOffset(sorted, offsetSec, loop, clusterRoot) {
  stopPlaygroundSourcesOnly();
  playingRoot = clusterRoot;
  playLoop = loop;
  const transportToken = ++pgTransportToken;

  const segments = [];
  for (const b of sorted) {
    const buf = STATE.players[`${b.fmt}_${b.songIdx}`]?.buffers[b.partIndex];
    if (buf) segments.push({ b, buf });
  }
  if (segments.length === 0) {
    playingRoot = null;
    updateClusterUi();
    return;
  }

  pgSortedBricks = sorted;
  pgTotalDur = segments.reduce((s, x) => s + x.buf.duration, 0);
  pgSegmentDur = segments.map(s => s.buf.duration);
  pgLastSegFlashIdx = null;
  const offsetClamped = Math.min(Math.max(0, offsetSec), Math.max(0, pgTotalDur - 1e-9));

  const rate = playbackRateFromKnob();
  const absR = Math.max(1e-6, Math.abs(rate));
  const outGain = ensurePlaygroundGain();

  function findStart(totalOff) {
    let w = 0;
    for (let i = 0; i < segments.length; i++) {
      const dur = segments[i].buf.duration;
      if (w + dur > totalOff + 1e-9) {
        return { startIdx: i, innerOff: totalOff - w };
      }
      w += dur;
    }
    const last = segments.length - 1;
    return { startIdx: last, innerOff: Math.max(0, segments[last].buf.duration - 1e-6) };
  }

  function playFrom(totalOff) {
    stopPlaygroundSourcesOnly();
    if (transportToken !== pgTransportToken) return;

    const bus = AC.createGain();
    bus.gain.value = 1;
    bus.connect(outGain);
    pgPlayBus = bus;

    const { startIdx, innerOff } = findStart(totalOff);
    pgTimelineOffset = totalOff;
    pgTimelineStartAC = AC.currentTime;
    let sched = AC.currentTime + 0.05;
    let lastSrc = null;
    for (let i = startIdx; i < segments.length; i++) {
      const buf = segments[i].buf;
      const src = AC.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(bus);
      const off = i === startIdx ? Math.max(0, innerOff) : 0;
      const wall = (buf.duration - off) / absR;
      src.start(sched, off);
      pgSources.push(src);
      sched += wall;
      lastSrc = src;
    }
    if (lastSrc) {
      lastSrc.onended = () => {
        if (transportToken !== pgTransportToken) return;
        if (!pgSources.length || pgSources[pgSources.length - 1] !== lastSrc) return;
        if (loop) {
          playFrom(0);
        } else {
          stopPlaygroundPlayback();
        }
      };
    }
    tickPlaygroundSeek();
  }

  playFrom(offsetClamped);
}

/** Same pulse as seekbar `brick-preview-flash` (seekbar.css); self-contained so script order does not matter. */
function bpTriggerBrickPlaygroundFlash(flashEl) {
  if (!flashEl) return;
  flashEl.classList.remove('brick-preview-flash--pulse');
  void flashEl.offsetWidth;
  flashEl.classList.add('brick-preview-flash--pulse');
  const onEnd = () => {
    flashEl.classList.remove('brick-preview-flash--pulse');
    flashEl.removeEventListener('animationend', onEnd);
  };
  flashEl.addEventListener('animationend', onEnd);
}

function playgroundSegmentIndexForTimelinePos(pos) {
  if (!pgSegmentDur || !pgSegmentDur.length) return -1;
  const td = Math.max(0, pgTotalDur);
  if (td <= 0) return -1;
  const p = Math.max(0, Math.min(pos, td - 1e-9));
  let acc = 0;
  for (let i = 0; i < pgSegmentDur.length; i++) {
    const end = acc + pgSegmentDur[i];
    if (p < end - 1e-9 || i === pgSegmentDur.length - 1) return i;
    acc = end;
  }
  return pgSegmentDur.length - 1;
}

function tickPlaygroundSeek() {
  if (!playingRoot || !clusterUiEl) return;
  const seekFill = clusterUiEl.querySelector('.bp-seek-fill');
  const seekHandle = clusterUiEl.querySelector('.bp-seek-handle');
  if (!seekFill || !seekHandle) return;
  const rate = Math.max(1e-6, Math.abs(playbackRateFromKnob()));
  let pos;
  if (pgSeamMode) {
    const t = (AC.currentTime - pgSeamTick.phaseStartAC) * rate;
    if (pgSeamTick.phase === 'head' || pgSeamTick.phase === 'tail') {
      pos = pgSeamTick.phaseStartLogical + Math.min(t, pgSeamTick.edge);
    } else if (pgSeamTick.phase === 'ff') {
      const frac = pgSeamTick.ffWallDur > 1e-9 ? Math.min(1, t / pgSeamTick.ffWallDur) : 1;
      pos = pgSeamTick.phaseStartLogical + frac * pgSeamTick.ffLogicalSpan;
    } else {
      pos = 0;
    }
    pos = Math.min(pos, pgTotalDur);
  } else {
    const elapsed = (AC.currentTime - pgTimelineStartAC) * rate;
    pos = Math.min(pgTimelineOffset + elapsed, pgTotalDur);
  }
  const pct = pgTotalDur > 0 ? (pos / pgTotalDur) * 100 : 0;
  seekFill.style.width = `${pct}%`;
  seekHandle.style.left = `${pct}%`;

  const segIdx = playgroundSegmentIndexForTimelinePos(pos);
  if (pgLastSegFlashIdx !== null && segIdx >= 0 && segIdx !== pgLastSegFlashIdx) {
    const b = pgSortedBricks[segIdx];
    if (b?.el) {
      const flashEl = b.el.querySelector('.brick-preview-flash');
      bpTriggerBrickPlaygroundFlash(flashEl);
    }
  }
  if (segIdx >= 0) pgLastSegFlashIdx = segIdx;

  if (pgSeamMode) {
    pgRaf = requestAnimationFrame(tickPlaygroundSeek);
  } else if (pos < pgTotalDur - 0.03 || playLoop) {
    pgRaf = requestAnimationFrame(tickPlaygroundSeek);
  } else if (!playLoop) {
    stopPlaygroundPlayback();
  }
}

async function bpPlayCluster(root, loop) {
  const ids = clusterMembers(root);
  if (ids.length === 0) return;
  await Promise.all(
    ids.map(id => {
      const b = brickMap.get(id);
      return loadPartBuffer(b.fmt, b.songIdx, b.partIndex);
    })
  );
  const sorted = [...ids]
    .map(id => brickMap.get(id))
    .filter(Boolean)
    .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));
  activeBrickId = sorted[0]?.id || null;
  scheduleClusterPlayFromOffset(sorted, 0, loop, root);
  updateClusterUi();
  playClickUiSound();
}

async function bpPlayClusterSeam(root) {
  const ids = clusterMembers(root);
  if (ids.length === 0) return;
  await Promise.all(
    ids.map(id => {
      const b = brickMap.get(id);
      return loadPartBuffer(b.fmt, b.songIdx, b.partIndex);
    })
  );
  const sorted = [...ids]
    .map(id => brickMap.get(id))
    .filter(Boolean)
    .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));
  if (playingRoot === root && pgSeamMode && pgSources.length > 0) {
    stopPlaygroundPlayback();
    return;
  }
  activeBrickId = sorted[0]?.id || null;
  scheduleClusterSeamPlay(sorted, root);
  updateClusterUi();
  playClickUiSound();
}

function bpRectsOverlap(a, b) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function bpBreakClusterRowOverlapsExternals(sorted, idSet) {
  for (const b of sorted) {
    for (const ob of brickMap.values()) {
      if (idSet.has(ob.id)) continue;
      if (bpRectsOverlap(b, ob)) return true;
    }
  }
  return false;
}

function bpBreakCluster(root) {
  const ids = clusterMembers(root).filter(id => !brickMap.get(id)?.combTemplate);
  if (ids.length === 0) return;
  const snap = capturePlaygroundBrickSnapshot();
  playBreakSound();
  for (const id of ids) ufParent.set(id, id);
  const sorted = ids
    .map(id => brickMap.get(id))
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);
  const rowY = sorted.reduce((m, b) => Math.min(m, b.y), Infinity);
  const idSet = new Set(ids);
  let x = sorted.reduce((m, b) => Math.min(m, b.x), Infinity);
  for (const b of sorted) {
    b.x = x;
    b.y = rowY;
    x += b.width + BP_BREAK_GAP;
  }
  let step = 0;
  while (bpBreakClusterRowOverlapsExternals(sorted, idSet) && step++ < 400) {
    const dx = 12;
    for (const b of sorted) {
      b.x += dx;
    }
  }
  for (const b of sorted) {
    b.el.style.transform = `translate(${b.x}px,${b.y}px)`;
  }
  ufRebuild();
  scheduleSave();
  updateClusterUi();
  bpPushUndo(snap);
}

function bpBreakAll() {
  const snap = capturePlaygroundBrickSnapshot();
  playBreakSound();
  for (const id of brickMap.keys()) ufParent.set(id, id);
  const all = [...brickMap.values()];
  for (const b of all) {
    if (b.combTemplate) continue;
    b.x += (Math.random() - 0.5) * BP_SCATTER * 1.2;
    b.y += (Math.random() - 0.5) * BP_SCATTER * 1.2;
    b.el.style.transform = `translate(${b.x}px,${b.y}px)`;
  }
  ufRebuild();
  scheduleSave();
  updateClusterUi();
  bpPushUndo(snap);
}

async function bpDownloadCluster(root) {
  const ids = clusterMembers(root);
  if (ids.length === 0) return;
  await Promise.all(
    ids.map(id => {
      const b = brickMap.get(id);
      return loadPartBuffer(b.fmt, b.songIdx, b.partIndex);
    })
  );
  const sorted = [...ids]
    .map(id => brickMap.get(id))
    .filter(Boolean)
    .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));
  const bufs = sorted
    .map(b => STATE.players[`${b.fmt}_${b.songIdx}`]?.buffers[b.partIndex])
    .filter(Boolean);
  if (bufs.length === 0) return;
  const channels = bufs.reduce((m, x) => Math.max(m, x.numberOfChannels), 1);
  const sampleRate = AC.sampleRate;
  const totalDur = bufs.reduce((s, b) => s + b.duration, 0);
  const frameCount = Math.max(1, Math.ceil(totalDur * sampleRate));
  const offline = new OfflineAudioContext(channels, frameCount, sampleRate);
  let off = 0;
  for (const buf of bufs) {
    const src = offline.createBufferSource();
    src.buffer = buf;
    src.connect(offline.destination);
    src.start(off);
    off += buf.duration;
  }
  const rendered = await offline.startRendering();
  const fmt = (STATE.playground.downloadFormat || 'wav').toLowerCase();
  let blob = null;
  let ext = 'wav';
  if (fmt === 'mp3') {
    blob = await audioBufferToMp3Blob(rendered);
    ext = 'mp3';
  } else if (fmt === 'ogg') {
    blob = await audioBufferToOggBlob(rendered);
    ext = 'ogg';
  } else {
    blob = audioBufferToWavBlob(rendered);
    ext = 'wav';
  }
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = sanitizeFileName(`playground-mix-${Date.now()}.${ext}`) || `playground-mix.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
  playClickUiSound();
}

function cyclePlaygroundDownloadFormat() {
  const order = ['wav', 'mp3', 'ogg'];
  const cur = (STATE.playground.downloadFormat || 'wav').toLowerCase();
  const i = order.indexOf(cur);
  const next = order[(i + 1) % order.length];
  STATE.playground.downloadFormat = next;
  saveSession();
  return next;
}

function updateWorldTransform() {
  if (!bpWorld) return;
  bpWorld.style.transform = `translate(${bpPanX}px, ${bpPanY}px) scale(${bpZoom})`;
  bpWorld.style.transformOrigin = '0 0';
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistPlaygroundBricks();
    saveSession();
  }, 320);
}

function persistPlaygroundBricks() {
  STATE.playground.zoom = bpZoom;
  STATE.playground.panX = bpPanX;
  STATE.playground.panY = bpPanY;
  if (!STATE.playground.downloadFormat) STATE.playground.downloadFormat = 'wav';
  STATE.playground.bricks = [...brickMap.values()].map(b => ({
    id: b.id,
    fmt: b.fmt,
    songIdx: b.songIdx,
    partIndex: b.partIndex,
    x: b.x,
    y: b.y,
  }));
  const combs = {};
  for (const [k, v] of combMap.entries()) {
    combs[k] = { x: v.x, y: v.y };
  }
  STATE.playground.combs = combs;
}

function collectDescriptors() {
  const fmt = 'wav';
  const out = [];
  const order = STATE.order[fmt] || [];
  for (const songIdx of order) {
    const song = STATE.songs[fmt][songIdx];
    if (!song) continue;
    if (song.mainHandle) {
      out.push({ fmt, songIdx, partIndex: -1, songName: song.name });
    }
    song.parts.forEach((_, pi) => {
      out.push({ fmt, songIdx, partIndex: pi, songName: song.name });
    });
  }
  return out;
}

function isBrickValid(b) {
  const song = STATE.songs[b.fmt]?.[b.songIdx];
  if (!song) return false;
  if (b.partIndex === -1) return !!song.mainHandle;
  return !!song.parts[b.partIndex];
}

function layoutDefaultCombBricks(descriptors) {
  const { order, map } = groupDescriptorsBySong(descriptors);
  const out = [];
  let row = 0;
  for (const k of order) {
    const parts = map.get(k);
    if (!parts || parts.length === 0) continue;
    const combX = BP_ORIGIN_X;
    const combY = BP_ORIGIN_Y + row * (BP_BRICK_H + BP_COMB_ROW_GAP);
    row++;
    let x = combX + BP_COMB_SPINE_W + BP_PAD;
    for (const d of parts) {
      const w = bpBrickWidthForDur(bpGetPartDuration(d.fmt, d.songIdx, d.partIndex));
      out.push({
        id: bpCanonicalBrickId(d.fmt, d.songIdx, d.partIndex),
        fmt: d.fmt,
        songIdx: d.songIdx,
        partIndex: d.partIndex,
        x,
        y: combY,
        width: w,
        combTemplate: true,
      });
      x += w + BP_COMB_TOOTH_GAP;
    }
  }
  return out;
}

function makeDuplicateBrickId(sourceId) {
  return `${sourceId}_d${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function capturePlaygroundBrickSnapshot() {
  return [...brickMap.values()].map(b => ({
    id: b.id,
    fmt: b.fmt,
    songIdx: b.songIdx,
    partIndex: b.partIndex,
    x: b.x,
    y: b.y,
  }));
}

function cloneBrickSnapshot(snap) {
  return snap.map(b => ({ ...b }));
}

function snapshotsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const mb = new Map(b.map(x => [x.id, x]));
  for (const x of a) {
    const y = mb.get(x.id);
    if (!y || x.x !== y.x || x.y !== y.y) return false;
  }
  return true;
}

function applyPlaygroundBrickSnapshot(snapshot) {
  stopPlaygroundPlayback();
  removeClusterUi();
  const layout = snapshot.map(b => ({
    id: b.id,
    fmt: b.fmt,
    songIdx: b.songIdx,
    partIndex: b.partIndex,
    x: b.x,
    y: b.y,
    width: bpBrickWidthForDur(bpGetPartDuration(b.fmt, b.songIdx, b.partIndex)),
  }));
  rebuildBrickDom(layout);
  if (activeBrickId && !brickMap.has(activeBrickId)) {
    activeBrickId = brickMap.size ? brickMap.keys().next().value : null;
  }
  scheduleSave();
  updateClusterUi();
}

function bpPushUndo(beforeSnapshot) {
  bpRedoStack.length = 0;
  bpUndoStack.push(cloneBrickSnapshot(beforeSnapshot));
  while (bpUndoStack.length > BP_UNDO_MAX) bpUndoStack.shift();
}

function bpUndo() {
  if (bpUndoStack.length === 0) return;
  const prev = bpUndoStack.pop();
  const current = capturePlaygroundBrickSnapshot();
  bpRedoStack.push(current);
  applyPlaygroundBrickSnapshot(prev);
}

function bpRedo() {
  if (bpRedoStack.length === 0) return;
  const next = bpRedoStack.pop();
  const current = capturePlaygroundBrickSnapshot();
  bpUndoStack.push(current);
  while (bpUndoStack.length > BP_UNDO_MAX) bpUndoStack.shift();
  applyPlaygroundBrickSnapshot(next);
}

function syncCombAnchorsFromTemplateBricks() {
  combMap.clear();
  const bySong = new Map();
  for (const b of brickMap.values()) {
    if (!b.combTemplate) continue;
    const k = bpSongKey(b.fmt, b.songIdx);
    if (!bySong.has(k)) bySong.set(k, []);
    bySong.get(k).push(b);
  }
  for (const [k, arr] of bySong) {
    let minX = Infinity;
    let minY = Infinity;
    for (const b of arr) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
    }
    const first = arr[0];
    combMap.set(k, {
      key: k,
      fmt: first.fmt,
      songIdx: first.songIdx,
      x: minX - BP_COMB_SPINE_W - BP_PAD,
      y: minY,
      el: null,
    });
  }
}

function rebuildCombDom() {
  if (!combsLayer) return;
  combsLayer.innerHTML = '';
  const orderedKeys = [];
  const fmt = 'wav';
  const songOrder = STATE.order[fmt] || [];
  for (const songIdx of songOrder) {
    const k = bpSongKey(fmt, songIdx);
    if (combMap.has(k)) orderedKeys.push(k);
  }
  for (const k of combMap.keys()) {
    if (!orderedKeys.includes(k)) orderedKeys.push(k);
  }
  for (const key of orderedKeys) {
    const c = combMap.get(key);
    if (!c) continue;
    const el = document.createElement('div');
    el.className = 'bp-comb';
    el.dataset.songKey = key;
    const spine = document.createElement('div');
    spine.className = 'bp-comb-spine';
    spine.title = 'Drag to move this song’s template row';
    const song = STATE.songs[c.fmt]?.[c.songIdx];
    spine.setAttribute('aria-label', `Comb — ${song?.name || 'song'} — drag to move templates`);
    el.appendChild(spine);
    el.style.transform = `translate(${c.x}px,${c.y}px)`;
    c.el = el;
    combsLayer.appendChild(el);
    spine.addEventListener('pointerdown', e => onCombSpinePointerDown(e, key));
  }
}

function onCombSpinePointerDown(e, songKey) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const templateIds = [...brickMap.values()]
    .filter(b => b.combTemplate && bpSongKey(b.fmt, b.songIdx) === songKey)
    .map(b => b.id);
  if (templateIds.length === 0) return;
  const c = combMap.get(songKey);
  if (!c) return;
  const snapshotBeforeDrag = capturePlaygroundBrickSnapshot();
  const startComb = { x: c.x, y: c.y };
  dragClusterIds = templateIds;
  dragStartPos = new Map();
  for (const id of dragClusterIds) {
    const b = brickMap.get(id);
    if (b) dragStartPos.set(id, { x: b.x, y: b.y });
  }
  const w = screenToWorld(e.clientX, e.clientY);
  dragOffX = w.x - c.x;
  dragOffY = w.y - c.y;
  dragPointerId = e.pointerId;
  stopPlaygroundPlayback();
  const combEl = c.el;
  if (combEl) combEl.setPointerCapture(e.pointerId);

  const onMove = ev => {
    if (ev.pointerId !== dragPointerId) return;
    const w2 = screenToWorld(ev.clientX, ev.clientY);
    const newCx = w2.x - dragOffX;
    const newCy = w2.y - dragOffY;
    const dx = newCx - startComb.x;
    const dy = newCy - startComb.y;
    for (const id of dragClusterIds) {
      const b = brickMap.get(id);
      const orig = dragStartPos.get(id);
      if (!b || !orig) continue;
      b.x = orig.x + dx;
      b.y = orig.y + dy;
      b.el.style.transform = `translate(${b.x}px,${b.y}px)`;
    }
    c.x = startComb.x + dx;
    c.y = startComb.y + dy;
    if (combEl) combEl.style.transform = `translate(${c.x}px,${c.y}px)`;
    repositionClusterUi();
  };

  const onUp = ev => {
    if (ev.pointerId !== dragPointerId) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    dragPointerId = null;
    dragStartPos = null;
    dragClusterIds = [];
    if (combEl) {
      try {
        combEl.releasePointerCapture(ev.pointerId);
      } catch (err) {}
    }
    syncCombAnchorsFromTemplateBricks();
    rebuildCombDom();
    ufRebuild();
    scheduleSave();
    updateClusterUi();
    const endSnap = capturePlaygroundBrickSnapshot();
    if (snapshotBeforeDrag && !snapshotsEqual(snapshotBeforeDrag, endSnap)) {
      bpPushUndo(snapshotBeforeDrag);
    }
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  updateClusterUi();
}

function createBrickElement(rec) {
  const el = document.createElement('div');
  el.className = 'bp-brick';
  if (rec.combTemplate) el.classList.add('bp-brick--comb-template');
  el.dataset.id = rec.id;
  el.style.width = `${rec.width}px`;
  el.style.height = `${BP_BRICK_H}px`;
  el.style.transform = `translate(${rec.x}px, ${rec.y}px)`;

  const song = STATE.songs[rec.fmt]?.[rec.songIdx];
  const colorIdx = rec.partIndex < 0 ? 0 : rec.partIndex;
  const col = partColor(Math.max(0, colorIdx));

  const durSec = bpGetPartDuration(rec.fmt, rec.songIdx, rec.partIndex);
  const durHtml = fmtTimeHTML(durSec);

  const inner = document.createElement('div');
  inner.className = 'bp-brick-inner';
  inner.style.background = `linear-gradient(145deg, ${col}dd, ${col}88)`;
  inner.innerHTML = `
    <span class="bp-brick-song">${escapeHtml(song?.name || '')}</span>
    <div class="bp-brick-meta">
      <span class="bp-brick-part">#${escapeHtml(bpPartLabel(rec.fmt, rec.songIdx, rec.partIndex))}</span>
      <span class="bp-brick-dur">${durHtml}</span>
    </div>
  `;
  el.appendChild(inner);

  const flash = document.createElement('div');
  flash.className = 'brick-preview-flash';
  flash.setAttribute('aria-hidden', 'true');
  el.appendChild(flash);

  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const combTemplate = !!rec.combTemplate;
    const isDuplicateDrag = combTemplate ? false : e.ctrlKey || e.metaKey;
    let snapshotBeforeDrag = null;
    let beforeDuplicateSnapshot = null;
    let workingRec = rec;
    let combDupActivated = false;
    const startClientX = e.clientX;
    const startClientY = e.clientY;

    if (combTemplate) {
      activeBrickId = rec.id;
      dragClusterIds = [];
      dragStartPos = null;
      dragPointerId = e.pointerId;
      stopPlaygroundPlayback();
      updateClusterUi();
    } else if (isDuplicateDrag) {
      beforeDuplicateSnapshot = capturePlaygroundBrickSnapshot();
      const newId = makeDuplicateBrickId(rec.id);
      workingRec = {
        id: newId,
        fmt: rec.fmt,
        songIdx: rec.songIdx,
        partIndex: rec.partIndex,
        x: rec.x,
        y: rec.y,
        width: rec.width,
        height: BP_BRICK_H,
        combTemplate: false,
        el: null,
      };
      workingRec.el = createBrickElement(workingRec);
      brickMap.set(newId, workingRec);
      if (bricksLayer) bricksLayer.appendChild(workingRec.el);
      ufRebuild();
      activeBrickId = workingRec.id;
      dragClusterIds = [workingRec.id];
      dragStartPos = new Map();
      for (const id of dragClusterIds) {
        const b = brickMap.get(id);
        if (b) dragStartPos.set(id, { x: b.x, y: b.y });
      }
      const w = screenToWorld(e.clientX, e.clientY);
      dragOffX = w.x - workingRec.x;
      dragOffY = w.y - workingRec.y;
      dragPointerId = e.pointerId;
      stopPlaygroundPlayback();
    } else {
      snapshotBeforeDrag = capturePlaygroundBrickSnapshot();
      activeBrickId = workingRec.id;
      const root = ufFind(workingRec.id);
      dragClusterIds = clusterMembers(root);
      dragStartPos = new Map();
      for (const id of dragClusterIds) {
        const b = brickMap.get(id);
        if (b) dragStartPos.set(id, { x: b.x, y: b.y });
      }
      const w = screenToWorld(e.clientX, e.clientY);
      dragOffX = w.x - workingRec.x;
      dragOffY = w.y - workingRec.y;
      dragPointerId = e.pointerId;
      stopPlaygroundPlayback();
    }

    const onMove = ev => {
      if (ev.pointerId !== dragPointerId) return;
      if (combTemplate && !combDupActivated) {
        const dist = Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY);
        if (dist < BP_COMB_DUP_THRESHOLD_PX) return;
        combDupActivated = true;
        beforeDuplicateSnapshot = capturePlaygroundBrickSnapshot();
        const newId = makeDuplicateBrickId(rec.id);
        workingRec = {
          id: newId,
          fmt: rec.fmt,
          songIdx: rec.songIdx,
          partIndex: rec.partIndex,
          x: rec.x,
          y: rec.y,
          width: rec.width,
          height: BP_BRICK_H,
          combTemplate: false,
          el: null,
        };
        workingRec.el = createBrickElement(workingRec);
        brickMap.set(newId, workingRec);
        if (bricksLayer) bricksLayer.appendChild(workingRec.el);
        ufRebuild();
        activeBrickId = workingRec.id;
        dragClusterIds = [workingRec.id];
        dragStartPos = new Map();
        dragStartPos.set(workingRec.id, { x: workingRec.x, y: workingRec.y });
        const w = screenToWorld(ev.clientX, ev.clientY);
        dragOffX = w.x - workingRec.x;
        dragOffY = w.y - workingRec.y;
      }
      if (!dragClusterIds.length || !dragStartPos) return;
      const w2 = screenToWorld(ev.clientX, ev.clientY);
      const tx = w2.x - dragOffX;
      const ty = w2.y - dragOffY;
      const base = dragStartPos.get(workingRec.id);
      if (!base) return;
      const dx = tx - base.x;
      const dy = ty - base.y;
      for (const id of dragClusterIds) {
        const b = brickMap.get(id);
        const orig = dragStartPos.get(id);
        if (!b || !orig) continue;
        b.x = orig.x + dx;
        b.y = orig.y + dy;
        b.el.style.transform = `translate(${b.x}px,${b.y}px)`;
      }
      repositionClusterUi();
    };

    const onUp = ev => {
      if (ev.pointerId !== dragPointerId) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      dragPointerId = null;
      dragStartPos = null;
      if (combTemplate && !combDupActivated) {
        activeBrickId = rec.id;
        dragClusterIds = [];
        updateClusterUi();
        return;
      }
      snapClusterToNeighbors(dragClusterIds);
      ufRebuild();
      scheduleSave();
      updateClusterUi();
      if (beforeDuplicateSnapshot) {
        bpPushUndo(beforeDuplicateSnapshot);
      } else if (!combTemplate && !isDuplicateDrag) {
        const endSnap = capturePlaygroundBrickSnapshot();
        if (snapshotBeforeDrag && !snapshotsEqual(snapshotBeforeDrag, endSnap)) {
          bpPushUndo(snapshotBeforeDrag);
        }
      }
      dragClusterIds = [];
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    if (!combTemplate) updateClusterUi();
  });

  return el;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function removeClusterUi() {
  if (clusterUiEl && clusterUiEl.parentNode) clusterUiEl.parentNode.removeChild(clusterUiEl);
  clusterUiEl = null;
}

function repositionClusterUi() {
  if (!clusterUiEl || !activeBrickId) return;
  const root = ufFind(activeBrickId);
  const ids = clusterMembers(root);
  const box = clusterBBox(ids);
  if (!box) return;
  const pad = BP_PAD;
  const toolbarH = 36;
  clusterUiEl.style.left = `${box.minX - pad}px`;
  clusterUiEl.style.top = `${box.minY - pad - toolbarH}px`;
}

function syncBpClusterTransportButtons(ui, root) {
  const playBtn = ui.querySelector('.bp-play');
  const loopBtn = ui.querySelector('.bp-loop');
  const seamBtn = ui.querySelector('.bp-seam');
  if (!playBtn || !loopBtn || !seamBtn) return;
  const isThis =
    playingRoot === root && (pgSeamMode || pgSources.length > 0);
  if (!isThis) {
    playBtn.innerHTML = BP_PLAY_ICON;
    playBtn.title = 'Play once';
    playBtn.setAttribute('aria-label', 'Play once');
    loopBtn.innerHTML = BP_LOOP_ICON;
    loopBtn.title = 'Play looped';
    loopBtn.setAttribute('aria-label', 'Play looped');
    seamBtn.innerHTML = BP_SEAM_ICON;
    seamBtn.title = 'Seam preview';
    seamBtn.setAttribute('aria-label', 'Seam preview — loop head and tail with a fast skip');
    return;
  }
  if (pgSeamMode) {
    playBtn.innerHTML = BP_PLAY_ICON;
    playBtn.title = 'Play once';
    loopBtn.innerHTML = BP_LOOP_ICON;
    loopBtn.title = 'Play looped';
    seamBtn.innerHTML = BP_PAUSE_ICON;
    seamBtn.title = 'Stop seam preview';
    seamBtn.setAttribute('aria-label', 'Stop seam preview');
    return;
  }
  if (playLoop) {
    playBtn.innerHTML = BP_PLAY_ICON;
    playBtn.title = 'Play once';
    loopBtn.innerHTML = BP_PAUSE_ICON;
    loopBtn.title = 'Pause';
    loopBtn.setAttribute('aria-label', 'Pause loop');
    seamBtn.innerHTML = BP_SEAM_ICON;
    seamBtn.title = 'Seam preview';
    seamBtn.setAttribute('aria-label', 'Seam preview');
  } else {
    playBtn.innerHTML = BP_PAUSE_ICON;
    playBtn.title = 'Pause';
    playBtn.setAttribute('aria-label', 'Pause');
    loopBtn.innerHTML = BP_LOOP_ICON;
    loopBtn.title = 'Play looped';
    seamBtn.innerHTML = BP_SEAM_ICON;
    seamBtn.title = 'Seam preview';
    seamBtn.setAttribute('aria-label', 'Seam preview');
  }
}

function updateClusterUi() {
  removeClusterUi();
  if (!bpHudRoot || !activeBrickId) return;
  const root = ufFind(activeBrickId);
  const ids = clusterMembers(root);
  if (ids.length === 0) return;
  const box = clusterBBox(ids);
  if (!box) return;

  const ui = document.createElement('div');
  ui.className = 'bp-cluster-ui';
  const pad = BP_PAD;
  const toolbarH = 36;
  const seekH = 22;
  const footH = 30;
  const left = box.minX - pad;
  const top = box.minY - pad - toolbarH;
  const w = box.maxX - box.minX + pad * 2;
  const borderH = box.maxY - box.minY + pad * 2;

  ui.style.left = `${left}px`;
  ui.style.top = `${top}px`;
  ui.style.width = `${w}px`;

  const isPlaying = playingRoot === root;
  const dlFmt = (STATE.playground.downloadFormat || 'wav').toLowerCase();
  const dlFmtLabel = dlFmt === 'mp3' || dlFmt === 'ogg' ? dlFmt.toUpperCase() : 'WAV';

  ui.innerHTML = `
    <div class="bp-cluster-toolbar">
      <div class="bp-cluster-toolbar-left">
        <button type="button" class="bp-mini-btn bp-mini-btn--icon bp-play" title="Play once" aria-label="Play once">${BP_PLAY_ICON}</button>
        <button type="button" class="bp-mini-btn bp-mini-btn--icon bp-loop" title="Play looped" aria-label="Play looped">${BP_LOOP_ICON}</button>
        <button type="button" class="bp-mini-btn bp-mini-btn--icon bp-seam bp-cluster-seam-btn" title="Seam preview" aria-label="Seam preview">${BP_SEAM_ICON}</button>
      </div>
      <div class="bp-cluster-toolbar-right">
        <button type="button" class="bp-mini-btn bp-mini-btn--icon bp-dup-x" title="Remove duplicate bricks (keep one of each sound)" aria-label="Remove duplicate bricks">&#10005;</button>
        <button type="button" class="bp-mini-btn bp-mini-btn--icon bp-break" title="Break apart" aria-label="Break apart">${BP_BREAK_MAGNET_SVG}</button>
      </div>
    </div>
    <div class="bp-cluster-outline" style="top:${toolbarH}px;height:${borderH}px"></div>
    <div class="bp-cluster-seek" style="top:${toolbarH + borderH + 6}px;">
      <div class="bp-seek-track">
        <div class="bp-seek-fill"></div>
        <div class="bp-seek-handle"></div>
      </div>
    </div>
    <div class="bp-cluster-footer" style="top:${toolbarH + borderH + seekH + 10}px;">
      <div class="bp-cluster-footer-inner">
        <button type="button" class="bp-mini-btn bp-mini-btn--icon bp-dl" title="Download" aria-label="Download">${BP_DL_ICON}</button>
        <button type="button" class="bp-mini-btn bp-dl-fmt" title="Cycle format: WAV → MP3 → OGG">${dlFmtLabel}</button>
      </div>
    </div>
  `;

  const outline = ui.querySelector('.bp-cluster-outline');
  outline.style.width = `${w}px`;

  const breakBtn = ui.querySelector('.bp-break');
  if (breakBtn) {
    breakBtn.disabled = ids.length <= 1;
    breakBtn.classList.toggle('bp-mini-btn--disabled', ids.length <= 1);
  }
  const dupXBtn = ui.querySelector('.bp-dup-x');
  if (dupXBtn) {
    const canDup = bpClusterHasRemovableDuplicates(root);
    dupXBtn.disabled = !canDup;
    dupXBtn.classList.toggle('bp-mini-btn--disabled', !canDup);
  }

  syncBpClusterTransportButtons(ui, root);

  ui.querySelector('.bp-play').addEventListener('click', ev => {
    ev.stopPropagation();
    void bpPlayCluster(root, false);
  });
  ui.querySelector('.bp-loop').addEventListener('click', ev => {
    ev.stopPropagation();
    void bpPlayCluster(root, true);
  });
  ui.querySelector('.bp-seam').addEventListener('click', ev => {
    ev.stopPropagation();
    void bpPlayClusterSeam(root);
  });
  ui.querySelector('.bp-break').addEventListener('click', ev => {
    ev.stopPropagation();
    if (ids.length > 1) bpBreakCluster(root);
  });
  if (dupXBtn) {
    dupXBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      if (bpClusterHasRemovableDuplicates(root)) bpDeleteDuplicatesInCluster(root);
    });
  }
  ui.querySelector('.bp-dl').addEventListener('click', ev => {
    ev.stopPropagation();
    void bpDownloadCluster(root);
  });
  const fmtBtn = ui.querySelector('.bp-dl-fmt');
  if (fmtBtn) {
    fmtBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      const next = cyclePlaygroundDownloadFormat();
      fmtBtn.textContent = next === 'mp3' || next === 'ogg' ? next.toUpperCase() : 'WAV';
      fmtBtn.title = `Next format: ${next.toUpperCase()} (click to cycle)`;
    });
  }

  const seekTrack = ui.querySelector('.bp-seek-track');
  if (seekTrack) {
    seekTrack.classList.toggle('bp-seek-track--disabled', !!pgSeamMode);
    seekTrack.title = pgSeamMode ? 'Seam preview — seek disabled' : '';
  }
  if (seekTrack && isPlaying && !pgSeamMode) {
    const onSeek = clientX => {
      const rect = seekTrack.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      stopPlaygroundSourcesOnly();
      const sorted = [...ids]
        .map(id => brickMap.get(id))
        .filter(Boolean)
        .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));
      const off = ratio * pgTotalDur;
      scheduleClusterPlayFromOffset(sorted, off, false, root);
      updateClusterUi();
    };
    seekTrack.addEventListener('pointerdown', ev => {
      ev.stopPropagation();
      onSeek(ev.clientX);
      const move = e => onSeek(e.clientX);
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  bpHudRoot.appendChild(ui);
  clusterUiEl = ui;

  if (!isPlaying) {
    const seekFill = ui.querySelector('.bp-seek-fill');
    const seekHandle = ui.querySelector('.bp-seek-handle');
    if (seekFill) seekFill.style.width = '0%';
    if (seekHandle) seekHandle.style.left = '0%';
  } else {
    if (pgRaf) cancelAnimationFrame(pgRaf);
    pgRaf = 0;
    tickPlaygroundSeek();
  }
}

function resetPlaygroundLayout() {
  stopPlaygroundPlayback();
  removeClusterUi();
  bpUndoStack.length = 0;
  bpRedoStack.length = 0;
  bpZoom = 1;
  bpPanX = 0;
  bpPanY = 0;
  updateWorldTransform();
  const layout = layoutDefaultCombBricks(collectDescriptors());
  rebuildBrickDom(layout);
  activeBrickId = brickMap.size ? brickMap.keys().next().value : null;
  persistPlaygroundBricks();
  saveSession();
  updateClusterUi();
}

function initPlaygroundFloatingTools(wrap) {
  const tools = wrap.querySelector('#bp-floating-tools');
  const toggle = wrap.querySelector('#bp-tools-toggle');
  const resetBtn = wrap.querySelector('#bp-tools-reset');
  if (!tools || !toggle) return;
  toggle.addEventListener('click', () => {
    const collapsed = tools.classList.toggle('bp-floating-tools--collapsed');
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetPlaygroundLayout();
      playClickUiSound();
    });
  }
}

function rebuildBrickDom(layout) {
  brickMap.clear();
  ufParent.clear();
  if (!bricksLayer) return;
  bricksLayer.innerHTML = '';
  for (const item of layout) {
    if (!isBrickValid(item)) continue;
    const w = item.width || bpBrickWidthForDur(bpGetPartDuration(item.fmt, item.songIdx, item.partIndex));
    const combTemplate =
      item.combTemplate !== undefined && item.combTemplate !== null
        ? !!item.combTemplate
        : bpIsCombTemplateBrick(item);
    const rec = {
      id: item.id,
      fmt: item.fmt,
      songIdx: item.songIdx,
      partIndex: item.partIndex,
      x: item.x,
      y: item.y,
      width: w,
      height: BP_BRICK_H,
      combTemplate,
      el: null,
    };
    rec.el = createBrickElement(rec);
    brickMap.set(rec.id, rec);
    bricksLayer.appendChild(rec.el);
  }
  ufRebuild();
  syncCombAnchorsFromTemplateBricks();
  rebuildCombDom();
}

function initBrickPlayground(mainContainer) {
  const wrap = document.createElement('div');
  wrap.id = 'brick-playground-root';
  wrap.className = 'brick-playground';
  wrap.innerHTML = `
    <div class="bp-header">
      <span class="bp-hint">Comb spine: move templates · Template: click to select · drag 5px+ to copy · Free brick: drag to snap · Ctrl-drag duplicate · Ctrl+Z / Ctrl+Y · scroll zoom · empty area pan</span>
    </div>
    <div class="bp-stage">
      <aside class="bp-floating-tools" id="bp-floating-tools" aria-label="Playground tools">
        <button type="button" class="bp-tools-toggle" id="bp-tools-toggle" aria-expanded="true" aria-controls="bp-tools-panel">
          <span class="bp-tools-toggle-label">Tools</span>
          <span class="bp-tools-chevron" aria-hidden="true">&#9660;</span>
        </button>
        <div class="bp-tools-panel" id="bp-tools-panel">
          <p class="bp-tools-hint">Restore the default comb layout and zoom/pan.</p>
          <button type="button" class="bp-tools-btn-reset" id="bp-tools-reset">Reset positions</button>
        </div>
      </aside>
      <div class="bp-viewport" tabindex="0">
        <div class="bp-world">
          <div class="bp-combs-layer"></div>
          <div class="bp-bricks-layer"></div>
          <div class="bp-hud-layer"></div>
        </div>
      </div>
    </div>
  `;
  mainContainer.appendChild(wrap);

  bpViewport = wrap.querySelector('.bp-viewport');
  bpWorld = wrap.querySelector('.bp-world');
  combsLayer = wrap.querySelector('.bp-combs-layer');
  bricksLayer = wrap.querySelector('.bp-bricks-layer');
  bpHudRoot = wrap.querySelector('.bp-hud-layer');

  const pg = STATE.playground;
  bpZoom = pg.zoom || 1;
  bpPanX = pg.panX || 0;
  bpPanY = pg.panY || 0;
  updateWorldTransform();

  const desc = collectDescriptors();
  let layout = [];
  if (Array.isArray(pg.bricks) && pg.bricks.length > 0) {
    layout = pg.bricks
      .filter(b => isBrickValid(b))
      .map(b => ({
        id: b.id,
        fmt: b.fmt,
        songIdx: b.songIdx,
        partIndex: b.partIndex,
        x: b.x,
        y: b.y,
        width: bpBrickWidthForDur(bpGetPartDuration(b.fmt, b.songIdx, b.partIndex)),
      }));
  } else {
    layout = layoutDefaultCombBricks(desc);
  }
  rebuildBrickDom(layout);
  if (brickMap.size && !activeBrickId) {
    activeBrickId = brickMap.keys().next().value;
  }
  persistPlaygroundBricks();

  bpViewport.addEventListener('wheel', e => {
    if (!wrap.classList.contains('active')) return;
    e.preventDefault();
    const rect = bpViewport.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - bpPanX) / bpZoom;
    const wy = (my - bpPanY) / bpZoom;
    const factor = e.deltaY > 0 ? 0.92 : 1.09;
    const newZoom = Math.min(4, Math.max(0.12, bpZoom * factor));
    bpPanX = mx - wx * newZoom;
    bpPanY = my - wy * newZoom;
    bpZoom = newZoom;
    updateWorldTransform();
    scheduleSave();
  }, { passive: false });

  bpViewport.addEventListener('pointerdown', e => {
    if (e.target.closest('.bp-brick') || e.target.closest('.bp-cluster-ui') || e.target.closest('.bp-comb-spine'))
      return;
    if (e.button !== 0) return;
    panPointerId = e.pointerId;
    panStartClientX = e.clientX;
    panStartClientY = e.clientY;
    panStartPanX = bpPanX;
    panStartPanY = bpPanY;
    bpViewport.setPointerCapture(e.pointerId);
  });

  bpViewport.addEventListener('pointermove', e => {
    if (e.pointerId !== panPointerId) return;
    bpPanX = panStartPanX + (e.clientX - panStartClientX);
    bpPanY = panStartPanY + (e.clientY - panStartClientY);
    updateWorldTransform();
  });

  bpViewport.addEventListener('pointerup', e => {
    if (e.pointerId !== panPointerId) return;
    panPointerId = null;
    try {
      bpViewport.releasePointerCapture(e.pointerId);
    } catch (err) {}
    scheduleSave();
  });

  bpViewport.addEventListener('keydown', e => {
    if (!wrap.classList.contains('active')) return;
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      bpTryDeleteActiveBrick();
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      bpUndo();
      return;
    }
    if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      bpRedo();
    }
  });

  initPlaygroundFloatingTools(wrap);
  initPlaygroundViewToggle();
  applyPlaygroundVisibility(!!STATE.playground.mode);
}

function initPlaygroundViewToggle() {
  const btnP = document.getElementById('btn-view-playlist');
  const btnG = document.getElementById('btn-view-playground');
  if (!btnP || !btnG) return;
  btnP.addEventListener('click', () => {
    playClickUiSound();
    applyPlaygroundVisibility(false);
  });
  btnG.addEventListener('click', () => {
    playClickUiSound();
    applyPlaygroundVisibility(true);
  });
}

function applyPlaygroundVisibility(playground) {
  STATE.playground.mode = playground;
  const pl = document.getElementById('playlist-view');
  const root = document.getElementById('brick-playground-root');
  const btnP = document.getElementById('btn-view-playlist');
  const btnG = document.getElementById('btn-view-playground');
  const main = document.querySelector('.main-content');
  // Prefer explicit display toggles to avoid CSS specificity surprises.
  if (pl) {
    pl.classList.toggle('hidden', playground);
    pl.style.display = playground ? 'none' : '';
  }
  if (root) {
    root.classList.toggle('active', playground);
    root.style.display = playground ? 'flex' : 'none';
    root.setAttribute('aria-hidden', playground ? 'false' : 'true');
  }
  if (btnP) btnP.classList.toggle('active', !playground);
  if (btnG) btnG.classList.toggle('active', playground);
  if (main) main.classList.toggle('main-content--playground', playground);
  saveSession();
  if (playground && bpViewport) {
    bpViewport.focus();
    updateClusterUi();
  }
}
