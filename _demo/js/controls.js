/* =============================================================
   S.E.A.M Audio Audition — Crossfade & Help Modal Controls
   ============================================================= */

// ─── CROSSFADE CONTROL ───────────────────────────────────────
function initCrossfade() {
  const slider = document.getElementById('crossfade-slider');
  const val    = document.getElementById('crossfade-val');

  slider.addEventListener('input', () => {
    STATE.crossfade = parseInt(slider.value);
    val.textContent = `${STATE.crossfade} ms`;
    saveSession();
  });
}

// ─── HELP MODAL ──────────────────────────────────────────────
function initHelp() {
  document.getElementById('btn-help').addEventListener('click', () => {
    document.getElementById('help-modal').classList.remove('hidden');
  });
  document.getElementById('help-close').addEventListener('click', () => {
    document.getElementById('help-modal').classList.add('hidden');
  });
  document.getElementById('help-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('help-modal')) {
      document.getElementById('help-modal').classList.add('hidden');
    }
  });
}
