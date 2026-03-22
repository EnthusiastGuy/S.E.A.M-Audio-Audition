/* =============================================================
   S.E.A.M Audio Audition — Seekbar, Bricks, Loop Controls
   ============================================================= */

// ─── SEEK BAR RENDER ─────────────────────────────────────────
function renderSeekBar(fmt, songIdx) {
  const key  = `${fmt}_${songIdx}`;
  const ps   = STATE.players[key];
  const song = STATE.songs[fmt][songIdx];
  const cont = document.getElementById(`seek-container-${key}`);
  if (!cont || !ps) return;

  cont.innerHTML = '';

  let totalDur = 0;
  ps.sequence.forEach(item => {
    const d = ps.partDurations[item.partIndex] || 0;
    totalDur += d;
  });
  if (totalDur === 0) totalDur = song.duration || 1;

  // Bricks row
  const bricksRow = document.createElement('div');
  bricksRow.className = 'part-bricks';
  bricksRow.id = `bricks-row-${key}`;
  cont.appendChild(bricksRow);

  renderBricks(fmt, songIdx, totalDur);

  // Time display
  const timeDisp = document.createElement('div');
  timeDisp.className = 'time-display';
  const timeLabel = document.createElement('div');
  timeLabel.className = 'time-current-label';
  timeLabel.id = `time-label-${key}`;
  timeLabel.innerHTML = fmtTimeHTML(0);
  timeDisp.appendChild(timeLabel);
  cont.appendChild(timeDisp);
  clampSeekTimeLabelLeft(timeLabel, 0);

  // Seekbar track
  const track = document.createElement('div');
  track.className = 'seekbar-track';
  track.id = `seekbar-${key}`;
  const fill = document.createElement('div');
  fill.className = 'seekbar-fill';
  fill.id = `seekfill-${key}`;
  fill.style.width = '0%';
  const handle = document.createElement('div');
  handle.className = 'seekbar-handle';
  handle.id = `seekhandle-${key}`;
  handle.style.left = '0%';
  track.appendChild(fill);
  track.appendChild(handle);
  cont.appendChild(track);

  const transportRow = document.createElement('div');
  transportRow.className = 'seek-transport-row';
  transportRow.id = `transport-${key}`;

  const transportControls = document.createElement('div');
  transportControls.className = 'transport-controls';
  transportControls.id = `transport-controls-${key}`;

  const previewWrap = document.createElement('div');
  previewWrap.className = 'brick-preview-wrap';
  previewWrap.id = `brick-preview-wrap-${key}`;
  previewWrap.setAttribute('role', 'img');
  previewWrap.setAttribute(
    'aria-label',
    'Timeline magnifier: center shows detail around current playback; far left is song start, far right is song end.'
  );

  const previewCanvas = document.createElement('canvas');
  previewCanvas.className = 'brick-preview-canvas';
  previewCanvas.id = `brick-preview-canvas-${key}`;
  previewCanvas.setAttribute('aria-hidden', 'true');

  const previewCenter = document.createElement('div');
  previewCenter.className = 'brick-preview-center-line';

  const previewFlash = document.createElement('div');
  previewFlash.className = 'brick-preview-flash';

  previewWrap.appendChild(previewCanvas);
  previewWrap.appendChild(previewCenter);
  previewWrap.appendChild(previewFlash);

  transportRow.appendChild(transportControls);
  transportRow.appendChild(previewWrap);
  cont.appendChild(transportRow);

  wireBrickPreview(fmt, songIdx);

  // Seek pct
  const pct = document.createElement('div');
  pct.className = 'seek-pct';
  pct.id = `seekpct-${key}`;
  pct.textContent = '0.0%';
  cont.appendChild(pct);

  // Loop buttons row
  const loopRow = document.createElement('div');
  loopRow.className = 'loop-buttons-row';
  loopRow.id = `loop-row-${key}`;
  cont.appendChild(loopRow);

  renderLoopButtons(fmt, songIdx, totalDur);

  // Seekbar interaction
  setupSeekbarInteraction(fmt, songIdx, track, totalDur);

  // Drag-over on bricks row (for part list → timeline drops)
  setupBricksDropZone(fmt, songIdx);

  syncSongCompositeDuration(fmt, songIdx);
}

