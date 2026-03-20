/* =============================================================
   S.E.A.M Audio Audition — Playback Engine
   ============================================================= */

// ─── PLAYER STATE ────────────────────────────────────────────
function ensurePlayerState(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  if (!STATE.players[key]) {
    const song = STATE.songs[fmt][songIdx];
    const seq = buildDefaultSequence(song);
    STATE.players[key] = {
      fmt, songIdx, key,
      sequence: seq,
      currentSeqIdx: 0,
      loopSettings: {},
      buffers: [],
      partDurations: [],
      node: null,
      gainNode: AC.createGain(),
      startTime: 0,
      pausedAt: 0,
      paused: false,
      totalPlayedTime: 0,
      loopPlayCount: 0,
      rafId: null,
      crossfadeScheduled: false,
      locked: false,
    };
    STATE.players[key].gainNode.connect(masterGain);

    if (STATE._savedSession) {
      const ss = STATE._savedSession;
      if (ss.sequences && ss.sequences[key]) {
        const restored = ss.sequences[key]
          .map(pi => {
            if (pi === -1) return song.mainHandle ? { partIndex: -1, label: 'Full Song' } : null;
            const part = song.parts[pi];
            return part ? { partIndex: pi, label: part.file } : null;
          })
          .filter(Boolean);
        if (restored.length > 0) STATE.players[key].sequence = restored;
      }
      if (ss.loopSettings && ss.loopSettings[key]) {
        STATE.players[key].loopSettings = ss.loopSettings[key];
      }
    }
  }
  return STATE.players[key];
}

function buildDefaultSequence(song) {
  if (song.parts.length === 0) {
    return [{ partIndex: -1, label: 'Full Song' }];
  }
  const placed = [];
  const partByNum = new Map(song.parts.map(p => [p.num, p]));
  let cur = song.parts[0];
  const visited = new Set();

  while (cur && !visited.has(cur.num)) {
    visited.add(cur.num);
    placed.push({ partIndex: song.parts.indexOf(cur), label: cur.file });
    const nonLoop = cur.nexts.find(n => n !== cur.num);
    cur = partByNum.get(nonLoop) || null;
  }

  return placed;
}

// ─── AUDIO LOADING ───────────────────────────────────────────
async function loadPartBuffer(fmt, songIdx, partIndex) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps) return null;

  if (ps.buffers[partIndex] !== undefined) return ps.buffers[partIndex];

  const song = STATE.songs[fmt][songIdx];
  let handle;
  if (partIndex === -1) {
    handle = song.mainHandle;
  } else {
    handle = song.parts[partIndex]?.handle;
  }
  if (!handle) return null;

  try {
    const file    = await handle.getFile();
    const arrBuf  = await file.arrayBuffer();
    const decoded = await AC.decodeAudioData(arrBuf);
    ps.buffers[partIndex] = decoded;
    ps.partDurations[partIndex] = decoded.duration;
    return decoded;
  } catch(e) {
    console.warn('Could not decode', handle, e);
    ps.buffers[partIndex] = null;
    return null;
  }
}

async function preloadSong(fmt, songIdx) {
  const ps   = ensurePlayerState(fmt, songIdx);
  const song = STATE.songs[fmt][songIdx];

  const indices = [];
  if (song.mainHandle) indices.push(-1);
  song.parts.forEach((p,i) => indices.push(i));

  await Promise.all(indices.map(i => loadPartBuffer(fmt, songIdx, i)));
}

// ─── PLAYBACK ────────────────────────────────────────────────
async function startPlaying(fmt, songIdx) {
  if (AC.state === 'suspended') await AC.resume();

  const key = `${fmt}_${songIdx}`;
  const ps  = ensurePlayerState(fmt, songIdx);

  if (ps.paused) {
    resumePlaying(fmt, songIdx);
    return;
  }

  await preloadSong(fmt, songIdx);

  ps.currentSeqIdx  = 0;
  ps.totalPlayedTime = 0;
  ps.loopPlayCount   = 0;
  ps.paused          = false;
  ps.pausedAt        = 0;
  ps.crossfadeScheduled = false;

  ps.gainNode.gain.cancelScheduledValues(AC.currentTime);
  ps.gainNode.gain.setValueAtTime(1, AC.currentTime);

  updateActionButtons(fmt, songIdx, 'playing');
  showPlayerArea(fmt, songIdx);
  scheduleSegment(fmt, songIdx, 0);
}

