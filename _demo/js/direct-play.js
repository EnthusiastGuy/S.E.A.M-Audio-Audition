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

function resetDirectPartUI(ps, key, partIndex, listItem) {
  ps._directNode = null;
  ps._directPartIndex = null;
  const playBtn = listItem.querySelector('.part-play-btn');
  const stopBtn = listItem.querySelector('.part-stop-btn');
  const miniBar = document.getElementById(`mini-bar-${key}-${partIndex}`);
  if (playBtn) {
    playBtn.innerHTML = '&#9654;';
    playBtn.title = 'Play this part';
  }
  if (stopBtn) stopBtn.style.display = 'none';
  if (miniBar) miniBar.classList.remove('visible');
  listItem.classList.remove('playing-part');
}

async function playPartDirectly(fmt, songIdx, partIndex, listItem) {
  if (AC.state === 'suspended') await AC.resume();
  const key  = `${fmt}_${songIdx}`;
  const ps   = ensurePlayerState(fmt, songIdx);

  await loadPartBuffer(fmt, songIdx, partIndex);

  const buf = ps.buffers[partIndex];
  if (!buf) return;

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

  // Update UI
  const playBtn = listItem.querySelector('.part-play-btn');
  const stopBtn = listItem.querySelector('.part-stop-btn');
  const miniBar = document.getElementById(`mini-bar-${key}-${partIndex}`);
  if (playBtn) {
    playBtn.innerHTML = '&#9646;&#9646;';
    playBtn.title = 'Pause';
  }
  if (stopBtn) stopBtn.style.display = '';
  if (miniBar) miniBar.classList.add('visible');
  listItem.classList.add('playing-part');

  const dur = buf.duration;
  ps._directStartAC = AC.currentTime;
  ps._directSeekOffset = 0;
  ps._directDuration = dur;

  function tickMini() {
    if (!ps._directNode || ps._directNode !== src) return;
    const elapsed = AC.currentTime - ps._directStartAC;
    const pos = Math.min(ps._directSeekOffset + elapsed, dur);
    const pct = (pos / dur) * 100;
    const fill = document.getElementById(`mini-fill-${key}-${partIndex}`);
    const hnd  = document.getElementById(`mini-handle-${key}-${partIndex}`);
    if (fill) fill.style.width  = `${pct}%`;
    if (hnd)  hnd.style.left = `${pct}%`;
    if (pos < dur) requestAnimationFrame(tickMini);
  }
  requestAnimationFrame(tickMini);

  // Mini bar seek
  if (miniBar) {
    miniBar.onclick = (e) => {
      if (!ps._directNode) return;
      const rect = miniBar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      stopDirectPart(ps);
      const seekPos = ratio * dur;
      const newSrc = AC.createBufferSource();
      newSrc.buffer = buf;
      newSrc.playbackRate.value = Math.max(0.01, Math.abs(STATE.speedPercent) / 100);
      newSrc.connect(ps.gainNode);
      newSrc.start(0, seekPos);
      ps._directNode = newSrc;
      ps._directStartAC = AC.currentTime;
      ps._directSeekOffset = seekPos;
      newSrc.onended = () => {
        if (ps._directNode !== newSrc) return;
        resetDirectPartUI(ps, key, partIndex, listItem);
      };
      requestAnimationFrame(tickMini);
    };
  }

  src.onended = () => {
    if (ps._directNode !== src) return;
    resetDirectPartUI(ps, key, partIndex, listItem);
  };
}