function renderBricks(fmt, songIdx, totalDur) {
  const key      = `${fmt}_${songIdx}`;
  const ps       = STATE.players[key];
  const bricksRow = document.getElementById(`bricks-row-${key}`);
  if (!bricksRow) return;
  disconnectBrickWaveObservers(ps);
  bricksRow.innerHTML = '';

  ps.sequence.forEach((item, seqIdx) => {
    const dur = ps.partDurations[item.partIndex] || 0;
    const flexPct = totalDur > 0 ? (dur / totalDur) : (1 / ps.sequence.length);

    const brick = document.createElement('div');
    brick.className = 'part-brick' + (seqIdx === ps.currentSeqIdx ? ' active-brick' : '');
    brick.title = 'Drag to reorder; Ctrl+drag (⌘ on Mac) to duplicate';
    brick.style.flexGrow = flexPct * ps.sequence.length;
    brick.style.background = item.partIndex === -1 ? 'var(--text3)' : partColor(item.partIndex);
    brick.dataset.key   = key;
    brick.dataset.part  = item.partIndex;
    brick.dataset.seqidx = seqIdx;

    const wave = document.createElement('div');
    wave.className = 'part-brick-wave';
    brick.appendChild(wave);
    wireBrickWaveform(wave, ps, item.partIndex);

    const lbl = document.createElement('span');
    lbl.className = 'part-brick-label';
    lbl.textContent = item.partIndex === -1 ? 'Full' : String(STATE.songs[fmt][songIdx].parts[item.partIndex]?.num ?? seqIdx+1);
    brick.appendChild(lbl);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'brick-delete';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove from timeline';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ps.sequence.length <= 1) return;
      ps.sequence.splice(seqIdx, 1);
      markCompositionDirty(fmt, songIdx);
      reRenderSeek(fmt, songIdx);
      saveSession();
    });
    brick.appendChild(delBtn);

    // Click to seek to this part
    brick.addEventListener('click', () => seekToPart(fmt, songIdx, seqIdx));

    // Hover highlight
    brick.addEventListener('mouseenter', () => highlightPartInstances(key, item.partIndex, true));
    brick.addEventListener('mouseleave', () => highlightPartInstances(key, item.partIndex, false));

    // Drag to reorder bricks
    brick.draggable = true;
    brick.addEventListener('dragstart', (e) => {
      const dup = !!(e.ctrlKey || e.metaKey);
      e.dataTransfer.setData(
        'brick-move',
        JSON.stringify({ fmt, songIdx, seqIdx, duplicate: dup })
      );
      e.dataTransfer.effectAllowed = 'copyMove';
    });

    bricksRow.appendChild(brick);
  });
}

/** One vertical line per CSS pixel of the wave area (capped); stroke scales so on-screen width stays constant. */
const BRICK_WAVE_MAX_COLUMNS = 24000;
const BRICK_WAVE_LINE_CSS_PX = 0.32;

function disconnectBrickWaveObservers(ps) {
  if (!ps || !ps._brickWaveObservers) return;
  ps._brickWaveObservers.forEach((ro) => {
    try { ro.disconnect(); } catch (e) {}
  });
  ps._brickWaveObservers = [];
}

function wireBrickWaveform(waveEl, ps, partIndex) {
  if (!ps._brickWaveObservers) ps._brickWaveObservers = [];
  let raf = null;
  const run = () => {
    updateBrickWaveformEl(waveEl, ps, partIndex);
  };
  const schedule = () => {
    if (raf != null) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = null;
      run();
    });
  };

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => schedule());
    ro.observe(waveEl);
    ps._brickWaveObservers.push(ro);
  }
  schedule();
  requestAnimationFrame(schedule);
}

function updateBrickWaveformEl(waveEl, ps, partIndex) {
  const w = Math.max(1, Math.floor(waveEl.getBoundingClientRect().width || waveEl.clientWidth));
  const uri = getBrickWaveformDataUri(ps, partIndex, w);
  if (uri) {
    waveEl.style.backgroundImage = `url("${uri}")`;
  } else {
    waveEl.style.backgroundImage = 'none';
  }
}