function scheduleSegment(fmt, songIdx, offsetSecs) {
  const key  = `${fmt}_${songIdx}`;
  const ps   = STATE.players[key];
  if (!ps) return;

  const seqItem   = ps.sequence[ps.currentSeqIdx];
  if (!seqItem) { onSongEnded(fmt, songIdx); return; }

  const buffer = ps.buffers[seqItem.partIndex];
  if (!buffer) {
    advanceSequence(fmt, songIdx);
    return;
  }

  if (ps.node) { try { ps.node.stop(); } catch(e){} ps.node.disconnect(); ps.node = null; }

  const src = AC.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = Math.max(0.01, Math.abs(STATE.speedPercent) / 100);
  src.connect(ps.gainNode);
  ps.node = src;

  const now = AC.currentTime;
  src.start(now, offsetSecs);
  ps.startTime = now - offsetSecs;
  ps.pausedAt  = 0;

  src.onended = () => {
    if (ps.node !== src) return;
    onSegmentEnded(fmt, songIdx);
  };

  cancelAnimationFrame(ps.rafId);
  ps.rafId = requestAnimationFrame(() => tickPlayer(fmt, songIdx));
}

function onSegmentEnded(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps || ps.paused) return;

  const seqItem = ps.sequence[ps.currentSeqIdx];
  if (!seqItem) { onSongEnded(fmt, songIdx); return; }

  const loopVal = ps.loopSettings[ps.currentSeqIdx] ?? 1;
  const part    = STATE.songs[fmt][songIdx].parts[seqItem.partIndex];
  const isLoopable = part && part.nexts.includes(part.num);

  if (isLoopable && loopVal !== 1) {
    if (loopVal === -1) {
      ps.loopPlayCount++;
      ps.totalPlayedTime += ps.partDurations[seqItem.partIndex] || 0;
      scheduleSegment(fmt, songIdx, 0);
      return;
    } else {
      if (ps.loopPlayCount < loopVal - 1) {
        ps.loopPlayCount++;
        ps.totalPlayedTime += ps.partDurations[seqItem.partIndex] || 0;
        scheduleSegment(fmt, songIdx, 0);
        return;
      }
    }
  }

  ps.loopPlayCount = 0;
  ps.totalPlayedTime += ps.partDurations[seqItem.partIndex] || 0;
  advanceSequence(fmt, songIdx);
}

function advanceSequence(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps) return;

  ps.currentSeqIdx++;
  if (ps.currentSeqIdx >= ps.sequence.length) {
    onSongEnded(fmt, songIdx);
    return;
  }
  scheduleSegment(fmt, songIdx, 0);
}

function onSongEnded(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps) return;

  updateActionButtons(fmt, songIdx, 'stopped');
  hidePlayerArea(fmt, songIdx);
  cancelAnimationFrame(ps.rafId);
  ps.node = null;

  const order = STATE.order[fmt];
  const curPos = order.indexOf(songIdx);
  const nextPos = (curPos + 1) % order.length;
  const nextIdx = order[nextPos];

  setTimeout(() => startPlaying(fmt, nextIdx), Math.max(0, STATE.crossfade));
}

function pausePlaying(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps || ps.paused) return;

  const now = AC.currentTime;
  const elapsed = now - ps.startTime;
  const buf = ps.buffers[ps.sequence[ps.currentSeqIdx]?.partIndex];
  ps.pausedAt = buf ? Math.min(elapsed, buf.duration) : 0;

  if (ps.node) { try { ps.node.stop(); } catch(e){} ps.node.disconnect(); ps.node = null; }
  cancelAnimationFrame(ps.rafId);
  ps.paused = true;
  updateActionButtons(fmt, songIdx, 'paused');
}

function resumePlaying(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps || !ps.paused) return;
  ps.paused = false;
  scheduleSegment(fmt, songIdx, ps.pausedAt);
  updateActionButtons(fmt, songIdx, 'playing');
}

function stopPlaying(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps) return;

  if (ps.node) { try { ps.node.stop(); } catch(e){} ps.node.disconnect(); ps.node = null; }
  cancelAnimationFrame(ps.rafId);
  ps.paused = false;
  ps.totalPlayedTime = 0;
  ps.loopPlayCount = 0;
  ps.currentSeqIdx = 0;

  updateActionButtons(fmt, songIdx, 'stopped');
  hidePlayerArea(fmt, songIdx);
}

