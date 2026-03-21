/* =============================================================
   S.E.A.M — Setup screen: layered waveform ambience + idle dim
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
  }

  let running = false;
  let rafId = 0;
  const t0 = performance.now();

  /** Smoothed organic drift per layer */
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

  /**
   * Oscilloscope-style Y at normalized x in [0, 1], time t (seconds).
   * Mix of incommensurate tones + harmonics for a believable “scope” look.
   */
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

  function strokeLayer(opts) {
    const {
      w,
      h,
      t,
      seed,
      yCenter,
      amp,
      lineWidth,
      strokeStyle,
      shadowBlur,
      shadowColor,
      globalAlpha,
      composite,
      mirror
    } = opts;

    const breath = 0.82 + 0.18 * Math.sin(t * 0.35 + seed);
    const driftVal = stepDrift(drift[seed % drift.length], 1 / 60);

    ctx.save();
    ctx.globalAlpha = globalAlpha;
    ctx.globalCompositeOperation = composite || 'source-over';
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = strokeStyle;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowColor = shadowColor;

    ctx.beginPath();
    const steps = Math.min(480, Math.floor(w / 2));
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const nx = i / steps;
      const env = envelopeRise(nx) * (0.85 + 0.15 * Math.sin(t * 0.9 + seed * 2));
      const wave =
        scopeY(nx, t * opts.speed + seed, seed, breath) * amp * env +
        driftVal * amp * 0.25;
      const y = yCenter + h * wave * 0.22;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (mirror) {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        const nx = i / steps;
        const env = envelopeRise(nx) * (0.85 + 0.15 * Math.sin(t * 0.9 + seed * 2));
        const wave =
          scopeY(nx, t * opts.speed + seed, seed, breath) * amp * env +
          driftVal * amp * 0.25;
        const y = h - yCenter - h * wave * 0.22;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  function frame(now) {
    if (!running) return;
    const t = (now - t0) * 0.001;
    const w = panel.clientWidth;
    const h = panel.clientHeight;

    ctx.clearRect(0, 0, w, h);
    drawVignette(w, h);

    const ribbonGrad = ctx.createLinearGradient(0, h * 0.35, 0, h * 0.95);
    ribbonGrad.addColorStop(0, 'rgba(78, 205, 196, 0)');
    ribbonGrad.addColorStop(0.45, 'rgba(78, 205, 196, 0.35)');
    ribbonGrad.addColorStop(1, 'rgba(15, 52, 96, 0.5)');
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.globalCompositeOperation = 'screen';
    const steps = Math.min(360, Math.floor(w / 2.5));
    const breath = 0.75 + 0.25 * Math.sin(t * 0.28 + 1.7);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * w;
      const nx = i / steps;
      const env = envelopeRise(nx);
      const wave =
        scopeY(nx, t * 0.85 + 0.5, 5, breath) * 1.1 * env * 0.9;
      ctx.lineTo(x, h * 0.62 + h * wave * 0.18);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = ribbonGrad;
    ctx.fill();
    ctx.restore();

    strokeLayer({
      w,
      h,
      t,
      seed: 0,
      yCenter: h * 0.48,
      amp: 1.15,
      speed: 1.0,
      lineWidth: 2.2,
      strokeStyle: 'rgba(168, 218, 220, 0.95)',
      shadowBlur: 14,
      shadowColor: 'rgba(78, 205, 196, 0.55)',
      globalAlpha: 0.45,
      composite: 'screen',
      mirror: false
    });

    strokeLayer({
      w,
      h,
      t,
      seed: 2,
      yCenter: h * 0.52,
      amp: 0.75,
      speed: 1.15,
      lineWidth: 1.4,
      strokeStyle: 'rgba(233, 69, 96, 0.9)',
      shadowBlur: 12,
      shadowColor: 'rgba(233, 69, 96, 0.45)',
      globalAlpha: 0.32,
      composite: 'screen',
      mirror: false
    });

    strokeLayer({
      w,
      h,
      t,
      seed: 3,
      yCenter: h * 0.42,
      amp: 0.55,
      speed: 0.72,
      lineWidth: 1.1,
      strokeStyle: 'rgba(204, 150, 255, 0.85)',
      shadowBlur: 10,
      shadowColor: 'rgba(180, 120, 255, 0.4)',
      globalAlpha: 0.28,
      composite: 'lighter',
      mirror: true
    });

    strokeLayer({
      w,
      h,
      t,
      seed: 5,
      yCenter: h * 0.55,
      amp: 0.4,
      speed: 1.4,
      lineWidth: 0.85,
      strokeStyle: 'rgba(245, 166, 35, 0.75)',
      shadowBlur: 8,
      shadowColor: 'rgba(245, 166, 35, 0.35)',
      globalAlpha: 0.22,
      composite: 'screen',
      mirror: false
    });

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
    resize();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
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

  ['mousemove', 'keydown', 'touchstart'].forEach(ev => {
    window.addEventListener(ev, onActivity, { passive: true });
  });

  armIdleTimer();
})();
