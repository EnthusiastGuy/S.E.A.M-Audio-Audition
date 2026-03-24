/* =============================================================
   S.E.A.M — Browser memory estimate panel
   Prefers User-Agent specific memory (Chromium), falls back to JS heap.
   ============================================================= */

(function initMemoryEstimatePanel() {
  const usedEl = document.getElementById('memory-estimate-used');
  const sourceEl = document.getElementById('memory-estimate-source');
  const capEl = document.getElementById('memory-estimate-cap');
  if (!usedEl || !capEl || !sourceEl) return;

  const HEAP_REFRESH_MS = 700;
  const TAB_REFRESH_MS = 4000;
  const TAB_STALE_MS = TAB_REFRESH_MS * 3;
  let tabProbeInFlight = false;
  let lastTabProbeAt = 0;
  let lastTabBytes = NaN;

  function fmtMb(bytes) {
    if (bytes == null || !Number.isFinite(bytes)) return '—';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function supportsTabMeasure() {
    return typeof performance.measureUserAgentSpecificMemory === 'function';
  }

  async function probeTabMemory() {
    if (!supportsTabMeasure()) return;
    if (tabProbeInFlight) return;
    const now = Date.now();
    if (now - lastTabProbeAt < TAB_REFRESH_MS) return;

    tabProbeInFlight = true;
    try {
      const result = await performance.measureUserAgentSpecificMemory();
      if (result && typeof result.bytes === 'number' && Number.isFinite(result.bytes)) {
        lastTabBytes = result.bytes;
      }
    } catch (_) {
      // Unavailable in some contexts (permissions, browser support, or policy).
    } finally {
      lastTabProbeAt = Date.now();
      tabProbeInFlight = false;
    }
  }

  function render() {
    if (document.hidden) return;

    const pm = performance.memory;
    const heapOk = pm && typeof pm.usedJSHeapSize === 'number' && typeof pm.jsHeapSizeLimit === 'number';
    const tabFresh = Number.isFinite(lastTabBytes) && (Date.now() - lastTabProbeAt) <= TAB_STALE_MS;

    if (tabFresh) {
      usedEl.textContent = 'Tab memory ~' + fmtMb(lastTabBytes);
      sourceEl.textContent = 'source: tab';
      if (heapOk) {
        capEl.textContent = 'JS heap ' + fmtMb(pm.usedJSHeapSize) + ' / cap ~' + fmtMb(pm.jsHeapSizeLimit);
      } else {
        capEl.textContent = 'Includes more than JS heap';
      }
      return;
    }

    if (heapOk) {
      usedEl.textContent = 'Heap used ' + fmtMb(pm.usedJSHeapSize);
      sourceEl.textContent = 'source: heap';
      capEl.textContent = 'Heap cap ~' + fmtMb(pm.jsHeapSizeLimit);
    } else {
      usedEl.textContent = 'Estimate unavailable';
      sourceEl.textContent = 'source: unavailable';
      capEl.textContent = 'Try Chromium, or see ℹ';
    }
  }

  function tick() {
    render();
    void probeTabMemory().then(render);
  }

  tick();
  setInterval(tick, HEAP_REFRESH_MS);
})();
