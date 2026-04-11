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
  if (!ps._directSeamSkip || ps._directSeamToken?.cancelled) return;
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
  try { src.stop(startAt + headWall); } catch (e) {}

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
  if (!ps._directSeamSkip || ps._directSeamToken?.cancelled) return;
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
  try { src.stop(startAt + wallFF); } catch (e) {}

  ps._directTickStartAC = startAt;
  ps._directTickStartPos = edgeSec;
  ps._directTickRate = ffRate;

  src.onended = () => {
    if (ps._directNode !== src || !ps._directSeamSkip) return;
    scheduleSeamTail(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec);
  };
}

function scheduleSeamTail(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec) {
  if (!ps._directSeamSkip || ps._directSeamToken?.cancelled) return;
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
  const tailEndAC = startAt + tailWall;
  src.start(startAt, tailOffset);
  try { src.stop(tailEndAC); } catch (e) {}

  ps._directTickStartAC = startAt;
  ps._directTickStartPos = tailOffset;
  ps._directTickRate = audRate;

  cancelDirectSeamPreScheduled(ps);
  const nextSrc = AC.createBufferSource();
  nextSrc.buffer = buf;
  nextSrc.playbackRate.value = audRate;
  nextSrc.connect(ps.gainNode);
  const nextHeadWall = edgeSec / audRate;
  nextSrc.start(tailEndAC, 0);
  try { nextSrc.stop(tailEndAC + nextHeadWall); } catch (e) {}
  ps._directSeamNextSrc = nextSrc;

  src.onended = () => {
    if (ps._directNode !== src || !ps._directSeamSkip || ps._directSeamToken?.cancelled) return;
    triggerPartMiniPreviewFlash(fmt, songIdx, partIndex);
    ps._directNode = nextSrc;
    ps._directSeamPhase = 'head';
    ps._directSeamNextSrc = null;
    setSeamFfMiniBarClass(ps, fmt, songIdx, partIndex, false);
    ps._directTickStartAC = tailEndAC;
    ps._directTickStartPos = 0;
    ps._directTickRate = audRate;

    nextSrc.onended = () => {
      if (ps._directNode !== nextSrc || !ps._directSeamSkip) return;
      const rem = dur - 2 * edgeSec;
      if (rem <= 1e-6) {
        scheduleSeamTail(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec);
      } else {
        scheduleSeamFF(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec);
      }
    };
  };
}

function cancelDirectSeamPreScheduled(ps) {
  if (ps._directSeamNextSrc) {
    try { ps._directSeamNextSrc.stop(); } catch (e) {}
    try { ps._directSeamNextSrc.disconnect(); } catch (e) {}
    ps._directSeamNextSrc = null;
  }
}

function beginSeamPreviewPlayback(fmt, songIdx, partIndex, listItem, ps, buf) {
  const dur = buf.duration;
  const edgeSec = computeSeamEdgeSec(dur);
  ps._directSeamSkip = true;
  ps._directLoop = false;
  ps._directDuration = dur;
  ps._directSeekOffset = 0;
  ps._directStartAC = AC.currentTime;
  ps._directSeamToken = { cancelled: false };
  scheduleSeamHead(fmt, songIdx, partIndex, listItem, ps, buf, dur, edgeSec);
}

function cancelDirectChainPreScheduled(ps) {
  if (ps._directChainNextNode) {
    try {
      ps._directChainNextNode.stop();
    } catch (e) {}
    try {
      ps._directChainNextNode.disconnect();
    } catch (e) {}
    ps._directChainNextNode = null;
  }
  ps._directChainNextPartIndex = null;
}

/** Next list part index in DOM order, or null if none. */
function getNextPartIndexInList(fmt, songIdx, partIndex) {
  const key = `${fmt}_${songIdx}`;
  const list = document.getElementById(`parts-list-${key}`);
  if (!list) return null;
  const wrappers = Array.from(list.querySelectorAll('.part-item-wrapper'));
  const idx = wrappers.findIndex(w => parseInt(w.dataset.partIndex, 10) === partIndex);
  if (idx < 0 || idx >= wrappers.length - 1) return null;
  return parseInt(wrappers[idx + 1].dataset.partIndex, 10);
}

/**
 * Pre-schedule the following part at segEndAC (same pattern as main timeline `preScheduleNext`).
 * Caller must ensure the next buffer is already decoded.
 */
