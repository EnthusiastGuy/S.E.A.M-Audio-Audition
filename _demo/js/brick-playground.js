/* =============================================================
   S.E.A.M Audio Audition — Brick Playground (Lego timeline)
   ============================================================= */

'use strict';

const BP_BRICK_H = 42;
const BP_PX_PER_SEC = 34;
const BP_MIN_W = 48;
const BP_MAX_W = 300;
const BP_SNAP = 26;
const BP_Y_ALIGN = 20;
const BP_PAD = 4;
const BP_GRID_W = 560;
const BP_ORIGIN_X = 32;
const BP_ORIGIN_Y = 40;
const BP_SCATTER = 420;
/** Horizontal gap range (world px) for bricks to count as “touching” for magnet union (wider = easier to join). */
const BP_MAGNET_GAP_LO = -5;
const BP_MAGNET_GAP_HI = 14;
/** Min gap between brick edges after break so they stay out of magnet snap range (see ufRebuild). */
const BP_BREAK_GAP = Math.max(BP_MAGNET_GAP_HI + 18, 36);
/** World px: pointer within this distance of a seam midpoint shows insert marker. */
const BP_SEAM_HOVER_PX = 20;
/** Packed row gap after insert/reorder (edges stay within magnet range). */
const BP_BRICK_PACK_GAP = 2;
/** Hold still this long (ms) to enter ghost reorder for one brick in a sequence. */
const BP_GHOST_HOLD_MS = 1000;
/** Movement before normal drag starts cancels ghost timer (screen px). */
const BP_DRAG_ARM_PX = 5;
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

/** Viewport snow: idle before fall, grid deposit on brick tops, gust erosion. */
const BP_SNOW_IDLE_MS = 20000;
const BP_SNOW_CELL = 3;
const BP_SNOW_RAMP_SEC = 95;
const BP_SNOW_MAX_PARTICLES = 23800;
const BP_SNOW_BASE_SPAWN = 10.8;
/** Deposit decay per second when user breaks idle (higher = faster melt). */
const BP_SNOW_MELT_RATE = 11;

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
/** Container for total-duration badges on multi-brick clusters (world-space, inside HUD). */
let bpClusterDurLayer = null;
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

let bpSeamMarkerEl = null;
/** @type {{ leftId: string, rightId: string, seamX: number, rowY: number }|null} */
let bpSeamHint = null;

/** @type {HTMLCanvasElement|null} */
let bpSnowCanvas = null;
/** @type {CanvasRenderingContext2D|null} */
let bpSnowCtx = null;
let bpSnowW = 0;
let bpSnowH = 0;
let bpSnowDpr = 1;
/** @type {Float32Array|null} */
let bpSnowGrid = null;
let bpSnowGw = 0;
let bpSnowGh = 0;
/** @type {Array<{ x: number, y: number, vx: number, vy: number, r: number, ph: number }>} */
let bpSnowParticles = [];
let bpSnowRaf = 0;
let bpSnowLastActivity = 0;
let bpSnowRampStart = 0;
let bpSnowWind = 0;
let bpSnowWindTarget = 0;
let bpSnowWindNext = 0;
let bpSnowGustNext = 0;
let bpSnowDepositSum = 0;
let bpSnowSpawnFrac = 0;
let bpSnowLastFrameAt = 0;
let bpSnowMelting = false;

/** @type {HTMLCanvasElement|null} */
let bpVisCanvas = null;
/** @type {CanvasRenderingContext2D|null} */
let bpVisCtx = null;
let bpVisW = 0;
let bpVisH = 0;
let bpVisDpr = 1;
/** @type {AnalyserNode|null} */
let bpVisAnalyser = null;
/** @type {Uint8Array|null} */
let bpVisFreq = null;
/** @type {Float32Array|null} */
let bpVisSmooth = null;
/** @type {Float32Array|null} */
let bpVisPeaks = null;
let bpVisRaf = 0;
let bpVisLastAt = 0;
let bpVisEnergy = 0;
let bpVisPhase = 0;
/** @type {Float32Array|null} */
let bpVisCapY = null;
/** @type {Float32Array|null} */
let bpVisCapV = null;
/** @type {Float32Array|null} */
let bpVisCapHold = null;
let bpVisCapCount = 0;

function bpVisualizerEnsureAnalyser() {
  if (bpVisAnalyser) return bpVisAnalyser;
  const a = AC.createAnalyser();
  a.fftSize = 1024;
  a.smoothingTimeConstant = 0.74;
  a.minDecibels = -95;
  a.maxDecibels = -18;
  bpVisAnalyser = a;
  bpVisFreq = new Uint8Array(a.frequencyBinCount);
  bpVisSmooth = new Float32Array(a.frequencyBinCount);
  bpVisPeaks = new Float32Array(a.frequencyBinCount);
  return a;
}

function bpVisSyncCanvasLayout() {
  if (!bpVisCanvas || !bpViewport || !bpWorld) return;
  const z = Math.max(0.12, bpZoom);
  const ww = bpViewport.clientWidth / z;
  const wh = bpViewport.clientHeight / z;
  bpVisCanvas.style.left = `${-bpPanX / z}px`;
  bpVisCanvas.style.top = `${-bpPanY / z}px`;
  bpVisCanvas.style.width = `${ww}px`;
  bpVisCanvas.style.height = `${wh}px`;
}

