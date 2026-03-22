/* =============================================================
   S.E.A.M Audio Audition — Direct Part Play
   ============================================================= */

const DIRECT_PART_PLAY_ICON = '&#9654;';
const DIRECT_PART_PAUSE_ICON = '&#9646;&#9646;';
const DIRECT_PART_LOOP_IDLE_ICON =
  `${DIRECT_PART_PLAY_ICON}<span class="part-loop-glyph" aria-hidden="true">&#8635;</span>`;

function syncDirectPartTransportButtons(ps, key, partIndex, listItem) {
  const playBtn = listItem.querySelector('.part-play-btn');
  const loopBtn = listItem.querySelector('.part-play-loop-btn');
  if (!playBtn || !loopBtn) return;
  if (ps._directPartIndex !== partIndex || (!ps._directNode && !ps._directPaused)) return;

  if (ps._directPaused) {
    playBtn.innerHTML = DIRECT_PART_PLAY_ICON;
    playBtn.title = ps._directLoop ? 'Play once' : 'Resume';
    loopBtn.innerHTML = DIRECT_PART_LOOP_IDLE_ICON;
    loopBtn.title = ps._directLoop ? 'Resume loop' : 'Play looped';
    return;
  }
  if (ps._directLoop) {
    playBtn.innerHTML = DIRECT_PART_PLAY_ICON;
    playBtn.title = 'Play once';
    loopBtn.innerHTML = DIRECT_PART_PAUSE_ICON;
    loopBtn.title = 'Pause';
  } else {
    playBtn.innerHTML = DIRECT_PART_PAUSE_ICON;
    playBtn.title = 'Pause';
    loopBtn.innerHTML = DIRECT_PART_LOOP_IDLE_ICON;
    loopBtn.title = 'Play looped';
  }
}

function handleDirectPartPlayClick(fmt, songIdx, partIndex, itemWrapper) {
  const key = `${fmt}_${songIdx}`;
  const ps = STATE.players[key];
  if (ps && ps._directNode && ps._directPartIndex === partIndex) {
    if (ps._directLoop) {
      void playPartDirectly(fmt, songIdx, partIndex, itemWrapper, { loop: false });
      return;
    }
    if (!ps._directPaused) {
      pauseDirectPart(ps);
      syncDirectPartTransportButtons(ps, key, partIndex, itemWrapper);
      return;
    }
    resumeDirectPart(ps);
    syncDirectPartTransportButtons(ps, key, partIndex, itemWrapper);
    const tickMini = createTickFunction(fmt, songIdx, partIndex);
    requestAnimationFrame(tickMini);
    return;
  }
  void playPartDirectly(fmt, songIdx, partIndex, itemWrapper, { loop: false });
}

function handleDirectPartLoopClick(fmt, songIdx, partIndex, itemWrapper) {
  const key = `${fmt}_${songIdx}`;
  const ps = STATE.players[key];
  if (ps && ps._directNode && ps._directPartIndex === partIndex) {
    if (ps._directLoop) {
      if (!ps._directPaused) {
        pauseDirectPart(ps);
        syncDirectPartTransportButtons(ps, key, partIndex, itemWrapper);
      } else {
        resumeDirectPart(ps);
        syncDirectPartTransportButtons(ps, key, partIndex, itemWrapper);
        const tickMini = createTickFunction(fmt, songIdx, partIndex);
        requestAnimationFrame(tickMini);
      }
      return;
    }
    void playPartDirectly(fmt, songIdx, partIndex, itemWrapper, { loop: true });
    return;
  }
  void playPartDirectly(fmt, songIdx, partIndex, itemWrapper, { loop: true });
}

/** Matches `src.playbackRate` used when starting direct part playback (absolute speed only). */
function getDirectPartPlaybackRate() {
  return Math.max(0.01, Math.abs(STATE.speedPercent) / 100);
}

/**
 * Keeps buffer timeline bookkeeping in sync when the speed knob changes during direct part play.
 */
