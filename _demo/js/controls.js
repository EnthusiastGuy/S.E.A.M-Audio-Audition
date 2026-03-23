/* =============================================================
   S.E.A.M Audio Audition — Crossfade & Help Modal Controls
   ============================================================= */

// ─── CROSSFADE CONTROL ───────────────────────────────────────
function initCrossfade() {
  const canvas = document.getElementById('crossfade-knob');
  const valEl  = document.getElementById('crossfade-val');
  if (!canvas || !valEl) return;

  const CF_MIN_MS = 0;
  const CF_MAX_MS = 20000;
  const CF_STEP_MS = 100;
  const CF_MAJOR_MARKS_MS = [0, 5000, 10000, 15000, 20000];

  // Standard polar angles: east=0, south=90, west=180/-180.
  // Crossfade arc is the TOP path, clockwise from SW (135deg) to SE (45deg).
  const CF_ARC_START = 135;
  const CF_ARC_END = 45;

  let cfAngle = msToAngle(STATE.crossfade || 0);
  let dragging = false;
  let majorTickHitZones = [];

  function clampMs(ms) {
    return Math.max(CF_MIN_MS, Math.min(CF_MAX_MS, Math.round(ms / CF_STEP_MS) * CF_STEP_MS));
  }

  function msToAngle(ms) {
    const t = (clampMs(ms) - CF_MIN_MS) / (CF_MAX_MS - CF_MIN_MS);
    return progressToTopArcAngle(t);
  }

  function angleToMs(a) {
    const t = topArcAngleToProgress(a);
    return clampMs(CF_MIN_MS + t * (CF_MAX_MS - CF_MIN_MS));
  }

  function normalizeAngle(a) {
    let n = a;
    while (n <= -180) n += 360;
    while (n > 180) n -= 360;
    return n;
  }

  function progressToTopArcAngle(t) {
    const clamped = Math.max(0, Math.min(1, t));
    const raw = CF_ARC_START + clamped * 270;
    return normalizeAngle(raw);
  }

  function topArcAngleToProgress(a) {
    const n = normalizeAngle(a);
    if (n >= CF_ARC_START) {
      return (n - CF_ARC_START) / 270;
    }
    return (n + 360 - CF_ARC_START) / 270;
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 6;
    ctx.clearRect(0, 0, w, h);

    const startRad = (CF_ARC_START * Math.PI) / 180;
    const endRad = (CF_ARC_END * Math.PI) / 180;

    // Base arc
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, startRad, endRad, true);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#2d4170';
    ctx.stroke();

    // Major fixed ticks (0/5/10/15/20 seconds) with click hit-zones.
    majorTickHitZones = [];
    for (const markMs of CF_MAJOR_MARKS_MS) {
      const markAngle = msToAngle(markMs);
      const markRad = (markAngle * Math.PI) / 180;
      const inner = r + 1;
      const outer = r + 9;
      const x1 = cx + Math.cos(markRad) * inner;
      const y1 = cy + Math.sin(markRad) * inner;
      const x2 = cx + Math.cos(markRad) * outer;
      const y2 = cy + Math.sin(markRad) * outer;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(234,240,251,0.95)';
      ctx.stroke();

      majorTickHitZones.push({
        ms: markMs,
        x: x2,
        y: y2,
        radius: 11,
      });
    }

    // Progressive nicks/rays from zero-point to current value.
    const curMs = clampMs(STATE.crossfade || 0);
    if (curMs > 0) {
      const tickCount = Math.floor(curMs / 500);
      const maxTicks = 40;
      const ticks = Math.min(maxTicks, tickCount);
      const pCur = curMs / CF_MAX_MS;
      for (let i = 0; i <= ticks; i++) {
        const t = ticks === 0 ? 0 : i / ticks;
        const ang = progressToTopArcAngle(t * pCur);
        const rad = (ang * Math.PI) / 180;
        const inner = r + 1;
        const outer = r + 6;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
        ctx.lineTo(cx + Math.cos(rad) * outer, cy + Math.sin(rad) * outer);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(245,166,35,0.95)';
        ctx.stroke();
      }
    }

    // Active arc
    if (STATE.crossfade > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r - 2, startRad, (cfAngle * Math.PI) / 180, true);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#f5a623';
      ctx.stroke();
    }

    // Knob body
    const grad = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, r - 8);
    grad.addColorStop(0, '#3a4f7a');
    grad.addColorStop(1, '#1e2a45');
    ctx.beginPath();
    ctx.arc(cx, cy, r - 8, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#2d4170';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Indicator dot
    const dotRad = (cfAngle * Math.PI) / 180;
    const dx = cx + Math.cos(dotRad) * (r - 14);
    const dy = cy + Math.sin(dotRad) * (r - 14);
    ctx.beginPath();
    ctx.arc(dx, dy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f5a623';
    ctx.fill();
  }

  function updateLabel() {
    valEl.textContent = `${(STATE.crossfade / 1000).toFixed(1)}s`;
  }

  function eventAngle(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = clientX - (rect.left + rect.width / 2);
    const y = clientY - (rect.top + rect.height / 2);
    const a = normalizeAngle(Math.atan2(y, x) * 180 / Math.PI);
    // Active only on top sweep: [135..180] U [-180..45].
    const onTopArc = (a >= CF_ARC_START) || (a <= CF_ARC_END);
    if (!onTopArc) return null;
    return a;
  }

  function setFromAngle(a) {
    if (a == null) return;
    cfAngle = normalizeAngle(a);
    STATE.crossfade = angleToMs(cfAngle);
    cfAngle = msToAngle(STATE.crossfade);
    updateLabel();
    draw();
    saveSession();
    playClickSound(STATE.crossfade);
  }

  function setCrossfadeMs(ms) {
    STATE.crossfade = clampMs(ms);
    cfAngle = msToAngle(STATE.crossfade);
    updateLabel();
    draw();
    saveSession();
    playClickSound(STATE.crossfade);
  }

  function markerMsAtPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    for (const zone of majorTickHitZones) {
      const dx = localX - zone.x;
      const dy = localY - zone.y;
      if ((dx * dx + dy * dy) <= zone.radius * zone.radius) {
        return zone.ms;
      }
    }
    return null;
  }

  let lastClickSoundTime = 0;
  function playClickSound(valueMs) {
    const now = Date.now();
    // Debounce: only play sound at most every 30ms to avoid rapid overlapping clicks
    if (now - lastClickSoundTime < 30) return;
    lastClickSoundTime = now;

    // Frequency mapping: 0ms→180Hz, 20000ms→800Hz (rise across range)
    const freq = 180 + (valueMs / CF_MAX_MS) * 620;

    try {
      const osc = AC.createOscillator();
      const gain = AC.createGain();

      osc.connect(gain);
      gain.connect(AC.destination);

      osc.type = 'sine';
      osc.frequency.value = freq;

      // Quick attack + decay envelope (~40ms total)
      const t = AC.currentTime;
      gain.gain.setValueAtTime(0.03, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);

      osc.start(t);
      osc.stop(t + 0.04);
    } catch (e) {
      // AudioContext may be in closed state or suspended; silently fail
    }
  }

  canvas.addEventListener('mousedown', (e) => {
    const snapMs = markerMsAtPoint(e.clientX, e.clientY);
    if (snapMs != null) {
      dragging = false;
      setCrossfadeMs(snapMs);
      e.preventDefault();
      return;
    }
    const a = eventAngle(e);
    dragging = a != null;
    setFromAngle(a);
    e.preventDefault();
  });

  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches && e.touches[0];
    if (t) {
      const snapMs = markerMsAtPoint(t.clientX, t.clientY);
      if (snapMs != null) {
        dragging = false;
        setCrossfadeMs(snapMs);
        e.preventDefault();
        return;
      }
    }
    const a = eventAngle(e);
    dragging = a != null;
    setFromAngle(a);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    setFromAngle(eventAngle(e));
  });

  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    setFromAngle(eventAngle(e));
  });

  document.addEventListener('mouseup', () => { dragging = false; });
  document.addEventListener('touchend', () => { dragging = false; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    STATE.crossfade = clampMs((STATE.crossfade || 0) + dir * CF_STEP_MS);
    cfAngle = msToAngle(STATE.crossfade);
    updateLabel();
    draw();
    saveSession();
    playClickSound(STATE.crossfade);
  }, { passive: false });

  STATE.crossfade = clampMs(STATE.crossfade || 0);
  cfAngle = msToAngle(STATE.crossfade);
  updateLabel();
  draw();
}

