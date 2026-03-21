/* =============================================================
   S.E.A.M Audio Audition — Header spectrum / peak meter (background)
   ============================================================= */

'use strict';

(function initHeaderViz() {
  const canvas = document.getElementById('header-viz');
  if (!canvas || typeof masterAnalyser === 'undefined') return;

  const ctx = canvas.getContext('2d', { alpha: true });
  const header = canvas.closest('.app-header');
  if (!header || !ctx) return;

  const freq = new Uint8Array(masterAnalyser.frequencyBinCount);
  const timeBuf = new Float32Array(masterAnalyser.fftSize);
  const numBars = 420;
  const peaks = new Float32Array(numBars);
  const peakFallFast = 0.88;
  const peakFallSlow = 0.945;
  const silenceRms = 0.0012;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = header.clientWidth;
    const h = header.clientHeight;
    if (w < 1 || h < 1) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(header);
  }

  function barColor(i, strength) {
    const t = i / Math.max(1, numBars - 1);
    const hue = 318 + t * 110;
    const sat = 45 + strength * 28;
    const light = 54 + strength * 14;
    const alpha = 0.045 + strength * 0.16;
    return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
  }

  function drawBarRound(x, y, w, h, r) {
    if (h <= 0.5) return;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
      return;
    }
    ctx.fillRect(x, y, w, h);
  }

  function tick() {
    requestAnimationFrame(tick);

    const w = header.clientWidth;
    const h = header.clientHeight;
    if (w < 2 || h < 2) return;

    masterAnalyser.getFloatTimeDomainData(timeBuf);
    let rms = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const v = timeBuf[i];
      rms += v * v;
    }
    rms = Math.sqrt(rms / timeBuf.length);

    masterAnalyser.getByteFrequencyData(freq);
    const half = (masterAnalyser.frequencyBinCount >> 1) - 1;

    const audible = rms > silenceRms;
    const decay = audible ? peakFallSlow : peakFallFast;

    for (let i = 0; i < numBars; i++) {
      const t = i / (numBars - 1);
      const bin = Math.min(half, Math.floor(Math.pow(t, 0.55) * half));
      const raw = freq[bin] / 255;
      const v = Math.pow(raw, 0.82);
      peaks[i] = Math.max(v, peaks[i] * decay);
    }

    ctx.clearRect(0, 0, w, h);

    let any = false;
    for (let i = 0; i < numBars; i++) {
      if (peaks[i] > 0.008) any = true;
    }
    if (!any && !audible) {
      for (let i = 0; i < numBars; i++) peaks[i] *= 0.82;
      return;
    }

    const gap = Math.max(0.2, w * 0.00045);
    const barW = (w - gap * (numBars + 1)) / numBars;
    const midY = h * 0.52;
    const maxSpan = h * 0.38;
    const rad = Math.min(3, barW * 0.35);

    for (let i = 0; i < numBars; i++) {
      const amp = peaks[i];
      const span = amp * maxSpan;
      const x = gap + i * (barW + gap);

      ctx.fillStyle = barColor(i, amp);
      drawBarRound(x, midY - span * 0.5, barW, span, rad);
    }
  }

  requestAnimationFrame(tick);
})();
