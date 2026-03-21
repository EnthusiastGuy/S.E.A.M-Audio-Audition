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
      previewBuffer: null,
      previewSignature: '',
      previewNeedsRebuild: true,
      usingPreviewBuffer: false,
      downloadFormat: 'wav',
      partDownloadFormats: {},
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
      if (ss.downloadFormats && ss.downloadFormats[key]) {
        STATE.players[key].downloadFormat = ss.downloadFormats[key];
      }
      if (ss.downloadFormats && ss.downloadFormats[`${key}__parts`]) {
        STATE.players[key].partDownloadFormats = ss.downloadFormats[`${key}__parts`];
      }
    }
  }
  return STATE.players[key];
}

const PREVIEW_MAX_SECONDS = 60 * 60;

function markCompositionDirty(fmt, songIdx) {
  const ps = STATE.players[`${fmt}_${songIdx}`];
  if (!ps) return;
  ps.previewNeedsRebuild = true;
}

function getPreviewSignature(ps) {
  return ps.sequence.map(item => String(item.partIndex)).join('|');
}

function getSequenceTotalDuration(ps) {
  return ps.sequence.reduce((sum, item) => sum + (ps.partDurations[item.partIndex] || 0), 0);
}

function showPreviewTooLongMessage(totalSecs) {
  const durationText = fmtTime(totalSecs);
  alert(
    `Preview unavailable: this composition is ${durationText}, which is longer than the 60-minute preview limit. ` +
    `Shorten the arrangement to generate a seamless play preview.`
  );
}

async function buildPreviewBuffer(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps = STATE.players[key];
  if (!ps) return null;

  const signature = getPreviewSignature(ps);
  const totalDur = getSequenceTotalDuration(ps);
  if (totalDur > PREVIEW_MAX_SECONDS) {
    showPreviewTooLongMessage(totalDur);
    return null;
  }

  if (!ps.previewNeedsRebuild && ps.previewBuffer && ps.previewSignature === signature) {
    return ps.previewBuffer;
  }

  const usedBuffers = ps.sequence
    .map(item => ps.buffers[item.partIndex])
    .filter(Boolean);
  if (usedBuffers.length === 0) return null;

  const channels = usedBuffers.reduce((max, b) => Math.max(max, b.numberOfChannels), 1);
  const sampleRate = AC.sampleRate;
  const frameCount = Math.max(1, Math.ceil(totalDur * sampleRate));
  const offline = new OfflineAudioContext(channels, frameCount, sampleRate);

  let offset = 0;
  for (const item of ps.sequence) {
    const buf = ps.buffers[item.partIndex];
    if (!buf) continue;
    const src = offline.createBufferSource();
    src.buffer = buf;
    src.connect(offline.destination);
    src.start(offset);
    offset += buf.duration;
  }

  const rendered = await offline.startRendering();
  ps.previewBuffer = rendered;
  ps.previewSignature = signature;
  ps.previewNeedsRebuild = false;
  return rendered;
}

function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCompositionDownloadName(fmt, songIdx) {
  const song = STATE.songs[fmt][songIdx];
  const ps = STATE.players[`${fmt}_${songIdx}`];
  if (!song || !ps) return 'composition';

  const partsText = ps.sequence
    .map(item => {
      if (item.partIndex === -1) return 'Full';
      const p = song.parts[item.partIndex];
      return p ? String(p.num) : null;
    })
    .filter(Boolean)
    .join(', ');

  const raw = partsText ? `${song.name} ${partsText}` : song.name;
  return sanitizeFileName(raw) || 'composition';
}

function getPartDownloadName(fmt, songIdx, partIndex) {
  const song = STATE.songs[fmt][songIdx];
  if (!song) return 'part';
  if (partIndex === -1) return sanitizeFileName(`${song.name} Full`) || 'part';
  const part = song.parts[partIndex];
  const partNum = part ? part.num : (partIndex + 1);
  return sanitizeFileName(`${song.name} ${partNum}`) || 'part';
}

function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2;
  const dataSize = numFrames * numChannels * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? (s * 0x8000) : (s * 0x7FFF);
  }
  return out;
}

