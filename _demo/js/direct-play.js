/* =============================================================
   S.E.A.M Audio Audition — Direct Part Play
   ============================================================= */

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
  resetDirectPartUI(ps, key, partIndex, listItem);
  advanceDirectPartPlayToNext(fmt, songIdx, partIndex);
}

function resetDirectPartUI(ps, key, partIndex, listItem) {
  ps._directNode = null;
  ps._directPartIndex = null;
  ps._directPaused = false;
  const partItem = listItem.querySelector('.part-item');
  const playBtn = listItem.querySelector('.part-play-btn');
  const stopBtn = listItem.querySelector('.part-stop-btn');
  const miniBar = document.getElementById(`mini-bar-${key}-${partIndex}`);
  if (playBtn) {
    playBtn.innerHTML = '&#9654;';
    playBtn.title = 'Play this part';
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
    const pos = Math.min(ps._directSeekOffset + elapsed, dur);
    const pct = (pos / dur) * 100;
    
    const fill = document.getElementById(`mini-fill-${key}-${partIndex}`);
    const hnd  = document.getElementById(`mini-handle-${key}-${partIndex}`);
    if (fill) fill.style.width  = `${pct}%`;
    if (hnd)  hnd.style.left = `${pct}%`;
    
    if (pos < dur) requestAnimationFrame(tickMini);
  };
}

async function playPartDirectly(fmt, songIdx, partIndex, listItem) {
  if (AC.state === 'suspended') await AC.resume();
  const key  = `${fmt}_${songIdx}`;
  const ps   = ensurePlayerState(fmt, songIdx);

  await loadPartBuffer(fmt, songIdx, partIndex);

  const buf = ps.buffers[partIndex];
  if (!buf) return;

  // If already playing or paused, resume from pause
  if (ps._directNode && ps._directPartIndex === partIndex) {
    if (ps._directPaused) {
      resumeDirectPart(ps);
      const playBtn = listItem.querySelector('.part-play-btn');
      if (playBtn) {
        playBtn.innerHTML = '&#9646;&#9646;';
        playBtn.title = 'Pause';
      }
      // Resume the tick animation
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
  src.playbackRate.value = Math.max(0.01, Math.abs(STATE.speedPercent) / 100);
  src.connect(ps.gainNode);
  src.start();
  ps._directNode = src;
  ps._directPartIndex = partIndex;
  ps._directPaused = false;

  // Update UI
  const partItem = listItem.querySelector('.part-item');
  const playBtn = listItem.querySelector('.part-play-btn');
  const stopBtn = listItem.querySelector('.part-stop-btn');
  const miniBar = document.getElementById(`mini-bar-${key}-${partIndex}`);
  if (playBtn) {
    playBtn.innerHTML = '&#9646;&#9646;';
    playBtn.title = 'Pause';
  }
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
        newSrc.playbackRate.value = Math.max(0.01, Math.abs(STATE.speedPercent) / 100);
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
