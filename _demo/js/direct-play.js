/* =============================================================
   S.E.A.M Audio Audition — Direct Part Play
   ============================================================= */

const SEAM_SCHEDULE_AHEAD = 0.005;
/** Target max wall-clock duration (s) for the fast-forward hop between head and tail. */
const SEAM_FF_TARGET_WALL_SEC = 0.85;
/** Gain during fast-forward (reduces pitch-shift chirp annoyance). Head/tail stay at unity. */
const SEAM_FF_GAIN = 0.2;

function getDirectPartUnmutedGain(ps) {
  return ps._directSeamSkip && ps._directSeamPhase === 'ff' ? SEAM_FF_GAIN : 1;
}

function scheduleSeamPhaseGain(ps, linearGain, atAC) {
  const t = AC.currentTime;
  ps.gainNode.gain.cancelScheduledValues(t);
  ps.gainNode.gain.setValueAtTime(linearGain, Math.max(atAC, t));
}

const DIRECT_PART_PLAY_ICON = '&#9654;';
const DIRECT_PART_PAUSE_ICON = '&#9646;&#9646;';
const DIRECT_PART_LOOP_IDLE_ICON =
  `${DIRECT_PART_PLAY_ICON}<span class="part-loop-glyph" aria-hidden="true">&#8635;</span>`;
const DIRECT_PART_SEAM_IDLE_ICON =
  `${DIRECT_PART_PLAY_ICON}<span class="part-loop-glyph part-seam-glyph" aria-hidden="true">&#8635;</span>`;

function getPartListItemWrapper(fmt, songIdx, partIndex) {
  const key = `${fmt}_${songIdx}`;
  const list = document.getElementById(`parts-list-${key}`);
  if (!list) return null;
  return list.querySelector(`.part-item-wrapper[data-part-index="${partIndex}"]`);
}

function setSeamFfMiniBarClass(ps, fmt, songIdx, partIndex, on) {
  const key = `${fmt}_${songIdx}`;
  const miniStack = document.getElementById(`part-mini-stack-${key}-${partIndex}`);
  if (miniStack) miniStack.classList.toggle('seam-ff-phase', !!on);
}

function computeSeamEdgeSec(dur) {
  const raw = (STATE.seamPreviewMs ?? 2000) / 1000;
  if (!dur || dur <= 0 || !Number.isFinite(dur)) return 0;
  return Math.min(raw, dur / 2);
}

function scheduleSeamHead(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec) {
  const audRate = Math.max(1e-6, Math.abs(getDirectPartPlaybackRate()));
  const startAt = AC.currentTime + SEAM_SCHEDULE_AHEAD;
  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = audRate;
  src.connect(ps.gainNode);
  ps._directNode = src;
  ps._directSeamPhase = 'head';
  setSeamFfMiniBarClass(ps, fmt, songIdx, partIndex, false);
  scheduleSeamPhaseGain(ps, 1, startAt);

  const headWall = edgeSec / audRate;
  src.start(startAt, 0);
  try {
    src.stop(startAt + headWall);
  } catch (e) {}

  ps._directTickStartAC = startAt;
  ps._directTickStartPos = 0;
  ps._directTickRate = audRate;

  src.onended = () => {
    if (ps._directNode !== src || !ps._directSeamSkip) return;
    const rem = dur - 2 * edgeSec;
    if (rem <= 1e-6) {
      scheduleSeamTail(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec);
    } else {
      scheduleSeamFF(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec);
    }
  };
}

function scheduleSeamFF(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec) {
  const rem = dur - 2 * edgeSec;
  const ffRate = Math.min(64, Math.max(8, rem / SEAM_FF_TARGET_WALL_SEC));
  const startAt = AC.currentTime + SEAM_SCHEDULE_AHEAD;
  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = ffRate;
  src.connect(ps.gainNode);
  ps._directNode = src;
  ps._directSeamPhase = 'ff';
  setSeamFfMiniBarClass(ps, fmt, songIdx, partIndex, true);
  scheduleSeamPhaseGain(ps, SEAM_FF_GAIN, startAt);

  const wallFF = rem / ffRate;
  src.start(startAt, edgeSec);
  try {
    src.stop(startAt + wallFF);
  } catch (e) {}

  ps._directTickStartAC = startAt;
  ps._directTickStartPos = edgeSec;
  ps._directTickRate = ffRate;

  src.onended = () => {
    if (ps._directNode !== src || !ps._directSeamSkip) return;
    scheduleSeamTail(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec);
  };
}