// ─── TICK / RAF UPDATE ───────────────────────────────────────
function tickPlayer(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps || ps.paused) return;

  const now = AC.currentTime;
  const seqItem = ps.sequence[ps.currentSeqIdx];
  if (!seqItem) return;

  const durInPart = ps.partDurations[seqItem.partIndex] || 0;
  const posInPart = Math.min(now - ps.startTime, durInPart);

  let totalPos = ps.totalPlayedTime + posInPart;

  const totalOrigDur = ps.sequence.reduce((s,item) => s + (ps.partDurations[item.partIndex]||0), 0) || 1;

  const pct = Math.min(100, (totalPos / totalOrigDur) * 100);

  const fill    = document.getElementById(`seekfill-${key}`);
  const hnd     = document.getElementById(`seekhandle-${key}`);
  const timeLbl = document.getElementById(`time-label-${key}`);
  const pctLbl  = document.getElementById(`seekpct-${key}`);

  if (fill)    fill.style.width = `${pct}%`;
  if (hnd)     hnd.style.left  = `${pct}%`;
  if (timeLbl) {
    timeLbl.textContent = fmtTime(ps.totalPlayedTime + posInPart);
    timeLbl.style.left  = `${pct}%`;
  }
  if (pctLbl)  pctLbl.textContent = `${pct.toFixed(1)}%`;

  const allBricks = document.querySelectorAll(`.part-brick[data-key="${key}"]`);
  allBricks.forEach((b,i) => b.classList.toggle('active-brick', parseInt(b.dataset.seqidx) === ps.currentSeqIdx));

  const loopBtn = document.getElementById(`loop-btn-${key}-${ps.currentSeqIdx}`);
  if (loopBtn) {
    const lv = ps.loopSettings[ps.currentSeqIdx] ?? 1;
    loopBtn.textContent = lv === 1 ? 'Continue' : (lv === -1 ? 'Forever ∞' : `Loop ${ps.loopPlayCount+1}/${lv}`);
    loopBtn.classList.toggle('active', ps.loopPlayCount > 0);
  }

  if (!ps.crossfadeScheduled && STATE.crossfade > 0) {
    const remaining = totalOrigDur - (ps.totalPlayedTime + posInPart);
    if (remaining <= STATE.crossfade / 1000) {
      ps.crossfadeScheduled = true;
      triggerCrossfade(fmt, songIdx);
    }
  }

  ps.rafId = requestAnimationFrame(() => tickPlayer(fmt, songIdx));
}

function triggerCrossfade(fmt, songIdx) {
  const order   = STATE.order[fmt];
  const curPos  = order.indexOf(songIdx);
  const nextIdx = order[(curPos + 1) % order.length];
  if (nextIdx === songIdx) return;

  const fadeMs = STATE.crossfade;
  const nextPs = ensurePlayerState(fmt, nextIdx);
  nextPs.gainNode.gain.setValueAtTime(0, AC.currentTime);

  preloadSong(fmt, nextIdx).then(() => {
    nextPs.gainNode.gain.setValueAtTime(0.001, AC.currentTime);
    startPlaying(fmt, nextIdx);

    nextPs.gainNode.gain.exponentialRampToValueAtTime(1, AC.currentTime + fadeMs / 1000);

    const curPs = STATE.players[`${fmt}_${songIdx}`];
    if (curPs && curPs.gainNode) {
      curPs.gainNode.gain.setValueAtTime(1, AC.currentTime);
      curPs.gainNode.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + fadeMs / 1000);
    }
  });
}

// ─── SEEK FUNCTIONS ──────────────────────────────────────────
function seekToTime(fmt, songIdx, targetSecs, totalDur) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps) return;

  let acc = 0;
  let found = -1;
  let offsetInPart = 0;
  for (let i = 0; i < ps.sequence.length; i++) {
    const dur = ps.partDurations[ps.sequence[i].partIndex] || 0;
    if (targetSecs < acc + dur || i === ps.sequence.length - 1) {
      found = i;
      offsetInPart = targetSecs - acc;
      break;
    }
    acc += dur;
  }
  if (found === -1) return;

  ps.currentSeqIdx  = found;
  ps.loopPlayCount  = 0;

  let tpt = acc;
  ps.totalPlayedTime = tpt;

  if (ps.paused) {
    ps.pausedAt = offsetInPart;
  } else {
    scheduleSegment(fmt, songIdx, offsetInPart);
  }
}

function seekToPart(fmt, songIdx, seqIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps) return;

  let acc = 0;
  for (let i = 0; i < seqIdx; i++) {
    acc += ps.partDurations[ps.sequence[i]?.partIndex] || 0;
  }

  const totalDur = ps.sequence.reduce((s,item) => s + (ps.partDurations[item.partIndex]||0), 0);
  seekToTime(fmt, songIdx, acc, totalDur);
}
