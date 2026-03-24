/* =============================================================
   S.E.A.M — JavaScript heap memory estimate (Chromium performance.memory)
   ============================================================= */

(function initMemoryEstimatePanel() {
  const usedEl = document.getElementById('memory-estimate-used');
  const capEl = document.getElementById('memory-estimate-cap');
  if (!usedEl || !capEl) return;

  const REFRESH_MS = 500;

  function fmtMb(bytes) {
    if (bytes == null || !Number.isFinite(bytes)) return '—';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function tick() {
    if (document.hidden) return;

    const pm = performance.memory;
    if (pm && typeof pm.usedJSHeapSize === 'number' && typeof pm.jsHeapSizeLimit === 'number') {
      usedEl.textContent = 'Heap used ' + fmtMb(pm.usedJSHeapSize);
      capEl.textContent = 'Browser heap cap ~' + fmtMb(pm.jsHeapSizeLimit);
    } else {
      usedEl.textContent = 'Estimate unavailable';
      capEl.textContent = 'Try Chromium, or see ℹ';
    }
  }

  tick();
  setInterval(tick, REFRESH_MS);
})();
