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
  timeLabel.textContent = '0:00';
  timeDisp.appendChild(timeLabel);
  cont.appendChild(timeDisp);

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
}

function renderBricks(fmt, songIdx, totalDur) {
  const key      = `${fmt}_${songIdx}`;
  const ps       = STATE.players[key];
  const bricksRow = document.getElementById(`bricks-row-${key}`);
  if (!bricksRow) return;
  bricksRow.innerHTML = '';

  ps.sequence.forEach((item, seqIdx) => {
    const dur = ps.partDurations[item.partIndex] || 0;
    const flexPct = totalDur > 0 ? (dur / totalDur) : (1 / ps.sequence.length);

    const brick = document.createElement('div');
    brick.className = 'part-brick' + (seqIdx === ps.currentSeqIdx ? ' active-brick' : '');
    brick.style.flexGrow = flexPct * ps.sequence.length;
    brick.style.background = item.partIndex === -1 ? 'var(--text3)' : partColor(item.partIndex);
    brick.dataset.key   = key;
    brick.dataset.part  = item.partIndex;
    brick.dataset.seqidx = seqIdx;

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
      e.dataTransfer.setData('brick-move', JSON.stringify({ fmt, songIdx, seqIdx }));
      e.dataTransfer.effectAllowed = 'move';
    });

    bricksRow.appendChild(brick);
  });
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
    e.dataTransfer.dropEffect = 'move';
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
          const [moved] = ps.sequence.splice(d.seqIdx, 1);
          const newIdx  = insertIdx > d.seqIdx ? insertIdx - 1 : insertIdx;
          ps.sequence.splice(newIdx, 0, moved);
          markCompositionDirty(fmt, songIdx);
          reRenderSeek(fmt, songIdx);
        }
      } catch(e) {}
    }

    insertIdx = null;
    saveSession();
  });
}
