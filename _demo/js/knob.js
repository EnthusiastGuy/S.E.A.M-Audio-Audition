/* =============================================================
   S.E.A.M Audio Audition — Speed Knob
   ============================================================= */

/*
  Angle map (degrees from north, clockwise positive):
    North  = 0°   →  0%
    NE     = 45°  → 100%  (default)
    SE     = 135° → 200%  (max forward)
    NW     = -45° → -100%
    SW     = -135°→ -200%
    S      = -180°→ -250% (max reverse)

  Valid range: from -180° to 135°
  Total speed range: -250% to 200% = 450 percentage points.
  Arc span: 315°.
  Snapping in 5% increments.
*/

const KNOB_ARC_START = -180;
const KNOB_ARC_END   =  135;
const KNOB_SPEED_MIN = -250;
const KNOB_SPEED_MAX =  200;

function speedToAngle(pct) {
  const t = (pct - KNOB_SPEED_MIN) / (KNOB_SPEED_MAX - KNOB_SPEED_MIN);
  return KNOB_ARC_START + t * (KNOB_ARC_END - KNOB_ARC_START);
}

function angleToSpeed(deg) {
  const t = (deg - KNOB_ARC_START) / (KNOB_ARC_END - KNOB_ARC_START);
  return Math.round((KNOB_SPEED_MIN + t * (KNOB_SPEED_MAX - KNOB_SPEED_MIN)) / 5) * 5;
}

let knobAngle = speedToAngle(100);
let knobDragging = false;
let knobLastAngle = 0;
let knobAccum = knobAngle;
let knobDidMove = false;

// Click sound
const AC_CLICK = new (window.AudioContext || window.webkitAudioContext)();
function playClick() {
  const o = AC_CLICK.createOscillator();
  const g = AC_CLICK.createGain();
  o.connect(g); g.connect(AC_CLICK.destination);
  o.frequency.value = 1200;
  g.gain.setValueAtTime(0.03, AC_CLICK.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, AC_CLICK.currentTime + 0.04);
  o.start(); o.stop(AC_CLICK.currentTime + 0.04);
}

function drawKnob(canvas, angle) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w/2, cy = h/2, r = Math.min(w,h)/2 - 6;
  ctx.clearRect(0, 0, w, h);

  // Track arc (grey)
  const arcStartRad = (KNOB_ARC_START - 90) * Math.PI / 180;
  const arcEndRad   = (KNOB_ARC_END   - 90) * Math.PI / 180;

  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, arcStartRad, arcEndRad, false);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#2d4170';
  ctx.stroke();

  // Zero point marker
  const zeroAngle = speedToAngle(0);
  const zeroRad = (zeroAngle - 90) * Math.PI / 180;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, zeroRad - 0.04, zeroRad + 0.04, false);
  ctx.strokeStyle = '#4ecdc4';
  ctx.lineWidth = 5;
  ctx.stroke();

  // 100% tick marker
  const hundredAngle = speedToAngle(100);
  const hundredRad = (hundredAngle - 90) * Math.PI / 180;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(hundredRad) * (r - 5), cy + Math.sin(hundredRad) * (r - 5));
  ctx.lineTo(cx + Math.cos(hundredRad) * (r + 1), cy + Math.sin(hundredRad) * (r + 1));
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Filled arc from zero to current angle
  const filled = angle > zeroAngle
    ? [zeroRad, (angle-90)*Math.PI/180, false]
    : [(angle-90)*Math.PI/180, zeroRad, false];
  ctx.beginPath();
  ctx.arc(cx, cy, r-2, filled[0], filled[1], false);
  const fillColor = angle >= zeroAngle ? '#4d96ff' : '#ff6b6b';
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Knob body
  const grad = ctx.createRadialGradient(cx-4, cy-4, 2, cx, cy, r-8);
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
  const theta = (angle - 90) * Math.PI / 180;
  const dx = cx + Math.cos(theta) * (r - 14);
  const dy = cy + Math.sin(theta) * (r - 14);
  ctx.beginPath();
  ctx.arc(dx, dy, 3.5, 0, Math.PI*2);
  ctx.fillStyle = fillColor;
  ctx.fill();
}