function resolveEncoderChannels(bufferChannels, mode) {
  if (mode === 'mono') return 1;
  if (mode === 'stereo') return 2;
  return Math.max(1, Math.min(2, bufferChannels || 1));
}

async function maybeResampleBuffer(audioBuffer, targetRate, channels) {
  const shouldResample = Number.isFinite(targetRate) && targetRate > 0 && audioBuffer.sampleRate !== targetRate;
  const shouldRechannel = Math.max(1, Math.min(2, audioBuffer.numberOfChannels || 1)) !== channels;
  if (!shouldResample && !shouldRechannel) return audioBuffer;

  const outRate = shouldResample ? targetRate : audioBuffer.sampleRate;
  const offline = new OfflineAudioContext(channels, Math.ceil(audioBuffer.duration * outRate), outRate);
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}

let _lameJsPromise = null;
function vendorUrl(relativePath) {
  return new URL(relativePath, document.baseURI).href;
}

async function loadLameJs() {
  if (window.lamejs && window.lamejs.Mp3Encoder) return window.lamejs;
  if (!_lameJsPromise) {
    _lameJsPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-lamejs="1"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.lamejs));
        existing.addEventListener('error', () => reject(new Error('Failed to load lamejs')));
        return;
      }

      const s = document.createElement('script');
      s.src = vendorUrl('vendor/lame.min.js');
      s.async = true;
      s.dataset.lamejs = '1';
      s.onload = () => resolve(window.lamejs);
      s.onerror = () => reject(new Error('Failed to load lamejs'));
      document.head.appendChild(s);
    });
  }
  const lame = await _lameJsPromise;
  if (!lame || !lame.Mp3Encoder) throw new Error('Mp3Encoder unavailable');
  return lame;
}

let _vorbisPromise = null;
async function loadVorbisEncoder() {
  if (window.__vorbisEncoderJs && window.__vorbisEncoderJs.encoder) {
    return window.__vorbisEncoderJs;
  }
  if (!_vorbisPromise) {
    _vorbisPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-vorbis-encoder="1"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.__vorbisEncoderJs));
        existing.addEventListener('error', () => reject(new Error('Failed to load vorbis encoder')));
        return;
      }
      const s = document.createElement('script');
      s.src = vendorUrl('vendor/vorbis-encoder-js.js');
      s.async = true;
      s.dataset.vorbisEncoder = '1';
      s.onload = () => resolve(window.__vorbisEncoderJs);
      s.onerror = () => reject(new Error('Failed to load vorbis encoder'));
      document.head.appendChild(s);
    });
  }
  const mod = await _vorbisPromise;
  if (!mod || !mod.encoder) throw new Error('Vorbis encoder unavailable');
  return mod;
}

async function audioBufferToMp3Blob(audioBuffer) {
  try {
    const lame = await loadLameJs();
    const Mp3Encoder = lame.Mp3Encoder;

    const mp3Cfg = STATE.encoding?.mp3 || {};
    const channels = resolveEncoderChannels(audioBuffer.numberOfChannels, mp3Cfg.channels);
    const targetRate = mp3Cfg.sampleRateMode === 'source'
      ? audioBuffer.sampleRate
      : Number(mp3Cfg.sampleRateMode) || 44100;
    const workBuffer = await maybeResampleBuffer(audioBuffer, targetRate, channels);

    const sampleRate = workBuffer.sampleRate;
    const kbps = [96, 128, 160, 192, 224, 256, 320].includes(Number(mp3Cfg.bitrateKbps))
      ? Number(mp3Cfg.bitrateKbps)
      : 192;
    const encoder = new Mp3Encoder(channels, sampleRate, kbps);
    const left = floatTo16BitPCM(workBuffer.getChannelData(0));
    const right = channels > 1
      ? floatTo16BitPCM(workBuffer.getChannelData(1))
      : null;

    const blockSize = 1152;
    const mp3Chunks = [];
    for (let i = 0; i < left.length; i += blockSize) {
      const l = left.subarray(i, i + blockSize);
      const out = channels > 1
        ? encoder.encodeBuffer(l, right.subarray(i, i + blockSize))
        : encoder.encodeBuffer(l);
      if (out && out.length > 0) mp3Chunks.push(new Uint8Array(out));
    }

    const flush = encoder.flush();
    if (flush && flush.length > 0) mp3Chunks.push(new Uint8Array(flush));
    if (mp3Chunks.length === 0) return null;
    return new Blob(mp3Chunks, { type: 'audio/mpeg' });
  } catch (e) {
    console.error('MP3 export failed', e);
    alert('MP3 export failed. Please try again, or use WAV/OGG if the issue persists.');
    return null;
  }
}

