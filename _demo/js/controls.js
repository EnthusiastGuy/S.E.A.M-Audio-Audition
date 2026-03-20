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

  // Standard polar angles: east=0, south=90, west=180/-180.
  // Crossfade arc is bottom quarter: SW (135deg) -> SE (45deg).
  const CF_ARC_START = 135;
  const CF_ARC_END = 45;

  let cfAngle = msToAngle(STATE.crossfade || 0);
  let dragging = false;

  function clampMs(ms) {
    return Math.max(CF_MIN_MS, Math.min(CF_MAX_MS, Math.round(ms / CF_STEP_MS) * CF_STEP_MS));
  }

  function msToAngle(ms) {
    const t = (clampMs(ms) - CF_MIN_MS) / (CF_MAX_MS - CF_MIN_MS);
    return CF_ARC_START - t * (CF_ARC_START - CF_ARC_END);
  }

  function angleToMs(a) {
    const clamped = Math.max(CF_ARC_END, Math.min(CF_ARC_START, a));
    const t = (CF_ARC_START - clamped) / (CF_ARC_START - CF_ARC_END);
    return clampMs(CF_MIN_MS + t * (CF_MAX_MS - CF_MIN_MS));
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

    // Progressive nicks/rays from zero-point to current value.
    const curMs = clampMs(STATE.crossfade || 0);
    if (curMs > 0) {
      const tickCount = Math.floor(curMs / 500);
      const maxTicks = 40;
      const ticks = Math.min(maxTicks, tickCount);
      for (let i = 0; i <= ticks; i++) {
        const t = ticks === 0 ? 0 : i / ticks;
        const ang = CF_ARC_START - t * (CF_ARC_START - cfAngle);
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
    let a = Math.atan2(y, x) * 180 / Math.PI;
    if (a < -180) a += 360;
    if (a > 180) a -= 360;
    // Normalize to bottom arc range [45, 135].
    return Math.max(CF_ARC_END, Math.min(CF_ARC_START, a));
  }

  function setFromAngle(a) {
    cfAngle = Math.max(CF_ARC_END, Math.min(CF_ARC_START, a));
    STATE.crossfade = angleToMs(cfAngle);
    cfAngle = msToAngle(STATE.crossfade);
    updateLabel();
    draw();
    saveSession();
  }

  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    setFromAngle(eventAngle(e));
    e.preventDefault();
  });

  canvas.addEventListener('touchstart', (e) => {
    dragging = true;
    setFromAngle(eventAngle(e));
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
  }, { passive: false });

  STATE.crossfade = clampMs(STATE.crossfade || 0);
  cfAngle = msToAngle(STATE.crossfade);
  updateLabel();
  draw();
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