function bpVisResize() {
  if (!bpVisCanvas || !bpViewport) return;
  const w = Math.max(1, Math.floor(bpViewport.clientWidth));
  const h = Math.max(1, Math.floor(bpViewport.clientHeight));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  bpVisCanvas.width = Math.floor(w * dpr);
  bpVisCanvas.height = Math.floor(h * dpr);
  bpVisCanvas.style.width = `${w}px`;
  bpVisCanvas.style.height = `${h}px`;
  bpVisCtx = bpVisCanvas.getContext('2d', { alpha: true });
  if (bpVisCtx) {
    bpVisCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bpVisCtx.imageSmoothingEnabled = true;
  }
  bpVisW = w;
  bpVisH = h;
  bpVisDpr = dpr;
  bpVisSyncCanvasLayout();
}

function bpVisClear() {
  if (!bpVisCtx) return;
  bpVisCtx.clearRect(0, 0, bpVisW, bpVisH);
}

function bpVisReadSpectrum(dt) {
  const a = bpVisAnalyser;
  const bins = bpVisFreq;
  const sm = bpVisSmooth;
  const pk = bpVisPeaks;
  if (!a || !bins || !sm || !pk) return 0;
  a.getByteFrequencyData(bins);
  let e = 0;
  const at = Math.min(1, dt * 18);
  const rt = Math.min(1, dt * 2.1);
  for (let i = 0; i < bins.length; i++) {
    const v = bins[i] / 255;
    const next = sm[i] + (v - sm[i]) * at;
    sm[i] = next;
    const peak = Math.max(next, pk[i] - rt);
    pk[i] = peak;
    if (i < 160) e += next;
  }
  return e / 160;
}

function bpVisAt(arr, idx) {
  if (!arr || arr.length === 0) return 0;
  const i0 = Math.max(0, Math.min(arr.length - 1, Math.floor(idx)));
  const i1 = Math.max(0, Math.min(arr.length - 1, i0 + 1));
  const t = Math.max(0, Math.min(1, idx - i0));
  return arr[i0] * (1 - t) + arr[i1] * t;
}

function bpVisEnsureCaps(count) {
  if (bpVisCapY && bpVisCapV && bpVisCapHold && bpVisCapCount === count) return;
  bpVisCapCount = count;
  bpVisCapY = new Float32Array(count);
  bpVisCapV = new Float32Array(count);
  bpVisCapHold = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    bpVisCapY[i] = 0;
    bpVisCapV[i] = 0;
    bpVisCapHold[i] = 0;
  }
}