function getBrickWaveformDataUri(ps, partIndex, widthPx) {
  if (!ps || !ps.buffers) return null;
  if (!ps._brickWaveCache) ps._brickWaveCache = {};

  const w = Math.max(1, Math.floor(widthPx));
  const cacheKey = `${partIndex}_${w}`;
  if (ps._brickWaveCache[cacheKey] !== undefined) return ps._brickWaveCache[cacheKey];

  const buf = ps.buffers[partIndex];
  if (!buf) {
    ps._brickWaveCache[cacheKey] = null;
    return null;
  }

  const channelData = buf.getChannelData(0);
  if (!channelData || channelData.length === 0) {
    ps._brickWaveCache[cacheKey] = null;
    return null;
  }

  const n = channelData.length;
  const columns = Math.max(8, Math.min(w, n, BRICK_WAVE_MAX_COLUMNS));
  const halfHeight = 12;
  const centerY = 14;
  const floorAmp = 0.07;
  const points = [];

  for (let i = 0; i < columns; i++) {
    const start = Math.floor((i * n) / columns);
    const end = Math.floor(((i + 1) * n) / columns);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(channelData[j]);
      if (v > peak) peak = v;
    }
    const amp = Math.max(floorAmp, peak);
    const x = (i + 0.5).toFixed(3);
    const yTop = (centerY - amp * halfHeight).toFixed(3);
    const yBottom = (centerY + amp * halfHeight).toFixed(3);
    points.push(`M ${x} ${yTop} L ${x} ${yBottom}`);
  }

  const strokeUser = BRICK_WAVE_LINE_CSS_PX * (columns / Math.max(1, w));
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${columns} 28' preserveAspectRatio='none' shape-rendering='crispEdges'>` +
    `<path d='${points.join(' ')}' stroke='rgba(255,255,255,0.45)' stroke-width='${strokeUser}' stroke-linecap='butt' fill='none'/>` +
    `</svg>`;
  const uri = `data:image/svg+xml;base64,${btoa(svg)}`;
  ps._brickWaveCache[cacheKey] = uri;
  return uri;
}

function renderLoopButtons(fmt, songIdx, totalDur) {
  const key     = `${fmt}_${songIdx}`;
  const ps      = STATE.players[key];
  const loopRow = document.getElementById(`loop-row-${key}`);
  if (!loopRow) return;
  loopRow.innerHTML = '';

  const song = STATE.songs[fmt][songIdx];

  let offset = 0;
  ps.sequence.forEach((item, seqIdx) => {
    const dur = ps.partDurations[item.partIndex] || 0;
    const part = song.parts[item.partIndex];
    const isLoopable = part && part.nexts.includes(part.num);

    if (isLoopable) {
      const startPct = totalDur > 0 ? offset / totalDur : 0;
      const endPct   = totalDur > 0 ? (offset + dur) / totalDur : 1;
      const midPct   = (startPct + endPct) / 2 * 100;

      const wrapper = document.createElement('div');
      wrapper.className = 'loop-btn-wrapper';
      wrapper.style.left = `${midPct}%`;

      const btn = document.createElement('button');
      btn.className = 'loop-btn';
      btn.id = `loop-btn-${key}-${seqIdx}`;
      const loopVal = ps.loopSettings[seqIdx] ?? 1;
      btn.textContent = formatLoopLabel(loopVal);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showLoopDropdown(e, fmt, songIdx, seqIdx);
      });
      wrapper.appendChild(btn);
      loopRow.appendChild(wrapper);
    }

    offset += dur;
  });
}

function formatLoopLabel(val, done) {
  if (val === 1)   return 'Continue';
  if (val === -1)  return done != null ? `Loop ∞` : 'Forever ∞';
  if (done != null) return `Loop ${done}/${val}`;
  return `Loop ×${val}`;
}

// ─── SEEK INTERACTION ────────────────────────────────────────
function setupSeekbarInteraction(fmt, songIdx, track, totalDur) {
  const key = `${fmt}_${songIdx}`;
  let dragging = false;

  function seek(x) {
    const rect  = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    const targetSecs = ratio * totalDur;
    seekToTime(fmt, songIdx, targetSecs, totalDur);
  }

  track.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('seekbar-handle') || e.button !== 0) return;
    dragging = true;
    seek(e.clientX);
    e.preventDefault();
  });

  const handle = document.getElementById(`seekhandle-${key}`);
  if (handle) {
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    seek(e.clientX);
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // Touch
  track.addEventListener('touchstart', (e) => {
    dragging = true;
    seek(e.touches[0].clientX);
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    seek(e.touches[0].clientX);
  });
  document.addEventListener('touchend', () => { dragging = false; });
}