function scheduleSeamTail(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec) {
  const audRate = Math.max(1e-6, Math.abs(getDirectPartPlaybackRate()));
  const startAt = AC.currentTime + SEAM_SCHEDULE_AHEAD;
  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = audRate;
  src.connect(ps.gainNode);
  ps._directNode = src;
  ps._directSeamPhase = 'tail';
  setSeamFfMiniBarClass(ps, fmt, songIdx, partIndex, false);
  scheduleSeamPhaseGain(ps, 1, startAt);

  const tailWall = edgeSec / audRate;
  const tailOffset = Math.max(0, dur - edgeSec);
  src.start(startAt, tailOffset);
  try {
    src.stop(startAt + tailWall);
  } catch (e) {}

  ps._directTickStartAC = startAt;
  ps._directTickStartPos = tailOffset;
  ps._directTickRate = audRate;

  src.onended = () => {
    if (ps._directNode !== src || !ps._directSeamSkip) return;
    triggerPartMiniPreviewFlash(fmt, songIdx, partIndex);
    scheduleSeamHead(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec);
  };
}

function beginSeamPreviewPlayback(fmt, songIdx, partIndex, listItem, ps, buf) {
  const dur = buf.duration;
  const edgeSec = computeSeamEdgeSec(dur);
  ps._directSeamSkip = true;
  ps._directLoop = false;
  ps._directDuration = dur;
  ps._directSeekOffset = 0;
  ps._directStartAC = AC.currentTime;
  scheduleSeamHead(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec);
}

function syncDirectPartTransportButtons(ps, key, partIndex, listItem) {
  const playBtn = listItem.querySelector('.part-play-btn');
  const loopBtn = listItem.querySelector('.part-play-loop-btn');
  const seamBtn = listItem.querySelector('.part-play-seam-btn');
  if (!playBtn || !loopBtn || !seamBtn) return;
  if (ps._directPartIndex !== partIndex || (!ps._directNode && !ps._directPaused)) return;

  if (ps._directPaused) {
    playBtn.innerHTML = DIRECT_PART_PLAY_ICON;
    playBtn.title = ps._directLoop || ps._directSeamSkip ? 'Play once' : 'Resume';
    loopBtn.innerHTML = DIRECT_PART_LOOP_IDLE_ICON;
    loopBtn.title = ps._directLoop ? 'Resume loop' : 'Play looped';
    seamBtn.innerHTML = DIRECT_PART_SEAM_IDLE_ICON;
    seamBtn.title = ps._directSeamSkip ? 'Resume seam preview' : 'Seam preview';
    return;
  }
  if (ps._directSeamSkip) {
    playBtn.innerHTML = DIRECT_PART_PLAY_ICON;
    playBtn.title = 'Play once';
    loopBtn.innerHTML = DIRECT_PART_LOOP_IDLE_ICON;
    loopBtn.title = 'Play looped';
    seamBtn.innerHTML = DIRECT_PART_PAUSE_ICON;
    seamBtn.title = 'Pause';
    return;
  }
  if (ps._directLoop) {
    playBtn.innerHTML = DIRECT_PART_PLAY_ICON;
    playBtn.title = 'Play once';
    loopBtn.innerHTML = DIRECT_PART_PAUSE_ICON;
    loopBtn.title = 'Pause';
    seamBtn.innerHTML = DIRECT_PART_SEAM_IDLE_ICON;
    seamBtn.title = 'Seam preview';
  } else {
    playBtn.innerHTML = DIRECT_PART_PAUSE_ICON;
    playBtn.title = 'Pause';
    loopBtn.innerHTML = DIRECT_PART_LOOP_IDLE_ICON;
    loopBtn.title = 'Play looped';
    seamBtn.innerHTML = DIRECT_PART_SEAM_IDLE_ICON;
    seamBtn.title = 'Seam preview';
  }
}

