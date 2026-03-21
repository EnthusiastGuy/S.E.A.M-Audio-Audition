/* =============================================================
   S.E.A.M — Setup screen: waveform ambience, bass hits, particles
   ============================================================= */

(function initSetupViz() {
  const panel = document.getElementById('setup-panel');
  const canvas = document.getElementById('setup-viz');
  const card = panel && panel.querySelector('.setup-card');
  if (!panel || !canvas || !card) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  const IDLE_MS = 5000;

  let idleTimer = null;

  function isPanelVisible() {
    return panel.style.display !== 'none' && panel.offsetParent !== null;
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function armIdleTimer() {
    clearIdleTimer();
    idleTimer = window.setTimeout(() => {
      card.classList.add('setup-idle-dimmed');
    }, IDLE_MS);
  }

  function onActivity() {
    if (!isPanelVisible()) return;
    card.classList.remove('setup-idle-dimmed');
    armIdleTimer();
    resumeAudio();
  }

  let running = false;
  let rafId = 0;
  const t0 = performance.now();

  const drift = [
    { v: 0, s: 0.018 },
    { v: 0, s: 0.022 },
    { v: 0, s: 0.015 },
    { v: 0, s: 0.025 }
  ];

  function stepDrift(d, dt) {
    d.v += (Math.random() - 0.5) * d.s * dt * 60;
    d.v *= 0.985;
    return d.v;
  }

  function scopeY(x, t, seed, breath) {
    const p = seed * 17.3;
    const e = breath;
    let y = 0;
    y += 0.42 * Math.sin(x * Math.PI * 3.1 + t * 1.7 + p);
    y += 0.28 * Math.sin(x * Math.PI * 7.2 - t * 2.1 + p * 0.7);
    y += 0.18 * Math.sin(x * Math.PI * 14.5 + t * 2.8 + p * 1.3);
    y += 0.1 * Math.sin(x * Math.PI * 23.0 + t * 3.4);
    y += 0.06 * Math.sin(x * Math.PI * 41.0 + t * 4.2 + Math.sin(t * 0.5 + p));
    return y * e;
  }

  function envelopeRise(x) {
    return Math.sin(Math.PI * x) * Math.sin(Math.PI * x);
  }

  /** Stroke layers + matching particle RGB */
  const WAVE_LAYERS = [
    {
      id: 'teal',
      seed: 0,
      yCenter: 0.48,
      amp: 1.15,
      speed: 1.0,
      mirror: false,
      lineWidth: 2.2,
      strokeStyle: 'rgba(168, 218, 220, 0.95)',
      shadowBlur: 14,
      shadowColor: 'rgba(78, 205, 196, 0.55)',
      globalAlpha: 0.45,
      composite: 'screen',
      particleRgb: [120, 220, 215]
    },
    {
      id: 'coral',
      seed: 2,
      yCenter: 0.52,
      amp: 0.75,
      speed: 1.15,
      mirror: false,
      lineWidth: 1.4,
      strokeStyle: 'rgba(233, 69, 96, 0.9)',
      shadowBlur: 12,
      shadowColor: 'rgba(233, 69, 96, 0.45)',
      globalAlpha: 0.32,
      composite: 'screen',
      particleRgb: [255, 120, 150]
    },
    {
      id: 'violet',
      seed: 3,
      yCenter: 0.42,
      amp: 0.55,
      speed: 0.72,
      mirror: true,
      lineWidth: 1.1,
      strokeStyle: 'rgba(204, 150, 255, 0.85)',
      shadowBlur: 10,
      shadowColor: 'rgba(180, 120, 255, 0.4)',
      globalAlpha: 0.28,
      composite: 'lighter',
      particleRgb: [200, 160, 255]
    },
    {
      id: 'amber',
      seed: 5,
      yCenter: 0.55,
      amp: 0.4,
      speed: 1.4,
      mirror: false,
      lineWidth: 0.85,
      strokeStyle: 'rgba(245, 166, 35, 0.75)',
      shadowBlur: 8,
      shadowColor: 'rgba(245, 166, 35, 0.35)',
      globalAlpha: 0.22,
      composite: 'screen',
      particleRgb: [255, 200, 100]
    }
  ];

  const RIBBON = {
    seed: 5,
    yBase: 0.62,
    amp: 1.1,
    speed: 0.85,
    particleRgb: [90, 210, 200]
  };

  /** Bass: localized shake along x */
  let bassEnergy = 0;
  let bassPhase = 0;
  let nextBassAt = 0;
  let bassRegions = [];

  /** @type {{ x: number, y: number, vx: number, vy: number, rgb: number[], r: number, mode: 'drift'|'fall', tSpawn: number, layerId: string }[]} */
  let particles = [];

  let audioCtx = null;

  function resumeAudio() {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  }

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    return audioCtx;
  }

  function playTouchBlip() {
    const ac = ensureAudio();
    if (!ac || ac.state === 'suspended') return;

    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const filter = ac.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1650 + Math.random() * 500, t);

    filter.type = 'highpass';
    filter.frequency.value = 400;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.07, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.055);

    osc.start(t);
    osc.stop(t + 0.06);

    const noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.02), ac.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ch.length * 0.35));
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuf;
    const ng = ac.createGain();
    noise.connect(ng);
    ng.connect(ac.destination);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.025, t + 0.001);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.025);
    noise.start(t);
    noise.stop(t + 0.03);
  }

  function bassShakeOffsetPx(nx, t, h) {
    if (bassEnergy < 0.02) return 0;
    let s = 0;
    for (let r = 0; r < bassRegions.length; r++) {
      const reg = bassRegions[r];
      const dx = (nx - reg.c) / reg.w;
      const gauss = Math.exp(-dx * dx * 2.2);
      s +=
        gauss *
        Math.sin(t * 42 + reg.c * 80 + r * 17) *
        Math.sin(t * 19 + nx * 60 + bassPhase);
    }
    return s * bassEnergy * h * 0.045;
  }

  function waveYStroke(w, h, t, nx, layer, breath, driftVal) {
    const env = envelopeRise(nx) * (0.85 + 0.15 * Math.sin(t * 0.9 + layer.seed * 2));
    const wave =
      scopeY(nx, t * layer.speed + layer.seed, layer.seed, breath) * layer.amp * env +
      driftVal * layer.amp * 0.25;
    let y = layer.yCenter * h + h * wave * 0.22;
    y += bassShakeOffsetPx(nx, t, h);
    return y;
  }

  function waveYStrokeMirror(w, h, t, nx, layer, breath, driftVal) {
    const env = envelopeRise(nx) * (0.85 + 0.15 * Math.sin(t * 0.9 + layer.seed * 2));
    const wave =
      scopeY(nx, t * layer.speed + layer.seed, layer.seed, breath) * layer.amp * env +
      driftVal * layer.amp * 0.25;
    let y = h - layer.yCenter * h - h * wave * 0.22;
    y -= bassShakeOffsetPx(nx, t, h);
    return y;
  }

  function waveYRibbon(w, h, t, nx, breath) {
    const env = envelopeRise(nx);
    const wave = scopeY(nx, t * RIBBON.speed + 0.5, RIBBON.seed, breath) * RIBBON.amp * env * 0.9;
    let y = h * RIBBON.yBase + h * wave * 0.18;
    y += bassShakeOffsetPx(nx, t, h) * 0.65;
    return y;
  }

  function strokeLayer(layer, w, h, t, breath, driftVal) {
    ctx.save();
    ctx.globalAlpha = layer.globalAlpha;
    ctx.globalCompositeOperation = layer.composite || 'source-over';
    ctx.lineWidth = layer.lineWidth;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = layer.strokeStyle;
    ctx.shadowBlur = layer.shadowBlur;
    ctx.shadowColor = layer.shadowColor;

    const steps = Math.min(480, Math.floor(w / 2));
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const nx = i / steps;
      const x = nx * w;
      const y = waveYStroke(w, h, t, nx, layer, breath, driftVal);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (layer.mirror) {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const nx = i / steps;
        const x = nx * w;
        const y = waveYStrokeMirror(w, h, t, nx, layer, breath, driftVal);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawRibbonFill(w, h, t, breath) {
    const ribbonGrad = ctx.createLinearGradient(0, h * 0.35, 0, h * 0.95);
    ribbonGrad.addColorStop(0, 'rgba(78, 205, 196, 0)');
    ribbonGrad.addColorStop(0.45, 'rgba(78, 205, 196, 0.35)');
    ribbonGrad.addColorStop(1, 'rgba(15, 52, 96, 0.5)');
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.globalCompositeOperation = 'screen';
    const steps = Math.min(360, Math.floor(w / 2.5));
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= steps; i++) {
      const nx = i / steps;
      const x = nx * w;
      const y = waveYRibbon(w, h, t, nx, breath);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = ribbonGrad;
    ctx.fill();
    ctx.restore();
  }

  const NX_SAMPLES = 64;

  function nearestWaveDistance(px, py, w, h, t, layerStates) {
    const ribbonBreath = 0.75 + 0.25 * Math.sin(t * 0.28 + 1.7);

    let best = Infinity;
    for (let li = 0; li < layerStates.length; li++) {
      const { layer, breath, driftVal } = layerStates[li];
      for (let s = 0; s <= NX_SAMPLES; s++) {
        const nx = s / NX_SAMPLES;
        const wx = nx * w;
        let wy = waveYStroke(w, h, t, nx, layer, breath, driftVal);
        let d = Math.hypot(px - wx, py - wy);
        if (d < best) best = d;
        if (layer.mirror) {
          wy = waveYStrokeMirror(w, h, t, nx, layer, breath, driftVal);
          d = Math.hypot(px - wx, py - wy);
          if (d < best) best = d;
        }
      }
    }
    for (let s = 0; s <= NX_SAMPLES; s++) {
      const nx = s / NX_SAMPLES;
      const wx = nx * w;
      const wy = waveYRibbon(w, h, t, nx, ribbonBreath);
      const d = Math.hypot(px - wx, py - wy);
      if (d < best) best = d;
    }
    return best;
  }

  function spawnBassParticles(t, layerStates) {
    const w = panel.clientWidth;
    const h = panel.clientHeight;
    if (bassRegions.length === 0 || w < 8) return;
    const stateById = new Map(layerStates.map(s => [s.layer.id, s]));
    for (const reg of bassRegions) {
      const picks = [...WAVE_LAYERS];
      picks.sort(() => Math.random() - 0.5);
      const useLayers = picks.slice(0, 2 + Math.floor(Math.random() * 2));
      for (const layer of useLayers) {
        const n = 6 + Math.floor(Math.random() * 8);
        const { breath, driftVal } = stateById.get(layer.id);
        for (let k = 0; k < n; k++) {
          const nx = reg.c + (Math.random() - 0.5) * reg.w * 2.2;
          const clamped = Math.max(0.02, Math.min(0.98, nx));
          const x = clamped * w;
          let y = waveYStroke(w, h, t, clamped, layer, breath, driftVal);
          if (layer.mirror && Math.random() < 0.45) {
            y = waveYStrokeMirror(w, h, t, clamped, layer, breath, driftVal);
          }
          particles.push({
            x: x + (Math.random() - 0.5) * 6,
            y: y + (Math.random() - 0.5) * 4,
            vx: (Math.random() - 0.5) * 1.2,
            vy: -0.4 - Math.random() * 0.5,
            rgb: [...layer.particleRgb],
            r: 1.2 + Math.random() * 2.2,
            mode: 'drift',
            tSpawn: t,
            layerId: layer.id
          });
        }
      }
      const ribbonN = 4 + Math.floor(Math.random() * 6);
      const ribbonBreath = 0.75 + 0.25 * Math.sin(t * 0.28 + 1.7);
      for (let k = 0; k < ribbonN; k++) {
        const nx = reg.c + (Math.random() - 0.5) * reg.w * 2;
        const clamped = Math.max(0.02, Math.min(0.98, nx));
        const x = clamped * w;
        const y = waveYRibbon(w, h, t, clamped, ribbonBreath);
        particles.push({
          x: x + (Math.random() - 0.5) * 5,
          y: y + (Math.random() - 0.5) * 3,
          vx: (Math.random() - 0.5) * 1,
          vy: -0.35 - Math.random() * 0.45,
          rgb: [...RIBBON.particleRgb],
          r: 1 + Math.random() * 1.8,
          mode: 'drift',
          tSpawn: t,
          layerId: 'ribbon'
        });
      }
    }
    const cap = 220;
    if (particles.length > cap) particles.splice(0, particles.length - cap);
  }

  function triggerBass(t, layerStates) {
    bassEnergy = 1;
    bassPhase = Math.random() * Math.PI * 2;
    const count = 2 + Math.floor(Math.random() * 3);
    bassRegions = [];
    for (let i = 0; i < count; i++) {
      bassRegions.push({
        c: 0.12 + Math.random() * 0.76,
        w: 0.055 + Math.random() * 0.1
      });
    }
    spawnBassParticles(t, layerStates);
    nextBassAt = t + 3.5 + Math.random() * 5.5;
  }

  function updateBass(dt, t, layerStates) {
    if (nextBassAt === 0) nextBassAt = t + 2 + Math.random() * 4;
    if (t >= nextBassAt && bassEnergy < 0.05) triggerBass(t, layerStates);
    if (bassEnergy > 0.001) {
      bassEnergy *= 0.965 - dt * 0.08;
      if (bassEnergy < 0.12) bassRegions = [];
    }
    bassPhase += dt * 28;
  }

  function updateParticles(dt, t, layerStates) {
    const w = panel.clientWidth;
    const h = panel.clientHeight;
    const next = [];

    for (const p of particles) {
      const age = t - p.tSpawn;

      if (p.mode === 'drift') {
        p.vy += (-0.12 + Math.sin(t * 2.1 + p.x * 0.01) * 0.06) * dt * 60;
        p.vx += (Math.random() - 0.5) * 0.08 * dt * 60;
        p.vx *= 0.992;
        p.vy *= 0.988;
        p.x += p.vx * dt * 55;
        p.y += p.vy * dt * 55;

        if (age > 1.8 + Math.random() * 1.2 || p.y < h * 0.08) {
          p.mode = 'fall';
          p.vy = 0.15 + Math.random() * 0.2;
          p.vx += (Math.random() - 0.5) * 0.8;
        }
      } else {
        p.vy += 0.38 * dt * 60;
        p.vx *= 0.985;
        p.x += p.vx * dt * 45;
        p.y += p.vy * dt * 45;
      }

      if (p.x < -20 || p.x > w + 20 || p.y > h + 40) continue;

      const hitR = 10 + p.r * 1.2;
      const d = nearestWaveDistance(p.x, p.y, w, h, t, layerStates);
      if (d < hitR) {
        playTouchBlip();
        continue;
      }

      next.push(p);
    }
    particles = next;
  }

  function drawParticles() {
    for (const p of particles) {
      const [r, g, b] = p.rgb;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      glow.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
      glow.addColorStop(0.4, `rgba(${r},${g},${b},0.35)`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = panel.clientWidth;
    const h = panel.clientHeight;
    if (w < 1 || h < 1) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let lastNow = performance.now();

  function drawVignette(w, h) {
    const g = ctx.createRadialGradient(
      w * 0.5,
      h * 0.45,
      Math.min(w, h) * 0.15,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.75
    );
    g.addColorStop(0, 'rgba(26, 26, 46, 0.15)');
    g.addColorStop(0.55, 'rgba(22, 33, 62, 0.35)');
    g.addColorStop(1, 'rgba(15, 20, 38, 0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    const t = (now - t0) * 0.001;
    const w = panel.clientWidth;
    const h = panel.clientHeight;

    const layerStates = WAVE_LAYERS.map(layer => ({
      layer,
      breath: 0.82 + 0.18 * Math.sin(t * 0.35 + layer.seed),
      driftVal: stepDrift(drift[layer.seed % drift.length], dt)
    }));

    updateBass(dt, t, layerStates);
    updateParticles(dt, t, layerStates);

    ctx.clearRect(0, 0, w, h);
    drawVignette(w, h);

    const breathRibbon = 0.75 + 0.25 * Math.sin(t * 0.28 + 1.7);
    drawRibbonFill(w, h, t, breathRibbon);

    for (const ls of layerStates) {
      strokeLayer(ls.layer, w, h, t, ls.breath, ls.driftVal);
    }

    drawParticles();

    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.12;
    const sweep = ctx.createLinearGradient(0, 0, w, h);
    sweep.addColorStop(0, `hsla(${(t * 8) % 360}, 45%, 55%, 0.3)`);
    sweep.addColorStop(0.5, 'hsla(220, 40%, 40%, 0.15)');
    sweep.addColorStop(1, `hsla(${240 + (t * 6) % 40}, 50%, 45%, 0.25)`);
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastNow = performance.now();
    nextBassAt = 0;
    bassEnergy = 0;
    particles = [];
    resize();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
    particles = [];
    bassEnergy = 0;
    bassRegions = [];
    clearIdleTimer();
    card.classList.remove('setup-idle-dimmed');
  }

  const mo = new MutationObserver(() => {
    if (panel.style.display === 'none') stop();
    else start();
  });
  mo.observe(panel, { attributes: true, attributeFilter: ['style'] });

  window.addEventListener(
    'resize',
    () => {
      if (running) resize();
    },
    { passive: true }
  );

  if (panel.style.display !== 'none') start();

  ['mousemove', 'keydown', 'touchstart', 'pointerdown'].forEach(ev => {
    window.addEventListener(ev, onActivity, { passive: true });
  });

  armIdleTimer();
})();