function reRenderSeek(fmt, songIdx) {
  const key  = `${fmt}_${songIdx}`;
  const cont = document.getElementById(`seek-container-${key}`);
  const ps   = STATE.players[key];
  if (!cont || !ps) return;

  const totalDur = ps.sequence.reduce((s,item) => s + (ps.partDurations[item.partIndex]||0), 0) || 1;
  renderBricks(fmt, songIdx, totalDur);
  renderLoopButtons(fmt, songIdx, totalDur);
  setupBricksDropZone(fmt, songIdx);
  syncSongCompositeDuration(fmt, songIdx);
  updateActionButtons(fmt, songIdx, inferTransportState(fmt, songIdx));
  syncBrickPreview(fmt, songIdx);
}

// ─── LOOP DROPDOWN ───────────────────────────────────────────
let activeLoopDropdown = null;

function showLoopDropdown(e, fmt, songIdx, seqIdx) {
  const dd = document.getElementById('loop-dropdown');
  dd.classList.remove('hidden');
  dd.style.left = `${e.clientX}px`;
  dd.style.top  = `${e.clientY + 10}px`;
  dd.style.position = 'fixed';

  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  const cur = ps?.loopSettings[seqIdx] ?? 1;
  dd.querySelectorAll('.loop-option').forEach(opt => {
    opt.classList.toggle('selected', parseInt(opt.dataset.val) === cur);
  });

  activeLoopDropdown = { fmt, songIdx, seqIdx };

  dd.onclick = (ev) => {
    const opt = ev.target.closest('.loop-option');
    if (!opt) return;
    const val = parseInt(opt.dataset.val);
    if (ps) {
      ps.loopSettings[seqIdx] = val;
      ps.loopPlayCount = 0;
    }
    const btn = document.getElementById(`loop-btn-${key}-${seqIdx}`);
    if (btn) btn.textContent = formatLoopLabel(val);
    dd.classList.add('hidden');
    saveSession();
  };

  setTimeout(() => {
    document.addEventListener('click', closeDdOnOutside, { once: true });
  }, 0);
}

function closeDdOnOutside(e) {
  const dd = document.getElementById('loop-dropdown');
  if (!dd.contains(e.target)) dd.classList.add('hidden');
}

// ─── BRICKS DROP ZONE ────────────────────────────────────────
function setupBricksDropZone(fmt, songIdx) {
  const key      = `${fmt}_${songIdx}`;
  const bricksRow = document.getElementById(`bricks-row-${key}`);
  if (!bricksRow) return;
  if (bricksRow.dataset.dropZoneBound === '1') return;
  bricksRow.dataset.dropZoneBound = '1';
  const ps       = STATE.players[key];

  let insertIdx = null;
  let insertLine = null;

  function getInsertIndex(x) {
    const bricks = bricksRow.querySelectorAll('.part-brick');
    const rect   = bricksRow.getBoundingClientRect();
    const relX   = x - rect.left;
    let idx = bricks.length;
    for (let i = 0; i < bricks.length; i++) {
      const br = bricks[i].getBoundingClientRect();
      const mid = br.left + br.width / 2 - rect.left;
      if (relX < mid) { idx = i; break; }
    }
    return idx;
  }

  function showInsertLine(x) {
    if (!insertLine) {
      insertLine = document.createElement('div');
      insertLine.className = 'insert-line';
      bricksRow.appendChild(insertLine);
    }
    const rect  = bricksRow.getBoundingClientRect();
    const bricks = bricksRow.querySelectorAll('.part-brick');
    let lineX;
    const idx = getInsertIndex(x);
    if (idx === 0) {
      lineX = 0;
    } else if (idx >= bricks.length) {
      lineX = rect.width;
    } else {
      const brickRect = bricks[idx].getBoundingClientRect();
      lineX = brickRect.left - rect.left - 1;
    }
    insertLine.style.left = `${lineX}px`;
    insertIdx = idx;
  }

  bricksRow.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    showInsertLine(e.clientX);
  });

  bricksRow.addEventListener('dragleave', () => {
    if (insertLine) { insertLine.remove(); insertLine = null; }
    insertIdx = null;
  });

  bricksRow.addEventListener('drop', (e) => {
    e.preventDefault();
    if (insertLine) { insertLine.remove(); insertLine = null; }

    const fromListData  = e.dataTransfer.getData('part-source');
    const brickMoveData = e.dataTransfer.getData('brick-move');

    if (fromListData) {
      try {
        const d = JSON.parse(fromListData);
        if (d.fmt === fmt && d.songIdx === songIdx && insertIdx !== null) {
          const newItem = {
            partIndex: d.partIndex,
            label: d.partIndex === -1 ? (STATE.songs[fmt][songIdx].mainFile || 'Full') : STATE.songs[fmt][songIdx].parts[d.partIndex]?.file
          };
          ps.sequence.splice(insertIdx, 0, newItem);
          markCompositionDirty(fmt, songIdx);
          reRenderSeek(fmt, songIdx);
        }
      } catch(e) {}
    } else if (brickMoveData) {
      try {
        const d = JSON.parse(brickMoveData);
        if (d.fmt === fmt && d.songIdx === songIdx && insertIdx !== null) {
          const src = ps.sequence[d.seqIdx];
          if (!src) return;
          if (d.duplicate) {
            const copy = { partIndex: src.partIndex, label: src.label };
            ps.sequence.splice(insertIdx, 0, copy);
          } else {
            const [moved] = ps.sequence.splice(d.seqIdx, 1);
            const newIdx = insertIdx > d.seqIdx ? insertIdx - 1 : insertIdx;
            ps.sequence.splice(newIdx, 0, moved);
          }
          markCompositionDirty(fmt, songIdx);
          reRenderSeek(fmt, songIdx);
        }
      } catch(e) {}
    }

    insertIdx = null;
    saveSession();
  });
}