function initKnob() {
  const canvas = document.getElementById('speed-knob');
  const valEl  = document.getElementById('speed-val');

  drawKnob(canvas, knobAngle);

  function getAngleFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width/2;
    const cy = rect.top  + rect.height/2;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - cx;
    const dy = clientY - cy;
    let a = Math.atan2(dx, -dy) * 180 / Math.PI;
    return a;
  }

  canvas.addEventListener('mousedown', (e) => {
    knobDragging = true;
    knobDidMove = false;
    knobLastAngle = getAngleFromEvent(e);
    knobAccum = knobAngle;
    e.preventDefault();
  });

  canvas.addEventListener('touchstart', (e) => {
    knobDragging = true;
    knobDidMove = false;
    knobLastAngle = getAngleFromEvent(e);
    knobAccum = knobAngle;
    e.preventDefault();
  }, { passive: false });

  // Click on 100% tick to reset speed
  canvas.addEventListener('click', (e) => {
    if (knobDidMove) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hundredAngle = speedToAngle(100);
    const hundredRad = (hundredAngle - 90) * Math.PI / 180;
    const r = Math.min(canvas.width, canvas.height) / 2 - 6;
    const tickX = canvas.width / 2 + Math.cos(hundredRad) * (r - 2);
    const tickY = canvas.height / 2 + Math.sin(hundredRad) * (r - 2);
    const dist = Math.sqrt((x - tickX) ** 2 + (y - tickY) ** 2);
    if (dist < 12) setKnobSpeed(100);
  });

  document.addEventListener('mousemove', (e) => {
    if (!knobDragging) return;
    updateKnob(e);
  });
  document.addEventListener('touchmove', (e) => {
    if (!knobDragging) return;
    updateKnob(e);
  });

  document.addEventListener('mouseup', () => { knobDragging = false; });
  document.addEventListener('touchend', () => { knobDragging = false; });

  // Scroll wheel
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir  = e.deltaY < 0 ? 1 : -1;
    setKnobSpeed(STATE.speedPercent + dir * 5);
  }, { passive: false });

  function updateKnob(e) {
    knobDidMove = true;
    const newA = getAngleFromEvent(e);
    let delta = newA - knobLastAngle;
    if (delta > 180)  delta -= 360;
    if (delta < -180) delta += 360;
    knobLastAngle = newA;
    knobAccum += delta;

    knobAccum = Math.max(KNOB_ARC_START, Math.min(KNOB_ARC_END, knobAccum));
    const rawSpeed = angleToSpeed(knobAccum);
    setKnobSpeed(rawSpeed);
  }

  function setKnobSpeed(pct) {
    pct = Math.max(KNOB_SPEED_MIN, Math.min(KNOB_SPEED_MAX, Math.round(pct / 5) * 5));
    const newAngle = speedToAngle(pct);

    if (knobAngle >= 90 && newAngle < -90 && (newAngle - knobAngle) < -180) {
      return;
    }

    const prevSnapped = Math.round(STATE.speedPercent / 5) * 5;
    const newSnapped  = pct;
    if (newSnapped !== prevSnapped) playClick();

    STATE.speedPercent = pct;
    knobAngle = newAngle;
    knobAccum = newAngle;
    drawKnob(canvas, knobAngle);
    valEl.textContent = pct >= 0 ? `${pct}%` : `−${Math.abs(pct)}%`;

    const newRate = Math.max(0.001, Math.abs(pct) / 100);
    const tickNow = AC.currentTime;

    for (const ps of Object.values(STATE.players)) {
      if (ps.node && !ps.paused) {
        rebasePlaybackSegmentAnchor(ps, tickNow);
        ps.node.playbackRate.value = newRate;
      } else if (ps.node) {
        ps.node.playbackRate.value = newRate;
      }
      applyPlaybackRateToDirectPart(ps);
      // When speed changes, cancel and re-schedule the pre-scheduled next
      // segment since its timing is now invalid
      if (ps._nextNode && !ps.paused) {
        cancelPreScheduled(ps);
        const buf = ps.buffers[ps.sequence[ps.currentSeqIdx]?.partIndex];
        if (buf) {
          let posInBuf;
          if (ps.segmentAudioStartAC != null) {
            posInBuf = ps.segmentBufferOffset + (tickNow - ps.segmentAudioStartAC) * newRate;
            posInBuf = Math.min(Math.max(0, posInBuf), buf.duration);
          } else {
            posInBuf = Math.min(Math.max(0, tickNow - ps.startTime), buf.duration);
          }
          const remaining = buf.duration - posInBuf;
          if (remaining > 0) {
            const newEndAC = tickNow + remaining / newRate;
            ps._segmentEndAC = newEndAC;
            preScheduleNext(ps.fmt, ps.songIdx, newEndAC);
          }
        }
      }
    }

    saveSession();
  }
}