async function audioBufferToOggBlob(audioBuffer) {
  try {
    const mod = await loadVorbisEncoder();
    const Encoder =
      mod.encoder ||
      mod.default?.encoder ||
      mod.default;
    if (!Encoder) throw new Error('Vorbis encoder unavailable');

    const oggCfg = STATE.encoding?.ogg || {};
    const channels = resolveEncoderChannels(audioBuffer.numberOfChannels, oggCfg.channels);
    const targetRate = oggCfg.sampleRateMode === 'source'
      ? audioBuffer.sampleRate
      : Number(oggCfg.sampleRateMode) || audioBuffer.sampleRate;
    const quality = Number.isFinite(Number(oggCfg.quality))
      ? Math.max(0, Math.min(1, Number(oggCfg.quality)))
      : 0.5;
    const workBuffer = await maybeResampleBuffer(audioBuffer, targetRate, channels);
    const encoder = new Encoder(workBuffer.sampleRate, channels, quality, {});
    const channelData = [];
    for (let c = 0; c < channels; c++) {
      channelData.push(workBuffer.getChannelData(c));
    }

    const frame = 4096;
    for (let i = 0; i < workBuffer.length; i += frame) {
      const block = [];
      for (let c = 0; c < channels; c++) {
        block.push(channelData[c].slice(i, i + frame));
      }
      encoder.encode(block);
    }
    return encoder.finish('audio/ogg');
  } catch (e) {
    console.error('OGG export failed', e);
    alert('OGG export failed in this browser. Please try WAV or MP3.');
    return null;
  }
}