function applyPlaybackRateToDirectPart(ps) {
  if (!ps._directNode) return;
  const oldRate = ps._directNode.playbackRate.value;
  const newRate = getDirectPartPlaybackRate();
  const elapsed = AC.currentTime - ps._directStartAC;
  const dur = ps._directDuration || 0;
  const pos = Math.min(ps._directSeekOffset + elapsed * oldRate, dur > 0 ? dur : Infinity);
  ps._directSeekOffset = pos;
  ps._directStartAC = AC.currentTime;
  ps._directNode.playbackRate.value = newRate;
}

function stopDirectPart(ps) {
  if (ps._directNode) {
    try { ps._directNode.stop(); } catch(e) {}
    ps._directNode.disconnect();
    ps._directNode = null;
  }
}

function pauseDirectPart(ps) {
  if (ps._directNode && !ps._directPaused) {
    ps._directPaused = true;
    ps._directPauseTime = AC.currentTime;
    // Mute the gain node instead of stopping (keeps node alive for resume)
    ps.gainNode.gain.setValueAtTime(0, AC.currentTime);
  }
}

function resumeDirectPart(ps) {
  if (ps._directNode && ps._directPaused) {
    ps._directPaused = false;
    // Resume audio by restoring gain (audio source has been playing in background, so timing is already correct)
    ps.gainNode.gain.setValueAtTime(1, AC.currentTime);
  }
}

function advanceDirectPartPlayToNext(fmt, songIdx, finishedPartIndex) {
  const key = `${fmt}_${songIdx}`;
  const list = document.getElementById(`parts-list-${key}`);
  if (!list) return;
  const wrappers = Array.from(list.querySelectorAll('.part-item-wrapper'));
  const idx = wrappers.findIndex(w => parseInt(w.dataset.partIndex, 10) === finishedPartIndex);
  if (idx < 0 || idx >= wrappers.length - 1) return;
  const next = wrappers[idx + 1];
  const nextPi = parseInt(next.dataset.partIndex, 10);
  void playPartDirectly(fmt, songIdx, nextPi, next);
}

function onDirectPartSourceEnded(ps, key, src, fmt, songIdx, partIndex, listItem) {
  if (ps._directNode !== src) return;
  if (ps._directLoop) {
    ps._directNode = null;
    void playPartDirectly(fmt, songIdx, partIndex, listItem, { loop: true });
    return;
  }
  resetDirectPartUI(ps, key, partIndex, listItem);
  advanceDirectPartPlayToNext(fmt, songIdx, partIndex);
}

function resetDirectPartUI(ps, key, partIndex, listItem) {
  ps._directNode = null;
  ps._directPartIndex = null;
  ps._directPaused = false;
  ps._directLoop = false;
  const partItem = listItem.querySelector('.part-item');
  const playBtn = listItem.querySelector('.part-play-btn');
  const loopBtn = listItem.querySelector('.part-play-loop-btn');
  const stopBtn = listItem.querySelector('.part-stop-btn');
  const miniBar = document.getElementById(`mini-bar-${key}-${partIndex}`);
  if (playBtn) {
    playBtn.innerHTML = DIRECT_PART_PLAY_ICON;
    playBtn.title = 'Play this part';
  }
  if (loopBtn) {
    loopBtn.innerHTML = DIRECT_PART_LOOP_IDLE_ICON;
    loopBtn.title = 'Play looped';
  }
  if (stopBtn) stopBtn.style.display = 'none';
  if (miniBar) miniBar.classList.remove('visible');
  if (partItem) partItem.classList.remove('playing-part');
}