function handleDirectPartPlayClick(fmt, songIdx, partIndex, itemWrapper) {
  const key = `${fmt}_${songIdx}`;
  const ps = STATE.players[key];
  if (ps && ps._directNode && ps._directPartIndex === partIndex) {
    if (ps._directSeamSkip) {
      void playPartDirectly(fmt, songIdx, partIndex, itemWrapper, { loop: false });
      return;
    }
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
    if (ps._directSeamSkip) {
      void playPartDirectly(fmt, songIdx, partIndex, itemWrapper, { loop: true });
      return;
    }
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

function handleDirectPartSeamClick(fmt, songIdx, partIndex, itemWrapper) {
  const key = `${fmt}_${songIdx}`;
  const ps = STATE.players[key];
  if (ps && ps._directNode && ps._directPartIndex === partIndex) {
    if (ps._directSeamSkip) {
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
    void playPartDirectly(fmt, songIdx, partIndex, itemWrapper, { seamSkip: true });
    return;
  }
  void playPartDirectly(fmt, songIdx, partIndex, itemWrapper, { seamSkip: true });
}

/** Matches `src.playbackRate` for direct part playback (signed; negative = reverse). */
function getDirectPartPlaybackRate() {
  return playbackRateFromKnob();
}

/**
 * Keeps buffer timeline bookkeeping in sync when the speed knob changes during direct part play.
 */
function applyPlaybackRateToDirectPart(ps) {
  if (!ps._directNode) return;
  if (ps._directSeamSkip) {
    const w = getPartListItemWrapper(ps.fmt, ps.songIdx, ps._directPartIndex);
    if (w) void playPartDirectly(ps.fmt, ps.songIdx, ps._directPartIndex, w, { seamSkip: true });
    return;
  }
  const oldRate = ps._directNode.playbackRate.value;
  const newRate = getDirectPartPlaybackRate();
  const elapsed = AC.currentTime - ps._directStartAC;
  const dur = ps._directDuration || 0;
  const pos = Math.min(
    Math.max(0, ps._directSeekOffset + elapsed * oldRate),
    dur > 0 ? dur : Infinity
  );
  ps._directSeekOffset = pos;
  ps._directStartAC = AC.currentTime;
  ps._directNode.playbackRate.value = newRate;
}

function stopDirectPart(ps) {
  ps._directSeamSkip = false;
  if (ps._directPartIndex != null) {
    setSeamFfMiniBarClass(ps, ps.fmt, ps.songIdx, ps._directPartIndex, false);
  }
  try {
    const t = AC.currentTime;
    ps.gainNode.gain.cancelScheduledValues(t);
    ps.gainNode.gain.setValueAtTime(1, t);
  } catch (e) {}
  if (ps._directNode) {
    try {
      ps._directNode.stop();
    } catch (e) {}
    ps._directNode.disconnect();
    ps._directNode = null;
  }
}

function pauseDirectPart(ps) {
  if (ps._directNode && !ps._directPaused) {
    ps._directPaused = true;
    ps._directPauseTime = AC.currentTime;
    ps.gainNode.gain.setValueAtTime(0, AC.currentTime);
  }
}

function resumeDirectPart(ps) {
  if (ps._directNode && ps._directPaused) {
    ps._directPaused = false;
    ps.gainNode.gain.setValueAtTime(getDirectPartUnmutedGain(ps), AC.currentTime);
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
    triggerPartMiniPreviewFlash(fmt, songIdx, partIndex);
    void playPartDirectly(fmt, songIdx, partIndex, listItem, { loop: true });
    return;
  }
  resetDirectPartUI(ps, key, partIndex, listItem);
  if (playbackRateFromKnob() > 0) {
    advanceDirectPartPlayToNext(fmt, songIdx, partIndex);
  }
}

function resetDirectPartUI(ps, key, partIndex, listItem) {
  ps._directNode = null;
  ps._directPartIndex = null;
  ps._directPaused = false;
  ps._directLoop = false;
  ps._directSeamSkip = false;
  const partItem = listItem.querySelector('.part-item');
  const playBtn = listItem.querySelector('.part-play-btn');
  const loopBtn = listItem.querySelector('.part-play-loop-btn');
  const seamBtn = listItem.querySelector('.part-play-seam-btn');
  const stopBtn = listItem.querySelector('.part-stop-btn');
  const miniStack = document.getElementById(`part-mini-stack-${key}-${partIndex}`);
  if (playBtn) {
    playBtn.innerHTML = DIRECT_PART_PLAY_ICON;
    playBtn.title = 'Play this part';
  }
  if (loopBtn) {
    loopBtn.innerHTML = DIRECT_PART_LOOP_IDLE_ICON;
    loopBtn.title = 'Play looped';
  }
  if (seamBtn) {
    seamBtn.innerHTML = DIRECT_PART_SEAM_IDLE_ICON;
    seamBtn.title = 'Seam preview';
  }
  if (stopBtn) stopBtn.style.display = 'none';
  if (miniStack) {
    miniStack.classList.remove('visible');
    miniStack.classList.remove('seam-ff-phase');
  }
  if (partItem) partItem.classList.remove('playing-part');
}

function createTickFunction(fmt, songIdx, partIndex) {
  return function tickMini() {
    const key = `${fmt}_${songIdx}`;
    const ps = STATE.players[key];
    if (!ps || !ps._directNode || ps._directPaused) return;

    const dur = ps._directDuration;
    let pos;
    if (ps._directSeamSkip) {
      const elapsed = AC.currentTime - ps._directTickStartAC;
      pos = Math.min(
        Math.max(0, ps._directTickStartPos + elapsed * ps._directTickRate),
        dur
      );
    } else {
      const elapsed = AC.currentTime - ps._directStartAC;
      const rate = ps._directNode.playbackRate.value;
      pos = Math.min(Math.max(0, ps._directSeekOffset + elapsed * rate), dur);
    }
    const pct = dur > 0 ? (pos / dur) * 100 : 0;

    const fill = document.getElementById(`mini-fill-${key}-${partIndex}`);
    const hnd = document.getElementById(`mini-handle-${key}-${partIndex}`);
    if (fill) fill.style.width = `${pct}%`;
    if (hnd) hnd.style.left = `${pct}%`;

    updatePartMiniWaveformPreview(fmt, songIdx, partIndex, ps, pos);

    let stillPlaying;
    if (ps._directSeamSkip) {
      stillPlaying = pos < dur - 1e-4;
    } else {
      const rate = ps._directNode.playbackRate.value;
      stillPlaying = rate >= 0 ? pos < dur - 1e-4 : pos > 1e-4;
    }
    if (stillPlaying) requestAnimationFrame(tickMini);
  };
}

async function playPartDirectly(fmt, songIdx, partIndex, listItem, opts = {}) {
  const wantLoop = !!opts.loop;
  const wantSeam = !!opts.seamSkip;
  if (AC.state === 'suspended') await AC.resume();
  const key = `${fmt}_${songIdx}`;
  const ps = ensurePlayerState(fmt, songIdx);

  await loadPartBuffer(fmt, songIdx, partIndex);

  const buf = ps.buffers[partIndex];
  if (!buf) return;

  if (
    ps._directPartIndex === partIndex &&
    ps._directLoop === wantLoop &&
    ps._directSeamSkip === wantSeam &&
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
  setSeamFfMiniBarClass(ps, fmt, songIdx, partIndex, false);

  ps.gainNode.gain.cancelScheduledValues(AC.currentTime);
  ps.gainNode.gain.setValueAtTime(1, AC.currentTime);

  ps._directPartIndex = partIndex;
  ps._directPaused = false;
  ps._directLoop = wantLoop && !wantSeam;
  ps._directSeamSkip = wantSeam;

  const partItem = listItem.querySelector('.part-item');
  const stopBtn = listItem.querySelector('.part-stop-btn');
  const miniBar = document.getElementById(`mini-bar-${key}-${partIndex}`);
  const miniStack = document.getElementById(`part-mini-stack-${key}-${partIndex}`);

  if (wantSeam) {
    if (!buf.duration || buf.duration < 1e-4) {
      ps._directSeamSkip = false;
      void playPartDirectly(fmt, songIdx, partIndex, listItem, { loop: false });
      return;
    }
    beginSeamPreviewPlayback(fmt, songIdx, partIndex, listItem, ps, buf);
    syncDirectPartTransportButtons(ps, key, partIndex, listItem);
    if (stopBtn) stopBtn.style.display = '';
    if (miniStack) miniStack.classList.add('visible');
    if (partItem) partItem.classList.add('playing-part');
    const tickMini = createTickFunction(fmt, songIdx, partIndex);
    requestAnimationFrame(tickMini);
    if (miniBar) {
      miniBar.onmousedown = null;
      miniBar.style.cursor = 'default';
      miniBar.title = 'Seam preview — seek disabled';
    }
    return;
  }

  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = getDirectPartPlaybackRate();
  src.connect(ps.gainNode);
  src.start();
  ps._directNode = src;

  syncDirectPartTransportButtons(ps, key, partIndex, listItem);
  if (stopBtn) stopBtn.style.display = '';
  if (miniStack) miniStack.classList.add('visible');
  if (partItem) partItem.classList.add('playing-part');

  const dur = buf.duration;
  ps._directStartAC = AC.currentTime;
  ps._directSeekOffset = 0;
  ps._directDuration = dur;

  const tickMini = createTickFunction(fmt, songIdx, partIndex);
  requestAnimationFrame(tickMini);

  if (miniBar) {
    miniBar.style.cursor = '';
    miniBar.title = '';
    miniBar.onmousedown = e => {
      if (!ps._directNode) return;
      e.preventDefault();

      const performSeek = clientX => {
        const rect = miniBar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const seekPos = ratio * dur;

        stopDirectPart(ps);

        const newSrc = AC.createBufferSource();
        newSrc.buffer = buf;
        newSrc.playbackRate.value = getDirectPartPlaybackRate();
        newSrc.connect(ps.gainNode);
        newSrc.start(0, seekPos);
        ps._directNode = newSrc;
        ps._directStartAC = AC.currentTime;
        ps._directSeekOffset = seekPos;
        ps._directPaused = false;

        requestAnimationFrame(tickMini);

        newSrc.onended = () => {
          onDirectPartSourceEnded(ps, key, newSrc, fmt, songIdx, partIndex, listItem);
        };
      };

      performSeek(e.clientX);

      const handleMouseMove = e => {
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