function bpVisDrawWaveLine(ctx, arr, hueA, hueB, amp, yBase, lineW, glow) {
  const w = bpVisW;
  const h = bpVisH;
  const grad = ctx.createLinearGradient(0, h, w, h * 0.1);
  grad.addColorStop(0, `hsla(${hueA}, 100%, 58%, 0.09)`);
  grad.addColorStop(0.5, `hsla(${hueB}, 100%, 62%, 0.2)`);
  grad.addColorStop(1, `hsla(${(hueA + 320) % 360}, 100%, 62%, 0.12)`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = lineW;
  ctx.shadowColor = `hsla(${hueB}, 100%, 70%, ${glow})`;
  ctx.shadowBlur = 22;
  ctx.beginPath();
  const step = 5;
  for (let x = 0; x <= w + step; x += step) {
    const nx = x / Math.max(1, w);
    const b = nx * (arr.length - 2);
    const s = bpVisAt(arr, b);
    const y =
      yBase -
      s * amp -
      Math.sin(nx * 16 + bpVisPhase * 1.3) * (8 + amp * 0.07) -
      Math.cos(nx * 10 - bpVisPhase * 0.85) * (5 + amp * 0.045);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function bpVisDrawSpectrumPillars(ctx, arr, peaks, env, dt) {
  const w = bpVisW;
  const h = bpVisH;
  const count = 128;
  const baseY = h * 0.84;
  bpVisEnsureCaps(count);
  const capY = bpVisCapY;
  const capV = bpVisCapV;
  const capHold = bpVisCapHold;
  const gravity = 1850;
  const capH = 3.2;
  const topFade = ctx.createLinearGradient(0, 0, 0, baseY);
  topFade.addColorStop(0, 'rgba(14,19,36,0)');
  topFade.addColorStop(1, 'rgba(14,19,36,0.1)');
  ctx.fillStyle = topFade;
  ctx.fillRect(0, 0, w, baseY);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * w;
    const bi = (i / count) * 120;
    const v = bpVisAt(arr, bi);
    const p = bpVisAt(peaks, bi);
    const hh = Math.max(5, (v * 0.5 + p * 0.5) * (h * 0.62) * (0.35 + env * 0.85));
    const g = ctx.createLinearGradient(0, baseY - hh, 0, baseY);
    const hue = 200 - i * 1.8;
    g.addColorStop(0, `hsla(${hue}, 100%, 65%, 0.14)`);
    g.addColorStop(0.55, `hsla(${15 + i * 1.2}, 100%, 60%, 0.2)`);
    g.addColorStop(1, 'rgba(255,255,255,0.04)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, baseY - hh);
    ctx.stroke();
    const topY = baseY - hh;
    if (!capY || !capV || !capHold) continue;
    if (capY[i] <= 0) {
      capY[i] = topY;
      capV[i] = 0;
      capHold[i] = 0;
    } else if (topY < capY[i]) {
      // Rising bar pushes cap upward and refreshes short hover.
      capY[i] = topY;
      capV[i] = Math.min(0, capV[i]) - 120;
      capHold[i] = 0.07 + p * 0.11;
    } else if (capHold[i] > 0) {
      capHold[i] = Math.max(0, capHold[i] - dt);
      capV[i] *= 0.86;
    } else {
      capV[i] += gravity * dt;
      capY[i] += capV[i] * dt;
      if (capY[i] > topY) {
        capY[i] = topY;
        capV[i] = 0;
      }
      if (capY[i] > baseY - capH) {
        capY[i] = baseY - capH;
        capV[i] = 0;
      }
    }

    const capA = 0.18 + env * 0.18;
    const capW = 4.2;
    const capGrad = ctx.createLinearGradient(0, capY[i] - capH, 0, capY[i] + capH);
    capGrad.addColorStop(0, `rgba(255, 230, 192, ${capA + 0.08})`);
    capGrad.addColorStop(1, `rgba(255, 136, 92, ${capA})`);
    ctx.fillStyle = capGrad;
    ctx.fillRect(x - capW * 0.5, capY[i] - capH * 0.5, capW, capH);
  }
  ctx.restore();
}

function bpVisDrawGridGlow(ctx, env) {
  const w = bpVisW;
  const h = bpVisH;
  const floorY = h * 0.86;
  ctx.save();
  ctx.strokeStyle = `rgba(124, 175, 255, ${0.07 + env * 0.08})`;
  ctx.lineWidth = 1;
  for (let y = floorY; y < h; y += 10) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const vxStep = Math.max(28, Math.floor(w / 24));
  for (let x = 0; x < w; x += vxStep) {
    ctx.beginPath();
    ctx.moveTo(x, floorY);
    ctx.lineTo(x + (w * 0.5 - x) * 0.17, h);
    ctx.stroke();
  }
  const floor = ctx.createLinearGradient(0, floorY, 0, h);
  floor.addColorStop(0, `rgba(100, 155, 255, ${0.1 + env * 0.08})`);
  floor.addColorStop(1, 'rgba(2,6,14,0)');
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorY, w, h - floorY);
  ctx.restore();
}

function bpVisDrawFrame(dt) {
  const ctx = bpVisCtx;
  const arr = bpVisSmooth;
  const peaks = bpVisPeaks;
  if (!ctx || !arr || !peaks || bpVisW < 2 || bpVisH < 2) return;

  const instantaneous = bpVisReadSpectrum(dt);
  bpVisEnergy += (instantaneous - bpVisEnergy) * Math.min(1, dt * 7.5);
  const env = Math.min(1, Math.max(0, bpVisEnergy * 2.2));
  bpVisPhase += dt * (0.9 + env * 3.1);

  ctx.clearRect(0, 0, bpVisW, bpVisH);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  bpVisDrawGridGlow(ctx, env);
  bpVisDrawSpectrumPillars(ctx, arr, peaks, env, dt);
  const yBase = bpVisH * 0.84;
  bpVisDrawWaveLine(ctx, arr, 205, 16, 58 + env * 130, yBase, 1.8, 0.26);
  bpVisDrawWaveLine(ctx, peaks, 190, 8, 40 + env * 110, yBase + 8, 1.25, 0.2);
  ctx.restore();
}

function bpVisFrame(t) {
  const now = typeof t === 'number' ? t : performance.now();
  if (!bpVisLastAt) bpVisLastAt = now;
  const dt = Math.min(0.05, Math.max(0.001, (now - bpVisLastAt) / 1000));
  bpVisLastAt = now;
  const root = document.getElementById('brick-playground-root');
  const active =
    !!root &&
    root.classList.contains('active') &&
    (pgSeamMode || (playingRoot !== null && pgSources.length > 0));
  if (!active) {
    bpVisEnergy *= Math.max(0, 1 - dt * 6);
    if (bpVisEnergy < 0.01) {
      bpVisClear();
      bpVisRaf = 0;
      return;
    }
  }
  bpVisDrawFrame(dt);
  bpVisRaf = requestAnimationFrame(bpVisFrame);
}

function bpVisEnsureLoop() {
  if (bpVisRaf) return;
  bpVisLastAt = 0;
  bpVisRaf = requestAnimationFrame(bpVisFrame);
}

function bpVisInit(rootWrap) {
  bpVisResize();
  const onResize = () => {
    if (document.getElementById('brick-playground-root')?.classList.contains('active')) bpVisResize();
  };
  window.addEventListener('resize', onResize);
  ['pointerdown', 'wheel'].forEach(ev => {
    rootWrap.addEventListener(
      ev,
      () => {
        if (bpVisRaf) bpVisEnsureLoop();
      },
      { passive: true }
    );
  });
}

/** @param {boolean} [canMeltOnBreak] When false (e.g. view switch), only resets idle timer. */
function bpSnowBumpActivity(canMeltOnBreak = true) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const wasLongIdle = now - bpSnowLastActivity >= BP_SNOW_IDLE_MS;
  bpSnowLastActivity = now;
  bpSnowRampStart = 0;
  if (
    canMeltOnBreak &&
    wasLongIdle &&
    (bpSnowDepositSum > 0.04 || bpSnowParticles.length > 0)
  ) {
    bpSnowMelting = true;
    bpSnowParticles.length = 0;
    bpSnowSpawnFrac = 0;
  }
}

function bpSnowApplyMelt(dt) {
  const g = bpSnowGrid;
  if (!g) {
    bpSnowMelting = false;
    return;
  }
  const k = Math.exp(-BP_SNOW_MELT_RATE * dt);
  let sum = 0;
  for (let i = 0; i < g.length; i++) {
    g[i] *= k;
    if (g[i] < 0.004) g[i] = 0;
    sum += g[i];
  }
  bpSnowDepositSum = sum;
  if (sum < 0.025) {
    for (let i = 0; i < g.length; i++) g[i] = 0;
    bpSnowDepositSum = 0;
    bpSnowMelting = false;
  }
}

function bpSnowResize() {
  if (!bpSnowCanvas || !bpViewport) return;
  const w = Math.max(1, Math.floor(bpViewport.clientWidth));
  const h = Math.max(1, Math.floor(bpViewport.clientHeight));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const gw = Math.ceil(w / BP_SNOW_CELL);
  const gh = Math.ceil(h / BP_SNOW_CELL);
  if (!bpSnowGrid || gw !== bpSnowGw || gh !== bpSnowGh) {
    const next = new Float32Array(gw * gh);
    if (bpSnowGrid && bpSnowGw > 0 && bpSnowGh > 0) {
      const copyW = Math.min(bpSnowGw, gw);
      const copyH = Math.min(bpSnowGh, gh);
      for (let j = 0; j < copyH; j++) {
        for (let i = 0; i < copyW; i++) {
          next[j * gw + i] = bpSnowGrid[j * bpSnowGw + i];
        }
      }
    }
    bpSnowGrid = next;
    bpSnowGw = gw;
    bpSnowGh = gh;
    bpSnowDepositSum = 0;
    for (let i = 0; i < bpSnowGrid.length; i++) bpSnowDepositSum += bpSnowGrid[i];
  }
  bpSnowCanvas.width = Math.floor(w * dpr);
  bpSnowCanvas.height = Math.floor(h * dpr);
  bpSnowCanvas.style.width = `${w}px`;
  bpSnowCanvas.style.height = `${h}px`;
  bpSnowCtx = bpSnowCanvas.getContext('2d', { alpha: true });
  if (bpSnowCtx) {
    bpSnowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bpSnowCtx.imageSmoothingEnabled = true;
  }
  bpSnowW = w;
  bpSnowH = h;
  bpSnowDpr = dpr;
  bpSnowSyncCanvasLayout();
}

function bpSnowSyncCanvasLayout() {
  if (!bpSnowCanvas || !bpViewport || !bpWorld) return;
  const z = Math.max(0.12, bpZoom);
  const ww = bpViewport.clientWidth / z;
  const wh = bpViewport.clientHeight / z;
  bpSnowCanvas.style.left = `${-bpPanX / z}px`;
  bpSnowCanvas.style.top = `${-bpPanY / z}px`;
  bpSnowCanvas.style.width = `${ww}px`;
  bpSnowCanvas.style.height = `${wh}px`;
}

function bpSnowGetBrickRectsViewport() {
  if (!bpViewport || !bricksLayer) return [];
  const vr = bpViewport.getBoundingClientRect();
  const out = [];
  for (const el of bricksLayer.querySelectorAll('.bp-brick')) {
    const br = el.getBoundingClientRect();
    out.push({
      left: br.left - vr.left,
      top: br.top - vr.top,
      right: br.right - vr.left,
      bottom: br.bottom - vr.top,
    });
  }
  return out;
}

function bpSnowFindLandingTop(px, oldY, newY, rects) {
  let best = null;
  for (const r of rects) {
    if (px < r.left || px > r.right) continue;
    if (oldY < r.top && newY >= r.top) {
      if (best === null || r.top < best) best = r.top;
    }
  }
  return best;
}

function bpSnowDepositLine(px, topY, amount, halfSpread) {
  const g = bpSnowGrid;
  if (!g) return;
  const gw = bpSnowGw;
  const gh = bpSnowGh;
  const cy = Math.min(gh - 1, Math.max(0, Math.floor(topY / BP_SNOW_CELL)));
  for (let dx = -halfSpread; dx <= halfSpread; dx++) {
    const gx = Math.floor((px + dx * BP_SNOW_CELL * 0.6) / BP_SNOW_CELL);
    if (gx < 0 || gx >= gw) continue;
    const dist = 1 / (1 + Math.abs(dx) * 0.28);
    const idx = cy * gw + gx;
    const add = amount * dist;
    const prev = g[idx];
    g[idx] = Math.min(1.35, g[idx] + add);
    bpSnowDepositSum += g[idx] - prev;
  }
}

function bpSnowErode(dt, windAbs) {
  const g = bpSnowGrid;
  if (!g || bpSnowGw < 4 || bpSnowGh < 4) return;
  const gust = windAbs * 0.0009 * dt * 60;
  if (Math.random() < 0.00035 * dt * 60 + gust) {
    const cx = (Math.random() * bpSnowGw) | 0;
    const cy = (Math.random() * bpSnowGh) | 0;
    const rad = 4 + Math.random() * (10 + windAbs * 0.08);
    const rad2 = rad * rad;
    for (let j = -Math.ceil(rad); j <= Math.ceil(rad); j++) {
      for (let i = -Math.ceil(rad); i <= Math.ceil(rad); i++) {
        if (i * i + j * j > rad2) continue;
        const gx = cx + i;
        const gy = cy + j;
        if (gx < 0 || gy < 0 || gx >= bpSnowGw || gy >= bpSnowGh) continue;
        const idx = gy * bpSnowGw + gx;
        const prev = g[idx];
        if (prev <= 0) continue;
        const loss = prev * (0.25 + Math.random() * 0.45);
        g[idx] = Math.max(0, prev - loss);
        bpSnowDepositSum -= loss;
      }
    }
  }
  if (Math.random() < 0.00012 * dt * 60 + windAbs * 0.00025) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const sh = Math.min(3, 1 + Math.floor(windAbs / 52));
    const tmp = new Float32Array(g.length);
    for (let j = 0; j < bpSnowGh; j++) {
      for (let i = 0; i < bpSnowGw; i++) {
        const src = i - dir * sh;
        const v =
          src >= 0 && src < bpSnowGw ? g[j * bpSnowGw + src] : g[j * bpSnowGw + i] * 0.4;
        tmp[j * bpSnowGw + i] = v * 0.88;
      }
    }
    let sum = 0;
    for (let i = 0; i < g.length; i++) {
      g[i] = tmp[i];
      sum += g[i];
    }
    bpSnowDepositSum = sum;
  }
}