async function downloadCompositionPreview(fmt, songIdx, requestedFormat) {
  const ps = ensurePlayerState(fmt, songIdx);
  await preloadSong(fmt, songIdx);

  const preview = await buildPreviewBuffer(fmt, songIdx);
  if (!preview) return;

  const format = (requestedFormat || ps.downloadFormat || 'wav').toLowerCase();
  const blob =
    format === 'wav' ? audioBufferToWavBlob(preview) :
    format === 'mp3' ? await audioBufferToMp3Blob(preview) :
    format === 'ogg' ? await audioBufferToOggBlob(preview) :
    null;
  if (!blob) return;

  const fileName = `${getCompositionDownloadName(fmt, songIdx)}.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function downloadPartPreview(fmt, songIdx, partIndex, requestedFormat) {
  const ps = ensurePlayerState(fmt, songIdx);
  await loadPartBuffer(fmt, songIdx, partIndex);
  const buf = ps.buffers[partIndex];
  if (!buf) return;

  const format = (requestedFormat || ps.partDownloadFormats?.[String(partIndex)] || 'wav').toLowerCase();
  const blob =
    format === 'wav' ? audioBufferToWavBlob(buf) :
    format === 'mp3' ? await audioBufferToMp3Blob(buf) :
    format === 'ogg' ? await audioBufferToOggBlob(buf) :
    null;
  if (!blob) return;

  const fileName = `${getPartDownloadName(fmt, songIdx, partIndex)}.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function startPreviewPlayback(fmt, songIdx, offsetSecs) {
  const key = `${fmt}_${songIdx}`;
  const ps = STATE.players[key];
  if (!ps || !ps.previewBuffer) return;

  cancelPreScheduled(ps);
  if (ps.node) { try { ps.node.stop(); } catch(e) {} ps.node.disconnect(); ps.node = null; }

  const rate = Math.max(0.01, Math.abs(STATE.speedPercent) / 100);
  const src = AC.createBufferSource();
  src.buffer = ps.previewBuffer;
  src.playbackRate.value = rate;
  src.connect(ps.gainNode);
  ps.node = src;
  ps.usingPreviewBuffer = true;

  const startAt = AC.currentTime + SCHEDULE_AHEAD;
  src.start(startAt, Math.max(0, offsetSecs || 0));
  ps.startTime = startAt - Math.max(0, offsetSecs || 0);
  ps.pausedAt = 0;
  ps.totalPlayedTime = 0;
  ps.loopPlayCount = 0;

  src.onended = () => {
    if (ps.node !== src) return;
    onSongEnded(fmt, songIdx);
  };

  cancelAnimationFrame(ps.rafId);
  ps.rafId = requestAnimationFrame(() => tickPlayer(fmt, songIdx));
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
  ps.usingPreviewBuffer = false;

  ps.gainNode.gain.cancelScheduledValues(AC.currentTime);
  ps.gainNode.gain.setValueAtTime(1, AC.currentTime);

  const preview = await buildPreviewBuffer(fmt, songIdx);
  if (!preview) {
    updateActionButtons(fmt, songIdx, 'stopped');
    hidePlayerArea(fmt, songIdx);
    return;
  }

  updateActionButtons(fmt, songIdx, 'playing');
  showPlayerArea(fmt, songIdx);
  startPreviewPlayback(fmt, songIdx, 0);
}

function cancelPreScheduled(ps) {
  if (ps._nextNode) {
    try { ps._nextNode.stop(); } catch(e) {}
    ps._nextNode.disconnect();
    ps._nextNode = null;
  }
  ps._nextSeqIdx = null;
  ps._nextLoopCount = null;
  ps._nextStartAC = null;
  ps._nextEndAC = null;
}

// Small lookahead (seconds) to guarantee scheduled times are in the future.
// Must exceed the audio rendering quantum (~2.67ms at 48kHz / ~2.9ms at 44.1kHz).
const SCHEDULE_AHEAD = 0.005;

function scheduleSegment(fmt, songIdx, offsetSecs) {
  const key  = `${fmt}_${songIdx}`;
  const ps   = STATE.players[key];
  if (!ps) return;

  // Cancel any pre-scheduled next segment
  cancelPreScheduled(ps);

  const seqItem = ps.sequence[ps.currentSeqIdx];
  if (!seqItem) { onSongEnded(fmt, songIdx); return; }

  const buffer = ps.buffers[seqItem.partIndex];
  if (!buffer) {
    ps.currentSeqIdx++;
    ps.loopPlayCount = 0;
    if (ps.currentSeqIdx >= ps.sequence.length) { onSongEnded(fmt, songIdx); return; }
    scheduleSegment(fmt, songIdx, 0);
    return;
  }

  if (ps.node) { try { ps.node.stop(); } catch(e){} ps.node.disconnect(); ps.node = null; }

  const rate = Math.max(0.01, Math.abs(STATE.speedPercent) / 100);
  const src = AC.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  src.connect(ps.gainNode);
  ps.node = src;

  // Schedule slightly into the future so the audio engine processes
  // the start at the EXACT requested sample — no render-quantum jitter.
  const startAt = AC.currentTime + SCHEDULE_AHEAD;
  src.start(startAt, offsetSecs);
  ps.startTime = startAt - offsetSecs;
  ps.pausedAt  = 0;

  // End time is now exact because startAt is guaranteed to be in the future
  const segEndAC = startAt + (buffer.duration - offsetSecs) / rate;
  ps._segmentEndAC = segEndAC;

  // Pre-schedule the NEXT segment's AudioBufferSourceNode to start
  // at the exact sample where this one ends — no gap possible.
  preScheduleNext(fmt, songIdx, segEndAC);

  // onended is only a fallback for when no next was pre-scheduled (end of song)
  src.onended = () => {
    if (ps.node !== src) return;
    if (!ps._nextNode) {
      const item = ps.sequence[ps.currentSeqIdx];
      ps.totalPlayedTime += ps.partDurations[item?.partIndex] || 0;
      ps.currentSeqIdx++;
      ps.loopPlayCount = 0;
      if (ps.currentSeqIdx >= ps.sequence.length) {
        onSongEnded(fmt, songIdx);
      } else {
        scheduleSegment(fmt, songIdx, 0);
      }
    }
  };

  cancelAnimationFrame(ps.rafId);
  ps.rafId = requestAnimationFrame(() => tickPlayer(fmt, songIdx));
}

function preScheduleNext(fmt, songIdx, startAtAC) {
  const key  = `${fmt}_${songIdx}`;
  const ps   = STATE.players[key];
  if (!ps || ps.paused) return;

  const seqItem = ps.sequence[ps.currentSeqIdx];
  if (!seqItem) return;

  // Determine what comes next (loop or advance)
  const loopVal    = ps.loopSettings[ps.currentSeqIdx] ?? 1;
  const part       = STATE.songs[fmt][songIdx].parts[seqItem.partIndex];
  const isLoopable = part && part.nexts.includes(part.num);

  let nextSeqIdx   = ps.currentSeqIdx;
  let nextLoopCount = ps.loopPlayCount;

  if (isLoopable && loopVal !== 1) {
    if (loopVal === -1 || ps.loopPlayCount < loopVal - 1) {
      nextLoopCount = ps.loopPlayCount + 1;
    } else {
      nextSeqIdx = ps.currentSeqIdx + 1;
      nextLoopCount = 0;
    }
  } else {
    nextSeqIdx = ps.currentSeqIdx + 1;
    nextLoopCount = 0;
  }

  if (nextSeqIdx >= ps.sequence.length) return;

  const nextItem = ps.sequence[nextSeqIdx];
  const nextBuf  = ps.buffers[nextItem.partIndex];
  if (!nextBuf) return;

  const rate = Math.max(0.01, Math.abs(STATE.speedPercent) / 100);
  const nextSrc = AC.createBufferSource();
  nextSrc.buffer = nextBuf;
  nextSrc.playbackRate.value = rate;
  nextSrc.connect(ps.gainNode);
  nextSrc.start(startAtAC, 0); // Queued in audio hardware — sample-accurate

  ps._nextNode      = nextSrc;
  ps._nextSeqIdx    = nextSeqIdx;
  ps._nextLoopCount = nextLoopCount;
  ps._nextStartAC   = startAtAC;
  ps._nextEndAC     = startAtAC + nextBuf.duration / rate;
}

function onSongEnded(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps) return;

  updateActionButtons(fmt, songIdx, 'stopped');
  hidePlayerArea(fmt, songIdx);
  cancelPreScheduled(ps);
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
  const buf = ps.usingPreviewBuffer ? ps.previewBuffer : ps.buffers[ps.sequence[ps.currentSeqIdx]?.partIndex];
  ps.pausedAt = buf ? Math.min(elapsed, buf.duration) : 0;

  if (ps.node) { try { ps.node.stop(); } catch(e){} ps.node.disconnect(); ps.node = null; }
  cancelPreScheduled(ps);
  cancelAnimationFrame(ps.rafId);
  ps.paused = true;
  updateActionButtons(fmt, songIdx, 'paused');
}