function createTickFunction(fmt, songIdx, partIndex) {
  return function tickMini() {
    const key = `${fmt}_${songIdx}`;
    const ps = STATE.players[key];
    if (!ps || !ps._directNode || ps._directPaused) return;
    
    const dur = ps._directDuration;
    const elapsed = AC.currentTime - ps._directStartAC;
    const rate = ps._directNode.playbackRate.value;
    const pos = Math.min(ps._directSeekOffset + elapsed * rate, dur);
    const pct = (pos / dur) * 100;
    
    const fill = document.getElementById(`mini-fill-${key}-${partIndex}`);
    const hnd  = document.getElementById(`mini-handle-${key}-${partIndex}`);
    if (fill) fill.style.width  = `${pct}%`;
    if (hnd)  hnd.style.left = `${pct}%`;
    
    if (pos < dur) requestAnimationFrame(tickMini);
  };
}

async function playPartDirectly(fmt, songIdx, partIndex, listItem, opts = {}) {
  const wantLoop = !!opts.loop;
  if (AC.state === 'suspended') await AC.resume();
  const key  = `${fmt}_${songIdx}`;
  const ps   = ensurePlayerState(fmt, songIdx);

  await loadPartBuffer(fmt, songIdx, partIndex);

  const buf = ps.buffers[partIndex];
  if (!buf) return;

  // Same part, same mode: resume from pause only
  if (
    ps._directPartIndex === partIndex &&
    ps._directLoop === wantLoop &&
    (ps._directNode || ps._directPaused)
  ) {
    if (ps._directPaused) {
      resumeDirectPart(ps);
      syncDirectPartTransportButtons(ps, key, partIndex, listItem);
      const tickMini = createTickFunction(fmt, songIdx, partIndex);
      requestAnimationFrame(tickMini);
    }
    return;
  }

  stopDirectPart(ps);

  ps.gainNode.gain.cancelScheduledValues(AC.currentTime);
  ps.gainNode.gain.setValueAtTime(1, AC.currentTime);

  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = getDirectPartPlaybackRate();
  src.connect(ps.gainNode);
  src.start();
  ps._directNode = src;
  ps._directPartIndex = partIndex;
  ps._directPaused = false;
  ps._directLoop = wantLoop;

  // Update UI
  const partItem = listItem.querySelector('.part-item');
  const stopBtn = listItem.querySelector('.part-stop-btn');
  const miniBar = document.getElementById(`mini-bar-${key}-${partIndex}`);
  syncDirectPartTransportButtons(ps, key, partIndex, listItem);
  if (stopBtn) stopBtn.style.display = '';
  if (miniBar) miniBar.classList.add('visible');
  if (partItem) partItem.classList.add('playing-part');

  const dur = buf.duration;
  ps._directStartAC = AC.currentTime;
  ps._directSeekOffset = 0;
  ps._directDuration = dur;

  const tickMini = createTickFunction(fmt, songIdx, partIndex);
  requestAnimationFrame(tickMini);

  // Mini bar seek
  if (miniBar) {
    miniBar.onmousedown = (e) => {
      if (!ps._directNode) return;
      e.preventDefault();
      
      const performSeek = (clientX) => {
        const rect = miniBar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const seekPos = ratio * dur;
        
        // Stop current playback
        stopDirectPart(ps);
        
        // Create new source at seek position
        const newSrc = AC.createBufferSource();
        newSrc.buffer = buf;
        newSrc.playbackRate.value = getDirectPartPlaybackRate();
        newSrc.connect(ps.gainNode);
        newSrc.start(0, seekPos);
        ps._directNode = newSrc;
        ps._directStartAC = AC.currentTime;
        ps._directSeekOffset = seekPos;
        ps._directPaused = false;
        
        // Restart animation
        requestAnimationFrame(tickMini);
        
        newSrc.onended = () => {
          onDirectPartSourceEnded(ps, key, newSrc, fmt, songIdx, partIndex, listItem);
        };
      };
      
      // Handle initial click
      performSeek(e.clientX);
      
      // Handle dragging
      const handleMouseMove = (e) => {
        performSeek(e.clientX);
      };
      
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };
  }

  src.onended = () => {
    onDirectPartSourceEnded(ps, key, src, fmt, songIdx, partIndex, listItem);
  };
}