function bpSnowDrawDeposit() {
  const ctx = bpSnowCtx;
  const g = bpSnowGrid;
  if (!ctx || !g) return;
  const cell = BP_SNOW_CELL;
  for (let j = 0; j < bpSnowGh; j++) {
    for (let i = 0; i < bpSnowGw; i++) {
      const v = g[j * bpSnowGw + i];
      if (v <= 0.02) continue;
      const x = i * cell;
      const y = j * cell;
      const hCap = Math.min(10, 2 + v * 7);
      const a = 0.14 + Math.min(0.55, v * 0.42);
      ctx.fillStyle = `rgba(248,252,255,${a})`;
      ctx.fillRect(x, y - hCap + cell, cell, hCap);
      ctx.fillStyle = `rgba(220,235,245,${a * 0.45})`;
      ctx.fillRect(x, y - hCap + cell - 1, cell, 1.2);
    }
  }
}

function bpSnowDrawParticles() {
  const ctx = bpSnowCtx;
  if (!ctx) return;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (const p of bpSnowParticles) {
    const blur = p.r < 0.65 ? 0.85 : 1;
    ctx.globalAlpha = 0.35 + blur * 0.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function bpSnowTick(now, dt) {
  const root = document.getElementById('brick-playground-root');
  if (!root || !root.classList.contains('active') || !bpSnowCtx || !bpViewport) {
    bpSnowRaf = 0;
    return;
  }

  const idle = now - bpSnowLastActivity >= BP_SNOW_IDLE_MS;
  if (idle) {
    if (bpSnowRampStart <= 0) bpSnowRampStart = now;
  } else {
    bpSnowRampStart = 0;
    if (!bpSnowMelting) bpSnowSpawnFrac = 0;
  }

  const rampT = bpSnowRampStart > 0 ? (now - bpSnowRampStart) / 1000 : 0;
  const ramp = idle ? Math.min(1, Math.max(0, rampT / BP_SNOW_RAMP_SEC)) : 0;
  const spawnMul = ramp * ramp * (0.08 + 0.92 * ramp);

  if (now >= bpSnowWindNext) {
    bpSnowWindNext = now + 1800 + Math.random() * 4200;
    bpSnowWindTarget = (Math.random() * 2 - 1) * (38 + Math.random() * 95);
  }
  const wl = Math.min(1, dt * 2.8);
  bpSnowWind += (bpSnowWindTarget - bpSnowWind) * wl;
  if (now >= bpSnowGustNext) {
    bpSnowGustNext = now + 400 + Math.random() * 900;
    bpSnowWind += (Math.random() * 2 - 1) * (25 + Math.random() * 70);
  }

  const windAbs = Math.abs(bpSnowWind);

  if (bpSnowMelting) {
    bpSnowApplyMelt(dt);
    const ctxM = bpSnowCtx;
    if (ctxM) {
      ctxM.clearRect(0, 0, bpSnowW, bpSnowH);
      bpSnowDrawDeposit();
    }
    bpSnowRaf = bpSnowMelting ? requestAnimationFrame(bpSnowFrame) : 0;
    return;
  }

  if (idle && ramp > 0.02) {
    const rate =
      BP_SNOW_BASE_SPAWN * spawnMul * Math.max(0.45, bpSnowW / 560) * dt;
    bpSnowSpawnFrac += rate;
    while (bpSnowSpawnFrac >= 1 && bpSnowParticles.length < BP_SNOW_MAX_PARTICLES) {
      bpSnowSpawnFrac -= 1;
      bpSnowParticles.push({
        x: Math.random() * bpSnowW,
        y: -8 - Math.random() * 52,
        vx: bpSnowWind * 0.09 + (Math.random() * 2 - 1) * 14,
        vy: 26 + Math.random() * 58 + spawnMul * 48,
        r: 0.35 + Math.random() * 1.35,
        ph: Math.random() * Math.PI * 2,
      });
    }
  }

  const rects = bpSnowGetBrickRectsViewport();
  const next = [];
  for (const p of bpSnowParticles) {
    const oldY = p.y;
    const turb = Math.sin(now * 0.0023 + p.ph) * 14 + Math.sin(now * 0.0011 + p.ph * 2) * 6;
    p.vx += (bpSnowWind * 0.014 + turb * 0.0045 - p.vx * 0.042) * dt * 60;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ph += dt * 1.7;

    const land = bpSnowFindLandingTop(p.x, oldY, p.y, rects);
    if (land !== null) {
      const amt = 0.045 + Math.min(0.12, p.r * 0.07) * (0.5 + ramp * 0.5);
      bpSnowDepositLine(p.x, land, amt, 4);
      continue;
    }

    if (p.x < -20 || p.x > bpSnowW + 20 || p.y > bpSnowH + 30) {
      continue;
    }

    let hitTop = null;
    for (const r of rects) {
      if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) {
        hitTop = r.top;
        break;
      }
    }
    if (hitTop !== null) {
      bpSnowDepositLine(p.x, hitTop, 0.035, 3);
      continue;
    }

    next.push(p);
  }
  bpSnowParticles = next;

  bpSnowErode(dt, windAbs);

  const ctx = bpSnowCtx;
  ctx.clearRect(0, 0, bpSnowW, bpSnowH);
  bpSnowDrawDeposit();
  bpSnowDrawParticles();

  const keepGoing =
    idle ||
    bpSnowParticles.length > 0 ||
    bpSnowDepositSum > 0.06 ||
    bpSnowMelting;
  if (keepGoing) {
    bpSnowRaf = requestAnimationFrame(bpSnowFrame);
  } else {
    bpSnowRaf = 0;
  }
}

function bpSnowFrame(t) {
  const now = typeof t === 'number' ? t : performance.now();
  if (!bpSnowLastFrameAt) bpSnowLastFrameAt = now;
  const dt = Math.min(0.055, Math.max(0.001, (now - bpSnowLastFrameAt) / 1000));
  bpSnowLastFrameAt = now;
  bpSnowTick(now, dt);
}

function bpSnowEnsureLoop() {
  if (bpSnowRaf) return;
  const root = document.getElementById('brick-playground-root');
  if (!root || !root.classList.contains('active')) return;
  bpSnowLastFrameAt = 0;
  bpSnowRaf = requestAnimationFrame(bpSnowFrame);
}

function bpSnowInit(rootWrap) {
  bpSnowBumpActivity();
  bpSnowResize();
  const onResize = () => {
    if (document.getElementById('brick-playground-root')?.classList.contains('active')) bpSnowResize();
  };
  window.addEventListener('resize', onResize);
  const bump = () => {
    bpSnowBumpActivity();
    bpSnowEnsureLoop();
  };
  ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'].forEach(ev => {
    rootWrap.addEventListener(ev, bump, { passive: true });
  });
  setInterval(() => {
    const r = document.getElementById('brick-playground-root');
    if (r && r.classList.contains('active') && performance.now() - bpSnowLastActivity >= BP_SNOW_IDLE_MS) {
      bpSnowEnsureLoop();
    }
  }, 4000);
  bpSnowEnsureLoop();
}

