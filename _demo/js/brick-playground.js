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

let bpViewport = null;
let bpWorld = null;
let bpHudRoot = null;
let bricksLayer = null;

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

let pgGain = null;
/** @type {AudioBufferSourceNode[]} */
let pgSources = [];
let pgRaf = 0;
let pgTimelineStartAC = 0;
let pgTimelineOffset = 0;
let pgSortedBricks = [];
let pgTotalDur = 0;

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
  if (pgRaf) cancelAnimationFrame(pgRaf);
  pgRaf = 0;
}

function stopPlaygroundPlayback() {
  stopPlaygroundSourcesOnly();
  playingRoot = null;
  updateClusterUi();
}

function scheduleClusterPlayFromOffset(sorted, offsetSec, loop, clusterRoot) {
  stopPlaygroundSourcesOnly();
  playingRoot = clusterRoot;
  playLoop = loop;

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
  const offsetClamped = Math.min(Math.max(0, offsetSec), Math.max(0, pgTotalDur - 1e-9));

  const rate = playbackRateFromKnob();
  const absR = Math.max(1e-6, Math.abs(rate));
  const g = ensurePlaygroundGain();

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
      src.connect(g);
      const off = i === startIdx ? Math.max(0, innerOff) : 0;
      const wall = (buf.duration - off) / absR;
      src.start(sched, off);
      pgSources.push(src);
      sched += wall;
      lastSrc = src;
    }
    if (lastSrc) {
      lastSrc.onended = () => {
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

function tickPlaygroundSeek() {
  if (!playingRoot || !clusterUiEl) return;
  const seekFill = clusterUiEl.querySelector('.bp-seek-fill');
  const seekHandle = clusterUiEl.querySelector('.bp-seek-handle');
  if (!seekFill || !seekHandle) return;
  const rate = Math.max(1e-6, Math.abs(playbackRateFromKnob()));
  const elapsed = (AC.currentTime - pgTimelineStartAC) * rate;
  const pos = Math.min(pgTimelineOffset + elapsed, pgTotalDur);
  const pct = pgTotalDur > 0 ? (pos / pgTotalDur) * 100 : 0;
  seekFill.style.width = `${pct}%`;
  seekHandle.style.left = `${pct}%`;
  if (pos < pgTotalDur - 0.03 || playLoop) pgRaf = requestAnimationFrame(tickPlaygroundSeek);
  else if (!playLoop) stopPlaygroundPlayback();
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

function bpBreakCluster(root) {
  const ids = clusterMembers(root);
  playBreakSound();
  for (const id of ids) ufParent.set(id, id);
  for (const id of ids) {
    const b = brickMap.get(id);
    if (!b) continue;
    let tries = 0;
    let nx = b.x + (Math.random() - 0.5) * BP_SCATTER;
    let ny = b.y + (Math.random() - 0.5) * BP_SCATTER;
    while (tries++ < 30) {
      let hit = false;
      for (const ob of brickMap.values()) {
        if (ob.id === b.id || ids.includes(ob.id)) continue;
        const overlap = !(
          nx + b.width < ob.x ||
          nx > ob.x + ob.width ||
          ny + b.height < ob.y ||
          ny > ob.y + ob.height
        );
        if (overlap) {
          hit = true;
          break;
        }
      }
      if (!hit) break;
      nx = b.x + (Math.random() - 0.5) * BP_SCATTER * 1.3;
      ny = b.y + (Math.random() - 0.5) * BP_SCATTER * 1.3;
    }
    b.x = nx;
    b.y = ny;
    b.el.style.transform = `translate(${b.x}px,${b.y}px)`;
  }
  ufRebuild();
  scheduleSave();
  updateClusterUi();
}

function bpBreakAll() {
  playBreakSound();
  for (const id of brickMap.keys()) ufParent.set(id, id);
  const all = [...brickMap.values()];
  for (const b of all) {
    b.x += (Math.random() - 0.5) * BP_SCATTER * 1.2;
    b.y += (Math.random() - 0.5) * BP_SCATTER * 1.2;
    b.el.style.transform = `translate(${b.x}px,${b.y}px)`;
  }
  ufRebuild();
  scheduleSave();
  updateClusterUi();
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
  const blob = audioBufferToWavBlob(rendered);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = sanitizeFileName(`playground-mix-${Date.now()}.wav`) || 'playground-mix.wav';
  a.click();
  URL.revokeObjectURL(a.href);
  playClickUiSound();
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
  STATE.playground.bricks = [...brickMap.values()].map(b => ({
    id: b.id,
    fmt: b.fmt,
    songIdx: b.songIdx,
    partIndex: b.partIndex,
    x: b.x,
    y: b.y,
  }));
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

function layoutDefaultBricks(descriptors) {
  let colX = BP_ORIGIN_X;
  let rowY = BP_ORIGIN_Y;
  let rowH = 0;
  const out = [];
  for (const d of descriptors) {
    const w = bpBrickWidthForDur(bpGetPartDuration(d.fmt, d.songIdx, d.partIndex));
    if (colX + w > BP_GRID_W) {
      colX = BP_ORIGIN_X;
      rowY += rowH + 14;
      rowH = 0;
    }
    out.push({
      id: `bp_${d.fmt}_${d.songIdx}_${d.partIndex}`,
      fmt: d.fmt,
      songIdx: d.songIdx,
      partIndex: d.partIndex,
      x: colX,
      y: rowY,
      width: w,
    });
    colX += w + 10;
    rowH = Math.max(rowH, BP_BRICK_H);
  }
  return out;
}

function createBrickElement(rec) {
  const el = document.createElement('div');
  el.className = 'bp-brick';
  el.dataset.id = rec.id;
  el.style.width = `${rec.width}px`;
  el.style.height = `${BP_BRICK_H}px`;
  el.style.transform = `translate(${rec.x}px, ${rec.y}px)`;

  const song = STATE.songs[rec.fmt]?.[rec.songIdx];
  const colorIdx = rec.partIndex < 0 ? 0 : rec.partIndex;
  const col = partColor(Math.max(0, colorIdx));

  const inner = document.createElement('div');
  inner.className = 'bp-brick-inner';
  inner.style.background = `linear-gradient(145deg, ${col}dd, ${col}88)`;
  inner.innerHTML = `
    <span class="bp-brick-song">${escapeHtml(song?.name || '')}</span>
    <span class="bp-brick-part">#${escapeHtml(bpPartLabel(rec.fmt, rec.songIdx, rec.partIndex))}</span>
  `;
  el.appendChild(inner);

  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    activeBrickId = rec.id;
    const root = ufFind(rec.id);
    dragClusterIds = clusterMembers(root);
    dragStartPos = new Map();
    for (const id of dragClusterIds) {
      const b = brickMap.get(id);
      if (b) dragStartPos.set(id, { x: b.x, y: b.y });
    }
    const w = screenToWorld(e.clientX, e.clientY);
    dragOffX = w.x - rec.x;
    dragOffY = w.y - rec.y;
    dragPointerId = e.pointerId;
    stopPlaygroundPlayback();

    const onMove = ev => {
      if (ev.pointerId !== dragPointerId) return;
      const w2 = screenToWorld(ev.clientX, ev.clientY);
      const tx = w2.x - dragOffX;
      const ty = w2.y - dragOffY;
      const base = dragStartPos.get(rec.id);
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
      snapClusterToNeighbors(dragClusterIds);
      ufRebuild();
      scheduleSave();
      updateClusterUi();
      dragClusterIds = [];
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    updateClusterUi();
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
  const borderTop = box.minY - pad;
  const borderH = box.maxY - box.minY + pad * 2;

  ui.style.left = `${left}px`;
  ui.style.top = `${top}px`;
  ui.style.width = `${w}px`;

  const isPlaying = playingRoot === root;
  ui.innerHTML = `
    <div class="bp-cluster-toolbar">
      <div class="bp-cluster-toolbar-left">
        <button type="button" class="bp-mini-btn bp-play" title="Play once">Play</button>
        <button type="button" class="bp-mini-btn bp-loop" title="Play looped">Play loop</button>
      </div>
      <button type="button" class="bp-mini-btn bp-break" title="Break apart">Break</button>
    </div>
    <div class="bp-cluster-outline" style="top:${toolbarH}px;height:${borderH}px"></div>
    <div class="bp-cluster-seek" style="top:${toolbarH + borderH + 6}px;">
      <div class="bp-seek-track">
        <div class="bp-seek-fill"></div>
        <div class="bp-seek-handle"></div>
      </div>
    </div>
    <div class="bp-cluster-footer" style="top:${toolbarH + borderH + seekH + 10}px;">
      <button type="button" class="bp-mini-btn bp-dl" title="Download WAV">Download WAV</button>
    </div>
  `;

  const outline = ui.querySelector('.bp-cluster-outline');
  outline.style.width = `${w}px`;

  ui.querySelector('.bp-play').addEventListener('click', ev => {
    ev.stopPropagation();
    void bpPlayCluster(root, false);
  });
  ui.querySelector('.bp-loop').addEventListener('click', ev => {
    ev.stopPropagation();
    void bpPlayCluster(root, true);
  });
  ui.querySelector('.bp-break').addEventListener('click', ev => {
    ev.stopPropagation();
    if (ids.length > 1) bpBreakCluster(root);
  });
  ui.querySelector('.bp-dl').addEventListener('click', ev => {
    ev.stopPropagation();
    void bpDownloadCluster(root);
  });

  const seekTrack = ui.querySelector('.bp-seek-track');
  if (seekTrack && isPlaying) {
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
    tickPlaygroundSeek();
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
    const rec = {
      id: item.id,
      fmt: item.fmt,
      songIdx: item.songIdx,
      partIndex: item.partIndex,
      x: item.x,
      y: item.y,
      width: w,
      height: BP_BRICK_H,
      el: null,
    };
    rec.el = createBrickElement(rec);
    brickMap.set(rec.id, rec);
    bricksLayer.appendChild(rec.el);
  }
  ufRebuild();
}

function initBrickPlayground(mainContainer) {
  const wrap = document.createElement('div');
  wrap.id = 'brick-playground-root';
  wrap.className = 'brick-playground';
  wrap.innerHTML = `
    <div class="bp-header">
      <span class="bp-hint">Drag bricks to snap; scroll to zoom · empty area to pan</span>
    </div>
    <div class="bp-viewport" tabindex="0">
      <div class="bp-world">
        <div class="bp-bricks-layer"></div>
        <div class="bp-hud-layer"></div>
      </div>
    </div>
  `;
  mainContainer.appendChild(wrap);

  bpViewport = wrap.querySelector('.bp-viewport');
  bpWorld = wrap.querySelector('.bp-world');
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
    layout = layoutDefaultBricks(desc);
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
    if (e.target.closest('.bp-brick') || e.target.closest('.bp-cluster-ui')) return;
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