// ─── HELP MODAL ──────────────────────────────────────────────
function initHelp() {
  const helpModal = document.getElementById('help-modal');
  const btnHelp = document.getElementById('btn-help');
  const helpClose = document.getElementById('help-close');
  if (!helpModal || !btnHelp || !helpClose) return;

  btnHelp.addEventListener('click', () => {
    helpModal.classList.remove('hidden');
  });

  helpClose.addEventListener('click', () => {
    helpModal.classList.add('hidden');
  });

  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) helpModal.classList.add('hidden');
  });
}

function getDefaultEncodingSettings() {
  return {
    mp3: {
      bitrateKbps: 192,
      sampleRateMode: '44100',
      channels: 'auto',
    },
    ogg: {
      quality: 0.5,
      sampleRateMode: 'source',
      channels: 'auto',
    },
  };
}

function initEncodingSettings() {
  const modal = document.getElementById('settings-modal');
  const btnOpen = document.getElementById('btn-settings');
  const btnClose = document.getElementById('settings-close');
  const btnDone = document.getElementById('btn-settings-close');
  const btnReset = document.getElementById('btn-settings-reset');
  if (!modal || !btnOpen || !btnClose || !btnDone || !btnReset) return;

  const mp3Bitrate = document.getElementById('setting-mp3-bitrate');
  const mp3Rate = document.getElementById('setting-mp3-samplerate');
  const mp3Channels = document.getElementById('setting-mp3-channels');
  const oggQuality = document.getElementById('setting-ogg-quality');
  const oggQualityLabel = document.getElementById('setting-ogg-quality-label');
  const oggRate = document.getElementById('setting-ogg-samplerate');
  const oggChannels = document.getElementById('setting-ogg-channels');
  const waveformMaxSec = document.getElementById('setting-waveform-max-sec');

  function applyStateToControls() {
    const defaults = getDefaultEncodingSettings();
    const enc = STATE.encoding || defaults;
    mp3Bitrate.value = String(enc.mp3?.bitrateKbps ?? defaults.mp3.bitrateKbps);
    mp3Rate.value = enc.mp3?.sampleRateMode ?? defaults.mp3.sampleRateMode;
    mp3Channels.value = enc.mp3?.channels ?? defaults.mp3.channels;
    const q = Number(enc.ogg?.quality ?? defaults.ogg.quality);
    oggQuality.value = String(Math.max(0, Math.min(1, q)));
    oggQualityLabel.value = Number(oggQuality.value).toFixed(2);
    oggRate.value = enc.ogg?.sampleRateMode ?? defaults.ogg.sampleRateMode;
    oggChannels.value = enc.ogg?.channels ?? defaults.ogg.channels;
    if (waveformMaxSec) {
      const wm = Number(STATE.waveformMaxPartDurationSec);
      waveformMaxSec.value = String(Number.isFinite(wm) ? wm : 20);
    }
  }

  function saveControlsToState() {
    STATE.encoding = {
      mp3: {
        bitrateKbps: Number(mp3Bitrate.value),
        sampleRateMode: mp3Rate.value,
        channels: mp3Channels.value,
      },
      ogg: {
        quality: Math.max(0, Math.min(1, Number(oggQuality.value))),
        sampleRateMode: oggRate.value,
        channels: oggChannels.value,
      },
    };
    oggQualityLabel.value = STATE.encoding.ogg.quality.toFixed(2);
    if (waveformMaxSec) {
      let wv = parseInt(waveformMaxSec.value, 10);
      if (!Number.isFinite(wv)) wv = 20;
      const prev = STATE.waveformMaxPartDurationSec;
      const next = Math.min(86400, Math.max(0, wv));
      STATE.waveformMaxPartDurationSec = next;
      waveformMaxSec.value = String(STATE.waveformMaxPartDurationSec);
      if (
        prev !== next &&
        typeof refreshWaveformAfterMaxDurationChange === 'function'
      ) {
        refreshWaveformAfterMaxDurationChange();
      }
    }
    saveSession();
  }

  function openModal() {
    applyStateToControls();
    modal.classList.remove('hidden');
  }
  function closeModal() {
    modal.classList.add('hidden');
  }

  btnOpen.addEventListener('click', openModal);
  btnClose.addEventListener('click', closeModal);
  btnDone.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  [mp3Bitrate, mp3Rate, mp3Channels, oggRate, oggChannels].forEach((el) => {
    el.addEventListener('change', saveControlsToState);
  });
  if (waveformMaxSec) {
    waveformMaxSec.addEventListener('change', saveControlsToState);
  }
  oggQuality.addEventListener('input', () => {
    oggQualityLabel.value = Number(oggQuality.value).toFixed(2);
    saveControlsToState();
  });

  btnReset.addEventListener('click', () => {
    STATE.encoding = getDefaultEncodingSettings();
    STATE.waveformMaxPartDurationSec = 20;
    applyStateToControls();
    saveSession();
    if (typeof refreshWaveformAfterMaxDurationChange === 'function') {
      refreshWaveformAfterMaxDurationChange();
    }
  });

  applyStateToControls();
}