function ensurePlaygroundGain() {
  if (!pgGain) {
    pgGain = AC.createGain();
    pgGain.gain.value = 1;
    pgGain.connect(masterGain);
    const analyser = bpVisualizerEnsureAnalyser();
    pgGain.connect(analyser);
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
      if (gapL >= BP_MAGNET_GAP_LO && gapL < BP_MAGNET_GAP_HI) ufUnion(A.id, B.id);
      else if (gapR >= BP_MAGNET_GAP_LO && gapR < BP_MAGNET_GAP_HI) ufUnion(A.id, B.id);
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

function ensureClusterDurLayer() {
  if (bpClusterDurLayer || !bpHudRoot) return;
  bpClusterDurLayer = document.createElement('div');
  bpClusterDurLayer.className = 'bp-cluster-dur-layer';
  bpClusterDurLayer.setAttribute('aria-hidden', 'true');
  bpHudRoot.appendChild(bpClusterDurLayer);
}

/** Total duration label above each cluster of 2+ connected (non-template) bricks, play order = left to right. */
function updateClusterDurationLabels() {
  ensureClusterDurLayer();
  if (!bpClusterDurLayer) return;
  bpClusterDurLayer.innerHTML = '';
  const roots = new Set();
  for (const id of brickMap.keys()) {
    const b = brickMap.get(id);
    if (!b || b.combTemplate) continue;
    roots.add(ufFind(id));
  }
  for (const root of roots) {
    const ids = clusterMembers(root).filter(i => !brickMap.get(i)?.combTemplate);
    if (ids.length < 2) continue;
    const sorted = ids
      .map(id => brickMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    let totalSec = 0;
    for (const br of sorted) {
      totalSec += bpGetPartDuration(br.fmt, br.songIdx, br.partIndex);
    }
    const box = clusterBBox(ids);
    if (!box) continue;
    const wrap = document.createElement('div');
    wrap.className = 'bp-cluster-dur-label';
    const durSpan = document.createElement('span');
    durSpan.className = 'bp-brick-dur';
    durSpan.innerHTML = fmtTimeHTML(totalSec);
    wrap.appendChild(durSpan);
    const cx = (box.minX + box.maxX) / 2;
    /** Same vertical band as `.bp-cluster-toolbar` (aligned with play / loop / seam row). */
    const toolbarH = 36;
    const cy = box.minY - BP_PAD - toolbarH / 2;
    wrap.style.left = `${cx}px`;
    wrap.style.top = `${cy}px`;
    bpClusterDurLayer.appendChild(wrap);
  }
}

function screenToWorld(clientX, clientY) {
  const rect = bpViewport.getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  return { x: (sx - bpPanX) / bpZoom, y: (sy - bpPanY) / bpZoom };
}

function bpEnsureSeamMarker() {
  if (bpSeamMarkerEl || !bpHudRoot) return;
  bpSeamMarkerEl = document.createElement('div');
  bpSeamMarkerEl.className = 'bp-seam-insert-marker';
  bpSeamMarkerEl.setAttribute('aria-hidden', 'true');
  bpSeamMarkerEl.style.display = 'none';
  bpHudRoot.appendChild(bpSeamMarkerEl);
}

function bpClearSeamMarker() {
  bpSeamHint = null;
  if (bpSeamMarkerEl) bpSeamMarkerEl.style.display = 'none';
}

function bpUpdateSeamMarker(worldX, worldY, movedIds) {
  bpEnsureSeamMarker();
  const movedSet = new Set(movedIds);
  let best = null;
  let bestD = Infinity;
  const roots = new Set();
  for (const id of brickMap.keys()) {
    const br = brickMap.get(id);
    if (!br || br.combTemplate) continue;
    roots.add(ufFind(id));
  }
  for (const root of roots) {
    const raw = clusterMembers(root).filter(id => !brickMap.get(id)?.combTemplate);
    if (raw.length < 2) continue;
    const sorted = raw
      .map(id => brickMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const L = sorted[i];
      const R = sorted[i + 1];
      if (movedSet.has(L.id) && movedSet.has(R.id)) continue;
      const gapMid = (L.x + L.width + R.x) / 2;
      const rowY = (L.y + R.y) / 2;
      const dy = Math.abs(worldY - rowY);
      if (dy > BP_BRICK_H * 0.65 + 10) continue;
      const d = Math.abs(worldX - gapMid);
      if (d < bestD && d <= BP_SEAM_HOVER_PX) {
        bestD = d;
        best = { leftId: L.id, rightId: R.id, seamX: gapMid, rowY };
      }
    }
  }
  bpSeamHint = best;
  if (best && bpSeamMarkerEl) {
    bpSeamMarkerEl.style.display = 'block';
    bpSeamMarkerEl.style.transform = `translate(${best.seamX - 1}px,${best.rowY}px)`;
    bpSeamMarkerEl.style.height = `${BP_BRICK_H}px`;
  } else if (bpSeamMarkerEl) {
    bpSeamMarkerEl.style.display = 'none';
  }
}

function bpApplySeamInsert(leftId, rightId, insertIds) {
  const L = brickMap.get(leftId);
  const R = brickMap.get(rightId);
  if (!L || !R) return false;
  if (ufFind(leftId) !== ufFind(rightId)) return false;
  const root = ufFind(leftId);
  const insertBricks = insertIds.map(id => brickMap.get(id)).filter(Boolean);
  if (insertBricks.length === 0) return false;
  const insertSet = new Set(insertIds);
  const sortedCluster = clusterMembers(root)
    .map(id => brickMap.get(id))
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);
  const withoutInsert = sortedCluster.filter(b => !insertSet.has(b.id));
  const idx = withoutInsert.findIndex((b, i) => b.id === leftId && withoutInsert[i + 1]?.id === rightId);
  if (idx < 0) return false;
  const insertSorted = [...insertBricks].sort((a, b) => a.x - b.x);
  const newOrder = [...withoutInsert.slice(0, idx + 1), ...insertSorted, ...withoutInsert.slice(idx + 1)];
  const rowY = Math.min(...newOrder.map(b => b.y));
  let cursorX = Math.min(...newOrder.map(b => b.x));
  for (const b of newOrder) {
    b.x = cursorX;
    b.y = rowY;
    cursorX += b.width + BP_BRICK_PACK_GAP;
    b.el.style.transform = `translate(${b.x}px,${b.y}px)`;
  }
  return true;
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
        if (gapR >= -5 && gapR < BP_SNAP) {
          const score = Math.abs(gapR) + yDist * 0.3;
          if (score < bestScore) {
            bestScore = score;
            bestDx = gapR;
            bestDy = ob.y - b.y;
          }
        }
        const gapL = b.x - (ob.x + ob.width);
        if (gapL >= -5 && gapL < BP_SNAP) {
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
  bpVisEnsureLoop();
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
  bpVisEnsureLoop();
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
  bpVisEnsureLoop();
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
  bpVisSyncCanvasLayout();
  bpSnowSyncCanvasLayout();
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
      activeBrickId = rec.id;
      dragPointerId = e.pointerId;
      stopPlaygroundPlayback();
      updateClusterUi();
    }

    let lastClientX = e.clientX;
    let lastClientY = e.clientY;
    let dragStarted = !!isDuplicateDrag;
    let ghostMode = false;
    let longPressTimer = null;
    if (!combTemplate && !isDuplicateDrag) {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (dragStarted) return;
        const nonT = clusterMembers(ufFind(rec.id)).filter(id => !brickMap.get(id)?.combTemplate);
        if (nonT.length < 2) return;
        dragStarted = true;
        ghostMode = true;
        snapshotBeforeDrag = capturePlaygroundBrickSnapshot();
        workingRec = rec;
        activeBrickId = rec.id;
        dragClusterIds = [rec.id];
        dragStartPos = new Map();
        dragStartPos.set(rec.id, { x: rec.x, y: rec.y });
        const w = screenToWorld(lastClientX, lastClientY);
        dragOffX = w.x - rec.x;
        dragOffY = w.y - rec.y;
        rec.el.classList.add('bp-brick--ghost');
        playClickUiSound();
      }, BP_GHOST_HOLD_MS);
    }

    const applyDragDelta = ev => {
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
    };

    const onMove = ev => {
      if (ev.pointerId !== dragPointerId) return;
      lastClientX = ev.clientX;
      lastClientY = ev.clientY;
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
      if (!combTemplate && !isDuplicateDrag) {
        if (!dragStarted) {
          const dist = Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY);
          if (dist > BP_DRAG_ARM_PX) {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
            dragStarted = true;
            snapshotBeforeDrag = capturePlaygroundBrickSnapshot();
            activeBrickId = workingRec.id;
            const root = ufFind(workingRec.id);
            dragClusterIds = clusterMembers(root);
            dragStartPos = new Map();
            for (const id of dragClusterIds) {
              const b = brickMap.get(id);
              if (b) dragStartPos.set(id, { x: b.x, y: b.y });
            }
            const w = screenToWorld(ev.clientX, ev.clientY);
            dragOffX = w.x - workingRec.x;
            dragOffY = w.y - workingRec.y;
          }
          return;
        }
        if (ghostMode) {
          if (!dragClusterIds.length || !dragStartPos) return;
          applyDragDelta(ev);
          const w2 = screenToWorld(ev.clientX, ev.clientY);
          bpUpdateSeamMarker(w2.x, w2.y, dragClusterIds);
          repositionClusterUi();
          return;
        }
      }
      if (!dragClusterIds.length || !dragStartPos) return;
      applyDragDelta(ev);
      if (!combTemplate && !isDuplicateDrag && !ghostMode) {
        const w2 = screenToWorld(ev.clientX, ev.clientY);
        bpUpdateSeamMarker(w2.x, w2.y, dragClusterIds);
      }
      repositionClusterUi();
    };

    const onUp = ev => {
      if (ev.pointerId !== dragPointerId) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      const seamHint = bpSeamHint;
      bpClearSeamMarker();
      rec.el.classList.remove('bp-brick--ghost');
      dragPointerId = null;
      dragStartPos = null;
      if (combTemplate && !combDupActivated) {
        activeBrickId = rec.id;
        dragClusterIds = [];
        updateClusterUi();
        return;
      }
      if (!combTemplate && !isDuplicateDrag && !dragStarted) {
        activeBrickId = rec.id;
        updateClusterUi();
        return;
      }
      let inserted = false;
      if (seamHint && dragClusterIds.length && !combTemplate && !isDuplicateDrag) {
        const h = seamHint;
        if (bpApplySeamInsert(h.leftId, h.rightId, dragClusterIds)) {
          inserted = true;
          ufRebuild();
          scheduleSave();
          updateClusterUi();
          if (snapshotBeforeDrag && !snapshotsEqual(snapshotBeforeDrag, capturePlaygroundBrickSnapshot())) {
            bpPushUndo(snapshotBeforeDrag);
          }
        }
      }
      if (!inserted) {
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
  updateClusterDurationLabels();
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
  if (!bpHudRoot || !activeBrickId) {
    updateClusterDurationLabels();
    return;
  }
  const root = ufFind(activeBrickId);
  const ids = clusterMembers(root);
  if (ids.length === 0) {
    updateClusterDurationLabels();
    return;
  }
  const box = clusterBBox(ids);
  if (!box) {
    updateClusterDurationLabels();
    return;
  }

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
  updateClusterDurationLabels();
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
  updateClusterDurationLabels();
}

function initBrickPlayground(mainContainer) {
  const wrap = document.createElement('div');
  wrap.id = 'brick-playground-root';
  wrap.className = 'brick-playground';
  wrap.innerHTML = `
    <div class="bp-header">
      <span class="bp-hint">Comb spine: move templates · Template: click / drag 5px+ to copy · Free brick: drag to snap (hold 1s = ghost reorder) · seam marker = insert between · Ctrl-drag duplicate · Ctrl+Z / Ctrl+Y · scroll zoom · empty area pan</span>
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
          <canvas class="bp-vis-canvas" aria-hidden="true"></canvas>
          <div class="bp-bricks-layer"></div>
          <canvas class="bp-snow-canvas" aria-hidden="true"></canvas>
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
  bpVisCanvas = wrap.querySelector('.bp-vis-canvas');
  bpSnowCanvas = wrap.querySelector('.bp-snow-canvas');
  bpHudRoot = wrap.querySelector('.bp-hud-layer');
  bpEnsureSeamMarker();

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
  bpVisInit(wrap);
  bpSnowInit(wrap);
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
    bpSnowBumpActivity(false);
    bpViewport.focus();
    updateClusterUi();
    bpVisResize();
    bpVisEnsureLoop();
    bpSnowResize();
    bpSnowEnsureLoop();
  } else if (!playground) {
    if (bpSnowRaf) {
      cancelAnimationFrame(bpSnowRaf);
      bpSnowRaf = 0;
    }
    if (bpVisRaf) {
      cancelAnimationFrame(bpVisRaf);
      bpVisRaf = 0;
    }
    bpVisClear();
  }
}