function resumePlaying(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps || !ps.paused) return;
  ps.paused = false;
  if (ps.usingPreviewBuffer && ps.previewBuffer) {
    startPreviewPlayback(fmt, songIdx, ps.pausedAt);
  } else {
    scheduleSegment(fmt, songIdx, ps.pausedAt);
  }
  updateActionButtons(fmt, songIdx, 'playing');
}

function stopPlaying(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps) return;

  if (ps.node) { try { ps.node.stop(); } catch(e){} ps.node.disconnect(); ps.node = null; }
  cancelPreScheduled(ps);
  cancelAnimationFrame(ps.rafId);
  ps.paused = false;
  ps.pausedAt = 0;
  ps.totalPlayedTime = 0;
  ps.loopPlayCount = 0;
  ps.currentSeqIdx = 0;
  ps.usingPreviewBuffer = false;

  updateActionButtons(fmt, songIdx, 'stopped');
  hidePlayerArea(fmt, songIdx);
}

// ─── TICK / RAF UPDATE ───────────────────────────────────────
function tickPlayer(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const ps  = STATE.players[key];
  if (!ps || ps.paused) return;

  const now = AC.currentTime;

  if (ps.usingPreviewBuffer && ps.previewBuffer) {
    const totalOrigDur = getSequenceTotalDuration(ps) || ps.previewBuffer.duration || 1;
    const posInPreview = Math.min(Math.max(0, now - ps.startTime), ps.previewBuffer.duration);

    let acc = 0;
    let activeIdx = 0;
    for (let i = 0; i < ps.sequence.length; i++) {
      const dur = ps.partDurations[ps.sequence[i].partIndex] || 0;
      if (posInPreview < acc + dur || i === ps.sequence.length - 1) {
        activeIdx = i;
        break;
      }
      acc += dur;
    }
    ps.currentSeqIdx = activeIdx;

    const pct = Math.min(100, (posInPreview / totalOrigDur) * 100);
    const fill    = document.getElementById(`seekfill-${key}`);
    const hnd     = document.getElementById(`seekhandle-${key}`);
    const timeLbl = document.getElementById(`time-label-${key}`);
    const pctLbl  = document.getElementById(`seekpct-${key}`);
    if (fill)    fill.style.width = `${pct}%`;
    if (hnd)     hnd.style.left  = `${pct}%`;
    if (timeLbl) {
      timeLbl.innerHTML = fmtTimeHTML(posInPreview);
      timeLbl.style.left  = `${pct}%`;
    }
    if (pctLbl)  pctLbl.textContent = `${pct.toFixed(1)}%`;

    const allBricks = document.querySelectorAll(`.part-brick[data-key="${key}"]`);
    allBricks.forEach((b) => b.classList.toggle('active-brick', parseInt(b.dataset.seqidx) === ps.currentSeqIdx));

    if (!ps.crossfadeScheduled && STATE.crossfade > 0) {
      const remaining = totalOrigDur - posInPreview;
      if (remaining <= STATE.crossfade / 1000) {
        ps.crossfadeScheduled = true;
        triggerCrossfade(fmt, songIdx);
      }
    }

    ps.rafId = requestAnimationFrame(() => tickPlayer(fmt, songIdx));
    return;
  }

  // Detect segment transition: if we've passed the current segment's end time
  // and there's a pre-scheduled next node, swap it in immediately.
  // This keeps the seek bar perfectly in sync — no waiting for async callbacks.
  if (ps._nextNode && ps._segmentEndAC && now >= ps._segmentEndAC - 0.005) {
    const oldItem = ps.sequence[ps.currentSeqIdx];
    ps.totalPlayedTime += ps.partDurations[oldItem.partIndex] || 0;

    // Promote next → current
    const prevNode = ps.node;
    ps.node           = ps._nextNode;
    ps.currentSeqIdx  = ps._nextSeqIdx;
    ps.loopPlayCount  = ps._nextLoopCount;
    ps.startTime      = ps._nextStartAC;
    ps._segmentEndAC  = ps._nextEndAC;

    // Clear next-slot
    ps._nextNode      = null;
    ps._nextSeqIdx    = null;
    ps._nextLoopCount = null;
    ps._nextStartAC   = null;
    ps._nextEndAC     = null;

    // Wire onended for the new current node (fallback for end of song)
    const curSrc = ps.node;
    curSrc.onended = () => {
      if (ps.node !== curSrc) return;
      if (!ps._nextNode) {
        const item = ps.sequence[ps.currentSeqIdx];
        ps.totalPlayedTime += ps.partDurations[item?.partIndex] || 0;
        ps.currentSeqIdx++;
        ps.loopPlayCount = 0;
        if (ps.currentSeqIdx >= ps.sequence.length) {
          onSongEnded(fmt, songIdx);
        } else {
          scheduleSegment(fmt, songIdx, 0);
        }
      }
    };

    // Pre-schedule the segment after this new current one
    preScheduleNext(fmt, songIdx, ps._segmentEndAC);
  }

  const seqItem = ps.sequence[ps.currentSeqIdx];
  if (!seqItem) return;

  const durInPart = ps.partDurations[seqItem.partIndex] || 0;
  const posInPart = Math.min(Math.max(0, now - ps.startTime), durInPart);

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
    timeLbl.innerHTML = fmtTimeHTML(ps.totalPlayedTime + posInPart);
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

  cancelPreScheduled(ps);

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
    ps.pausedAt = (ps.usingPreviewBuffer && ps.previewBuffer) ? targetSecs : offsetInPart;
  } else {
    if (ps.usingPreviewBuffer && ps.previewBuffer) {
      startPreviewPlayback(fmt, songIdx, targetSecs);
    } else {
      scheduleSegment(fmt, songIdx, offsetInPart);
    }
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