function preScheduleDirectChainNext(ps, fmt, songIdx, segEndAC, rate) {
  cancelDirectChainPreScheduled(ps);
  if (rate <= 0) return;
  const nextPi = getNextPartIndexInList(fmt, songIdx, ps._directPartIndex);
  if (nextPi == null) return;
  const nextBuf = ps.buffers[nextPi];
  if (!nextBuf) return;

  const nextSrc = AC.createBufferSource();
  nextSrc.buffer = nextBuf;
  nextSrc.playbackRate.value = rate;
  nextSrc.connect(ps.gainNode);
  nextSrc.start(segEndAC, 0);
  ps._directChainNextNode = nextSrc;
  ps._directChainNextPartIndex = nextPi;
}

function resetPartItemWrapperChrome(key, partIndex, listItem) {
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

function applyPartItemWrapperPlayingChrome(key, partIndex, listItem) {
  const partItem = listItem.querySelector('.part-item');
  const stopBtn = listItem.querySelector('.part-stop-btn');
  const miniStack = document.getElementById(`part-mini-stack-${key}-${partIndex}`);
  if (stopBtn) stopBtn.style.display = '';
  if (miniStack) miniStack.classList.add('visible');
  if (partItem) partItem.classList.add('playing-part');
}

function tryPromoteDirectChainFromTick(fmt, songIdx, ps) {
  if (ps._directPaused || ps._directLoop || ps._directSeamSkip) return;
  if (!ps._directChainNextNode || ps._directSegEndAC == null) return;
  if (AC.currentTime < ps._directSegEndAC - 0.005) return;

  const key = `${fmt}_${songIdx}`;
  const oldPi = ps._directPartIndex;
  const oldWrapper = getPartListItemWrapper(fmt, songIdx, oldPi);
  const nextPi = ps._directChainNextPartIndex;
  const nextWrapper = nextPi != null ? getPartListItemWrapper(fmt, songIdx, nextPi) : null;

  triggerPartMiniPreviewFlash(fmt, songIdx, oldPi);
  if (oldWrapper) resetPartItemWrapperChrome(key, oldPi, oldWrapper);

  const handoffAC = ps._directSegEndAC;
  const oldNode = ps._directNode;
  const promoted = ps._directChainNextNode;
  ps._directNode = promoted;
  ps._directChainNextNode = null;
  ps._directChainNextPartIndex = null;

  try {
    oldNode.stop();
  } catch (e) {}
  try {
    oldNode.disconnect();
  } catch (e) {}

  ps._directPartIndex = nextPi;
  ps._directStartAC = handoffAC;
  ps._directSeekOffset = 0;
  const nextBuf = ps.buffers[nextPi];
  ps._directDuration = nextBuf ? nextBuf.duration : 0;

  const rate = getDirectPartPlaybackRate();
  const absR = Math.max(1e-6, Math.abs(rate));
  ps._directSegEndAC = handoffAC + ps._directDuration / absR;

  if (nextWrapper) {
    applyPartItemWrapperPlayingChrome(key, nextPi, nextWrapper);
    syncDirectPartTransportButtons(ps, key, nextPi, nextWrapper);
    bindDirectOnceMiniBarSeek(fmt, songIdx, nextPi, nextWrapper, ps, nextBuf);
  }

  const curSrc = ps._directNode;
  curSrc.onended = () => {
    onDirectPartSourceEnded(ps, key, curSrc, fmt, songIdx, nextPi, nextWrapper);
  };

  const followPi = getNextPartIndexInList(fmt, songIdx, nextPi);
  if (followPi != null && ps.buffers[followPi]) {
    preScheduleDirectChainNext(ps, fmt, songIdx, ps._directSegEndAC, rate);
  } else if (followPi != null) {
    void loadPartBuffer(fmt, songIdx, followPi).then(() => {
      if (ps._directPartIndex !== nextPi || ps._directNode !== curSrc) return;
      if (!ps.buffers[followPi]) return;
      const r = getDirectPartPlaybackRate();
      if (r <= 0) return;
      preScheduleDirectChainNext(ps, fmt, songIdx, ps._directSegEndAC, r);
    });
  }
}

function bindDirectOnceMiniBarSeek(fmt, songIdx, partIndex, listItem, ps, buf) {
  const key = `${fmt}_${songIdx}`;
  const miniBar = document.getElementById(`mini-bar-${key}-${partIndex}`);
  if (!miniBar || !buf) return;

  miniBar.style.cursor = '';
  miniBar.title = '';
  miniBar.onmousedown = e => {
    if (!ps._directNode) return;
    e.preventDefault();
    const dur = buf.duration;
    const stopBtn = listItem.querySelector('.part-stop-btn');
    const tickMini = createTickFunction(fmt, songIdx, partIndex);

    const performSeek = clientX => {
      const rect = miniBar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const seekPos = ratio * dur;
      stopDirectPart(ps);
      void scheduleDirectOnceChainPlayback(fmt, songIdx, partIndex, listItem, ps, buf, seekPos);
      syncDirectPartTransportButtons(ps, key, partIndex, listItem);
      if (stopBtn) stopBtn.style.display = '';
      const miniStack = document.getElementById(`part-mini-stack-${key}-${partIndex}`);
      if (miniStack) miniStack.classList.add('visible');
      listItem.querySelector('.part-item')?.classList.add('playing-part');
      ps._directPaused = false;
      requestAnimationFrame(tickMini);
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

/**
 * Play-once with gapless handoff to the next list part (forward rate only).
 */
async function scheduleDirectOnceChainPlayback(
  fmt,
  songIdx,
  partIndex,
  listItem,
  ps,
  buf,
  offsetSecs
) {
  cancelDirectChainPreScheduled(ps);
  cancelDirectLoopPreScheduled(ps);
  if (ps._directNode) {
    try {
      ps._directNode.stop();
    } catch (e) {}
    try {
      ps._directNode.disconnect();
    } catch (e) {}
    ps._directNode = null;
  }

  const rate = getDirectPartPlaybackRate();
  const absR = Math.max(1e-6, Math.abs(rate));
  const dur = buf.duration;
  const key = `${fmt}_${songIdx}`;

  const nextPi = getNextPartIndexInList(fmt, songIdx, partIndex);
  if (nextPi != null) await loadPartBuffer(fmt, songIdx, nextPi);

  const startAt = AC.currentTime + SEAM_SCHEDULE_AHEAD;
  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(ps.gainNode);
  ps._directNode = src;
  ps._directStartAC = startAt;
  ps._directSeekOffset = offsetSecs;
  ps._directDuration = dur;
  ps._directSegEndAC = startAt + (dur - offsetSecs) / absR;

  src.start(startAt, offsetSecs);

  if (rate > 0 && nextPi != null && ps.buffers[nextPi]) {
    preScheduleDirectChainNext(ps, fmt, songIdx, ps._directSegEndAC, rate);
  }

  src.onended = () => {
    onDirectPartSourceEnded(ps, key, src, fmt, songIdx, partIndex, listItem);
  };
}

function cancelDirectLoopPreScheduled(ps) {
  if (ps._directLoopNextNode) {
    try {
      ps._directLoopNextNode.stop();
    } catch (e) {}
    try {
      ps._directLoopNextNode.disconnect();
    } catch (e) {}
    ps._directLoopNextNode = null;
  }
  ps._directLoopSegEndAC = null;
  ps._directLoopNextEndAC = null;
}

function wireDirectLoopSourceEnded(ps, fmt, songIdx, partIndex, listItem, buf, src) {
  src.onended = () => {
    if (ps._directNode !== src) return;
    if (ps._directLoopNextNode) return;
    if (!ps._directLoop) return;
    triggerPartMiniPreviewFlash(fmt, songIdx, partIndex);
    void playPartDirectly(fmt, songIdx, partIndex, listItem, { loop: true });
  };
}

/**
 * Seamless loop: same mechanism as main timeline — next iteration is pre-scheduled at the exact segment end AC time.
 */
function scheduleDirectLoopPlayback(fmt, songIdx, partIndex, listItem, ps, buf, offsetSecs) {
  cancelDirectLoopPreScheduled(ps);
  if (ps._directNode) {
    try {
      ps._directNode.stop();
    } catch (e) {}
    try {
      ps._directNode.disconnect();
    } catch (e) {}
    ps._directNode = null;
  }

  const rate = getDirectPartPlaybackRate();
  const absR = Math.max(1e-6, Math.abs(rate));
  const dur = buf.duration;
  const key = `${fmt}_${songIdx}`;

  if (rate < 0) {
    const src = AC.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(ps.gainNode);
    src.start(0, offsetSecs);
    ps._directNode = src;
    ps._directStartAC = AC.currentTime;
    ps._directSeekOffset = offsetSecs;
    ps._directDuration = dur;
    src.onended = () => {
      onDirectPartSourceEnded(ps, key, src, fmt, songIdx, partIndex, listItem);
    };
    return;
  }

  const startAt = AC.currentTime + SEAM_SCHEDULE_AHEAD;
  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(ps.gainNode);
  ps._directNode = src;
  ps._directStartAC = startAt;
  ps._directSeekOffset = offsetSecs;
  ps._directDuration = dur;

  const segEndAC = startAt + (dur - offsetSecs) / absR;
  ps._directLoopSegEndAC = segEndAC;

  src.start(startAt, offsetSecs);

  const nextSrc = AC.createBufferSource();
  nextSrc.buffer = buf;
  nextSrc.playbackRate.value = rate;
  nextSrc.connect(ps.gainNode);
  nextSrc.start(segEndAC, 0);
  ps._directLoopNextNode = nextSrc;
  ps._directLoopNextEndAC = segEndAC + dur / absR;

  wireDirectLoopSourceEnded(ps, fmt, songIdx, partIndex, listItem, buf, src);
}

function tryPromoteDirectLoopFromTick(fmt, songIdx, partIndex, listItem, ps, buf) {
  if (!ps._directLoop || ps._directSeamSkip) return;
  if (!ps._directLoopNextNode || ps._directLoopSegEndAC == null) return;
  if (AC.currentTime < ps._directLoopSegEndAC - 0.005) return;

  const oldNode = ps._directNode;
  triggerPartMiniPreviewFlash(fmt, songIdx, partIndex);
  ps._directNode = ps._directLoopNextNode;
  ps._directStartAC = ps._directLoopSegEndAC;
  ps._directSeekOffset = 0;

  try { oldNode.stop(); } catch (e) {}
  try { oldNode.disconnect(); } catch (e) {}

  const segEnd = ps._directLoopNextEndAC;
  ps._directLoopNextNode = null;
  ps._directLoopSegEndAC = segEnd;
  ps._directLoopNextEndAC = null;

  const rate = getDirectPartPlaybackRate();
  const absR = Math.max(1e-6, Math.abs(rate));
  const nextSrc = AC.createBufferSource();
  nextSrc.buffer = buf;
  nextSrc.playbackRate.value = rate;
  nextSrc.connect(ps.gainNode);
  nextSrc.start(segEnd, 0);
  ps._directLoopNextNode = nextSrc;
  ps._directLoopNextEndAC = segEnd + buf.duration / absR;

  wireDirectLoopSourceEnded(ps, fmt, songIdx, partIndex, listItem, buf, ps._directNode);
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
  if (ps._directLoop) {
    const w = getPartListItemWrapper(ps.fmt, ps.songIdx, ps._directPartIndex);
    if (!w) return;
    const oldRate = ps._directNode.playbackRate.value;
    const newRate = getDirectPartPlaybackRate();
    const elapsed = AC.currentTime - ps._directStartAC;
    const dur = ps._directDuration || 0;
    const pos = Math.min(
      Math.max(0, ps._directSeekOffset + elapsed * oldRate),
      dur > 0 ? dur : Infinity
    );
    void playPartDirectly(ps.fmt, ps.songIdx, ps._directPartIndex, w, { loop: true, loopOffset: pos });
    return;
  }
  const oldRate = ps._directNode.playbackRate.value;
  const newRate = getDirectPartPlaybackRate();
  const tickNow = AC.currentTime;
  const elapsed = tickNow - ps._directStartAC;
  const dur = ps._directDuration || 0;
  const pos = Math.min(
    Math.max(0, ps._directSeekOffset + elapsed * oldRate),
    dur > 0 ? dur : Infinity
  );
  if (ps._directChainNextNode) cancelDirectChainPreScheduled(ps);
  ps._directSeekOffset = pos;
  ps._directStartAC = tickNow;
  ps._directNode.playbackRate.value = newRate;

  if (newRate > 0) {
    const absR = Math.max(1e-6, Math.abs(newRate));
    const remainingWall = (dur - pos) / absR;
    if (remainingWall > 0) {
      ps._directSegEndAC = tickNow + remainingWall;
      preScheduleDirectChainNext(ps, ps.fmt, ps.songIdx, ps._directSegEndAC, newRate);
    }
  }
}

function stopDirectPart(ps) {
  ps._directSeamSkip = false;
  if (ps._directSeamToken) ps._directSeamToken.cancelled = true;
  cancelDirectLoopPreScheduled(ps);
  cancelDirectChainPreScheduled(ps);
  cancelDirectSeamPreScheduled(ps);
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
  if (ps._directChainNextNode) return;
  if (ps._directLoop && ps._directLoopNextNode) return;
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
  ps._directSegEndAC = null;
  cancelDirectChainPreScheduled(ps);
  if (listItem) resetPartItemWrapperChrome(key, partIndex, listItem);
}

function createTickFunction(fmt, songIdx, partIndex) {
  return function tickMini() {
    const key = `${fmt}_${songIdx}`;
    const ps = STATE.players[key];
    if (!ps || !ps._directNode || ps._directPaused) return;

    const pi = ps._directPartIndex;
    if (pi == null) return;

    tryPromoteDirectChainFromTick(fmt, songIdx, ps);

    if (ps._directLoop && !ps._directSeamSkip) {
      const buf = ps.buffers[pi];
      const w = getPartListItemWrapper(fmt, songIdx, pi);
      if (buf && w) tryPromoteDirectLoopFromTick(fmt, songIdx, pi, w, ps, buf);
    }

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

    const fill = document.getElementById(`mini-fill-${key}-${pi}`);
    const hnd = document.getElementById(`mini-handle-${key}-${pi}`);
    if (fill) fill.style.width = `${pct}%`;
    if (hnd) hnd.style.left = `${pct}%`;

    updatePartMiniWaveformPreview(fmt, songIdx, pi, ps, pos);

    let stillPlaying;
    if (ps._directSeamSkip || ps._directLoop) {
      stillPlaying = true;
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
  const loopOffsetSec =
    opts.loopOffset != null && Number.isFinite(opts.loopOffset) ? Math.max(0, opts.loopOffset) : 0;
  if (AC.state === 'suspended') await AC.resume();
  const key = `${fmt}_${songIdx}`;
  const ps = ensurePlayerState(fmt, songIdx);

  await loadPartBuffer(fmt, songIdx, partIndex);

  const buf = ps.buffers[partIndex];
  if (!buf) return;

  const repositionLoop =
    wantLoop && opts.loopOffset !== undefined && Number.isFinite(opts.loopOffset);
  if (
    !repositionLoop &&
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

  const dur = buf.duration;

  if (wantLoop) {
    scheduleDirectLoopPlayback(fmt, songIdx, partIndex, listItem, ps, buf, loopOffsetSec);
    syncDirectPartTransportButtons(ps, key, partIndex, listItem);
    if (stopBtn) stopBtn.style.display = '';
    if (miniStack) miniStack.classList.add('visible');
    if (partItem) partItem.classList.add('playing-part');
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
          scheduleDirectLoopPlayback(fmt, songIdx, partIndex, listItem, ps, buf, seekPos);
          syncDirectPartTransportButtons(ps, key, partIndex, listItem);
          if (stopBtn) stopBtn.style.display = '';
          if (miniStack) miniStack.classList.add('visible');
          if (partItem) partItem.classList.add('playing-part');
          ps._directPaused = false;
          requestAnimationFrame(tickMini);
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
    return;
  }

  if (getDirectPartPlaybackRate() > 0) {
    await scheduleDirectOnceChainPlayback(fmt, songIdx, partIndex, listItem, ps, buf, 0);
    syncDirectPartTransportButtons(ps, key, partIndex, listItem);
    if (stopBtn) stopBtn.style.display = '';
    if (miniStack) miniStack.classList.add('visible');
    if (partItem) partItem.classList.add('playing-part');
    const tickMini = createTickFunction(fmt, songIdx, partIndex);
    requestAnimationFrame(tickMini);
    bindDirectOnceMiniBarSeek(fmt, songIdx, partIndex, listItem, ps, buf);
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

  ps._directStartAC = AC.currentTime;
  ps._directSeekOffset = 0;
  ps._directDuration = dur;
  ps._directSegEndAC = null;

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