// ─── BRICK PREVIEW (magnifier lens: center = high zoom, edges = full song) ─
const BRICK_PREVIEW_PX_PER_SEC = 88;
/** Fraction of half-width on each side of center (0.2 → 40% width = lens). */
const BRICK_PREVIEW_LENS_EDGE_FRAC = 0.2;
/** Horizontal subsamples per column: smooths lens time-mapping (reduces banding / stair-steps). */
const BRICK_PREVIEW_AA_SAMPLES = 4;

function wireBrickPreview(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const wrap = document.getElementById(`brick-preview-wrap-${key}`);
  if (!wrap || wrap.dataset.brickPreviewWired === '1') return;
  wrap.dataset.brickPreviewWired = '1';

  const ro = new ResizeObserver(() => syncBrickPreview(fmt, songIdx));
  ro.observe(wrap);
}

function syncBrickPreview(fmt, songIdx) {
  const ps = STATE.players[`${fmt}_${songIdx}`];
  if (!ps) return;
  const t = getGlobalPlaybackPosition(ps);
  updateBrickPreview(fmt, songIdx, ps, t);
}

function triggerBrickPreviewFlash(flashEl) {
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

function partColorCss(partIndex) {
  if (partIndex === -1) return '#546a8a';
  return partColor(partIndex);
}

function samplePeakLocal(buf, localT) {
  if (!buf || !isFinite(localT)) return 0;
  const dur = buf.duration;
  if (dur <= 0) return 0;
  const ch = buf.getChannelData(0);
  if (!ch || ch.length === 0) return 0;
  const t = Math.max(0, Math.min(localT, dur - 1e-9));
  const center = Math.floor((t / dur) * (ch.length - 1));
  const span = Math.max(2, Math.floor(ch.length / 400));
  let peak = 0;
  const i0 = Math.max(0, center - span);
  const i1 = Math.min(ch.length - 1, center + span);
  for (let i = i0; i <= i1; i++) {
    const v = Math.abs(ch[i]);
    if (v > peak) peak = v;
  }
  return Math.max(0.07, peak);
}

/**
 * Maps normalized x (0..1) to global time (seconds). Center band keeps the same
 * time span as the original full-width zoom; left edge → song start, right → end.
 */
function brickPreviewTimeAtU(u, windowSec, tCenter, totalDur) {
  const edge = BRICK_PREVIEW_LENS_EDGE_FRAC;
  const u0 = 0.5 - edge;
  const u1 = 0.5 + edge;
  const tL = tCenter - windowSec * 0.5;
  const tR = tCenter + windowSec * 0.5;

  if (u <= u0) {
    const end = Math.max(0, tL);
    return (u / u0) * end;
  }
  if (u >= u1) {
    const start = Math.min(totalDur, tR);
    if (totalDur <= start) return totalDur;
    return start + ((u - u1) / (1 - u1)) * (totalDur - start);
  }
  return tCenter + ((u - 0.5) / (u1 - u0)) * windowSec;
}

function drawBrickPreviewCanvas(ctx, w, h, ps, centerGlobal, totalDur) {
  const floorAmp = 0.07;
  const halfAmpPx = (h * 0.38);
  const cy = h * 0.5;
  const windowSec = Math.max(2.5, w / BRICK_PREVIEW_PX_PER_SEC);
  const tCenter = Math.max(0, Math.min(centerGlobal, totalDur));

  ctx.fillStyle = 'rgba(15, 52, 96, 0.65)';
  ctx.fillRect(0, 0, w, h);

  if (totalDur <= 0 || !ps.sequence.length) return;

  let acc = 0;
  const segments = ps.sequence.map((item, seqIdx) => {
    const dur = ps.partDurations[item.partIndex] || 0;
    const start = acc;
    acc += dur;
    return { seqIdx, partIndex: item.partIndex, start, end: acc, dur };
  });

  function segmentForGlobalTime(tg) {
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const last = i === segments.length - 1;
      const endBound = last ? totalDur : s.end;
      if (tg >= s.start && (last ? tg <= endBound : tg < endBound)) return s;
    }
    return null;
  }

  for (let x = 0; x < w; x++) {
    const uC = (x + 0.5) / w;
    let tgC = brickPreviewTimeAtU(uC, windowSec, tCenter, totalDur);
    if (!isFinite(tgC)) continue;
    tgC = Math.max(0, Math.min(totalDur, tgC));

    const segC = segmentForGlobalTime(tgC);
    if (!segC) continue;

    const bufC = ps.buffers[segC.partIndex];
    if (!bufC) continue;

    let peakSum = 0;
    let n = 0;
    for (let k = 0; k < BRICK_PREVIEW_AA_SAMPLES; k++) {
      const u = (x + (k + 0.5) / BRICK_PREVIEW_AA_SAMPLES) / w;
      let tg = brickPreviewTimeAtU(u, windowSec, tCenter, totalDur);
      if (!isFinite(tg)) continue;
      tg = Math.max(0, Math.min(totalDur, tg));
      const seg = segmentForGlobalTime(tg);
      if (!seg || seg.partIndex !== segC.partIndex) continue;
      const buf = ps.buffers[seg.partIndex];
      if (!buf) continue;
      const localT = tg - seg.start;
      peakSum += samplePeakLocal(buf, localT);
      n++;
    }
    const peak =
      n > 0 ? peakSum / n : samplePeakLocal(bufC, tgC - segC.start);
    const amp = Math.max(floorAmp, peak);
    const barH = Math.max(1, amp * halfAmpPx * 2);
    ctx.fillStyle = partColorCss(segC.partIndex);
    ctx.globalAlpha = 0.92;
    ctx.fillRect(x, cy - barH * 0.5, 1, barH);
  }
  ctx.globalAlpha = 1;

  const edge = BRICK_PREVIEW_LENS_EDGE_FRAC;
  const u0 = 0.5 - edge;
  const u1 = 0.5 + edge;
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
  g.addColorStop(u0 * 0.85, 'rgba(0, 0, 0, 0.06)');
  g.addColorStop(u0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(u1, 'rgba(0, 0, 0, 0)');
  g.addColorStop(u1 + (1 - u1) * 0.15, 'rgba(0, 0, 0, 0.06)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const lensGrad = ctx.createLinearGradient(0, 0, w, 0);
  lensGrad.addColorStop(Math.max(0, u0 - 0.02), 'rgba(255, 255, 255, 0)');
  lensGrad.addColorStop(u0, 'rgba(255, 255, 255, 0.04)');
  lensGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.07)');
  lensGrad.addColorStop(u1, 'rgba(255, 255, 255, 0.04)');
  lensGrad.addColorStop(Math.min(1, u1 + 0.02), 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = lensGrad;
  ctx.fillRect(0, 0, w, h);
}

function updateBrickPreview(fmt, songIdx, ps, globalTime) {
  const key = `${fmt}_${songIdx}`;
  const canvas = document.getElementById(`brick-preview-canvas-${key}`);
  const flashEl = document.querySelector(`#brick-preview-wrap-${key} .brick-preview-flash`);
  if (!canvas || !ps) return;

  const totalDur =
    ps.sequence.reduce((s, item) => s + (ps.partDurations[item.partIndex] || 0), 0) || 0;
  const wrap = canvas.parentElement;
  const w = Math.max(1, Math.floor(wrap ? wrap.clientWidth : 0) || canvas.clientWidth || 1);
  const h = Math.max(1, Math.floor(wrap ? wrap.clientHeight : 0) || canvas.clientHeight || 1);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const needResize =
    canvas._brickPreviewW !== w ||
    canvas._brickPreviewH !== h ||
    canvas._brickPreviewDpr !== dpr;
  if (needResize) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas._brickPreviewW = w;
    canvas._brickPreviewH = h;
    canvas._brickPreviewDpr = dpr;
  }
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawBrickPreviewCanvas(ctx, w, h, ps, globalTime, totalDur);

  const seqIdx = ps.currentSeqIdx;
  const transportPlaying = (ps.node != null || ps.usingPreviewBuffer) && !ps.paused;
  if (
    transportPlaying &&
    ps._brickPreviewLastSeq != null &&
    ps._brickPreviewLastSeq !== seqIdx
  ) {
    triggerBrickPreviewFlash(flashEl);
  }
  ps._brickPreviewLastSeq = seqIdx;
}

// ─── DIRECT PART MINI WAVEFORM (same lens + draw path as timeline brick preview) ─

function getDirectPartPlaybackPositionForPreview(ps) {
  if (!ps._directNode && !ps._directPaused) return ps._directSeekOffset || 0;
  const dur = ps._directDuration || 0;
  if (dur <= 0) return 0;
  if (ps._directPaused) return Math.min(ps._directSeekOffset || 0, dur);
  const elapsed = AC.currentTime - ps._directStartAC;
  const rate = ps._directNode.playbackRate.value;
  return Math.min(ps._directSeekOffset + elapsed * rate, dur);
}

function wirePartMiniPreview(fmt, songIdx, partIndex) {
  const key = `${fmt}_${songIdx}`;
  const wrap = document.getElementById(`part-mini-preview-wrap-${key}-${partIndex}`);
  if (!wrap || wrap.dataset.partMiniPreviewWired === '1') return;
  wrap.dataset.partMiniPreviewWired = '1';
  const ro = new ResizeObserver(() => {
    const ps = STATE.players[key];
    if (!ps || ps._directPartIndex !== partIndex || (!ps._directNode && !ps._directPaused)) return;
    updatePartMiniWaveformPreview(fmt, songIdx, partIndex, ps, null);
  });
  ro.observe(wrap);
}

function triggerPartMiniPreviewFlash(fmt, songIdx, partIndex) {
  const key = `${fmt}_${songIdx}`;
  const flashEl = document.querySelector(`#part-mini-preview-wrap-${key}-${partIndex} .brick-preview-flash`);
  triggerBrickPreviewFlash(flashEl);
}

/**
 * @param {number|null} globalTime — pass null to derive position from ps (e.g. resize).
 */
function updatePartMiniWaveformPreview(fmt, songIdx, partIndex, ps, globalTime) {
  const key = `${fmt}_${songIdx}`;
  const canvas = document.getElementById(`part-mini-preview-canvas-${key}-${partIndex}`);
  if (!canvas || !ps) return;
  if (ps._directPartIndex !== partIndex || (!ps._directNode && !ps._directPaused)) return;

  const buf = ps.buffers[partIndex];
  if (!buf) return;
  const totalDur = buf.duration || 0;
  if (totalDur <= 0) return;

  const t = globalTime != null ? globalTime : getDirectPartPlaybackPositionForPreview(ps);

  const wrap = canvas.parentElement;
  const w = Math.max(1, Math.floor(wrap ? wrap.clientWidth : 0) || canvas.clientWidth || 1);
  const h = Math.max(1, Math.floor(wrap ? wrap.clientHeight : 0) || canvas.clientHeight || 1);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const needResize =
    canvas._partMiniPreviewW !== w ||
    canvas._partMiniPreviewH !== h ||
    canvas._partMiniPreviewDpr !== dpr;
  if (needResize) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas._partMiniPreviewW = w;
    canvas._partMiniPreviewH = h;
    canvas._partMiniPreviewDpr = dpr;
  }
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const fakePs = {
    sequence: [{ partIndex }],
    partDurations: { [partIndex]: totalDur },
    buffers: { [partIndex]: buf },
  };
  drawBrickPreviewCanvas(ctx, w, h, fakePs, t, totalDur);
}
