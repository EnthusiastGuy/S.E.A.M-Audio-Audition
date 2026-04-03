(() => {
  const MARKER_META = {
    A: { color: getComputedStyle(document.documentElement).getPropertyValue('--a').trim() || '#2dff9a' },
    B: { color: getComputedStyle(document.documentElement).getPropertyValue('--b').trim() || '#ffd84d' },
    C: { color: getComputedStyle(document.documentElement).getPropertyValue('--c').trim() || '#ff9f3d' },
    X: { color: getComputedStyle(document.documentElement).getPropertyValue('--x').trim() || '#a78bff' },
    Y: { color: getComputedStyle(document.documentElement).getPropertyValue('--y').trim() || '#ff7bd5' },
  };

  function chooseMajorTickSeconds(secondsPerPx, sampleStepSec) {
    const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60];
    const pxPerTickMin = 90;

    // If we are zoomed far enough that even the per-sample interval has a useful
    // on-screen spacing, prefer sample-aligned ticks.
    const sampleTickPx = sampleStepSec / secondsPerPx;
    if (sampleTickPx >= pxPerTickMin) return sampleStepSec;

    let stepSec = sampleStepSec;
    let guard = 0;
    while (stepSec < candidates[candidates.length - 1] && (stepSec / secondsPerPx) < pxPerTickMin && guard < 24) {
      stepSec *= 2;
      guard++;
    }
    // If we overshot into too-small candidates list, fall through to fixed candidates.
    if (stepSec >= sampleStepSec) return stepSec;

    for (const s of candidates) {
      const px = s / secondsPerPx;
      if (px >= pxPerTickMin) return s;
    }
    return candidates[candidates.length - 1];
  }

  function nearestValidSample(sampleIndex, audioBuffer) {
    if (!audioBuffer) return null;
    const len = audioBuffer.length;
    if (!Number.isFinite(sampleIndex)) return null;
    return Math.max(0, Math.min(len - 1, Math.round(sampleIndex)));
  }

  class SlicerTimeline {
    constructor({ containerEl, canvasEl, overlayEl, onPlaceMarkerAtSample, onMarkersChanged }) {
      this.containerEl = containerEl;
      this.canvasEl = canvasEl;
      this.overlayEl = overlayEl;
      this.onPlaceMarkerAtSample = onPlaceMarkerAtSample;
      this.onMarkersChanged = onMarkersChanged;

      this.ctx = this.canvasEl.getContext('2d');
      this.dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

      this.audioBuffer = null;
      this.sampleRate = 0;

      this.markers = { A: null, B: null, C: null, X: null, Y: null };
      this.markerMode = null; // if set, clicking sets that marker

      // Viewport
      this.centerSample = 0;
      this.samplesPerPx = 1000; // zoom; lower => more detail

      // Interaction
      this._drag = null; // { kind:'marker'|'pan', markerName?, startX, startCenterSample }

      this._raf = 0;

      this._attachEvents();
      this._resizeCanvas();
      this.render();
    }

    setAudioBuffer(audioBuffer) {
      this.audioBuffer = audioBuffer;
      this.sampleRate = audioBuffer.sampleRate;
      this._channelData = [];
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        this._channelData.push(audioBuffer.getChannelData(ch));
      }
      this.centerSample = Math.round(audioBuffer.length * 0.5);

      this._initZoom();
      this.render();
    }

    _initZoom() {
      if (!this.audioBuffer) return;
      const widthPx = this._cssWidthPx();
      // First-load zoom should fit full file from start to end.
      const fullSpanSamples = Math.max(1, this.audioBuffer.length);
      this.samplesPerPx = fullSpanSamples / Math.max(1, widthPx);
      this.samplesPerPx = Math.max(0.25, this.samplesPerPx);
    }

    _cssWidthPx() {
      const rect = this.containerEl.getBoundingClientRect();
      return Math.max(1, Math.floor(rect.width));
    }

    setMarkers(nextMarkers) {
      this.markers = { ...this.markers, ...nextMarkers };
      this.render();
    }

    setMarkerMode(markerName) {
      this.markerMode = markerName;
      this.render();
    }

    getVisibleRange() {
      if (!this.audioBuffer) return null;
      const widthPx = this._cssWidthPx();
      const halfSpanSamples = (this.samplesPerPx * widthPx) / 2;
      let startSample = Math.round(this.centerSample - halfSpanSamples);
      let endSample = Math.round(this.centerSample + halfSpanSamples);

      // Clamp to buffer bounds.
      const minStart = 0;
      const maxStart = Math.max(0, this.audioBuffer.length - (endSample - startSample) - 1);
      startSample = Math.max(minStart, Math.min(maxStart, startSample));
      endSample = startSample + Math.max(1, Math.round(this.samplesPerPx * widthPx));

      return { startSample, endSample };
    }

    _resizeCanvas() {
      const widthPx = this._cssWidthPx();
      const cssHeight = 260;
      this.canvasEl.style.height = `${cssHeight}px`;

      const w = Math.max(1, Math.floor(widthPx));
      const h = Math.floor(cssHeight);
      this.canvasEl.width = w * this.dpr;
      this.canvasEl.height = h * this.dpr;

      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    _scheduleRender() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this.render();
      });
    }

    _attachEvents() {
      window.addEventListener('resize', () => {
        this._resizeCanvas();
        this._scheduleRender();
      });

      this.canvasEl.addEventListener('pointerdown', (e) => {
        if (!this.audioBuffer) return;
        this.canvasEl.setPointerCapture(e.pointerId);

        const rect = this.canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;

        const hit = this._hitTestMarkerAtX(x);
        if (hit) {
          this._drag = {
            kind: 'marker',
            markerName: hit.markerName,
          };
          return;
        }

        // If user is placing markers, clicks set the marker; no panning.
        if (this.markerMode) {
          const sampleIndex = this._sampleIndexAtX(x);
          this.onPlaceMarkerAtSample(this.markerMode, sampleIndex);
          return;
        }

        this._drag = {
          kind: 'pan',
          startX: x,
          startCenterSample: this.centerSample,
        };
      });

      this.canvasEl.addEventListener('pointermove', (e) => {
        if (!this.audioBuffer) return;
        if (!this._drag) return;

        const rect = this.canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;

        if (this._drag.kind === 'marker') {
          const markerName = this._drag.markerName;
          const sampleIndex = nearestValidSample(this._sampleIndexAtX(x), this.audioBuffer);
          if (sampleIndex == null) return;
          const updated = this._withOrderConstraints(markerName, sampleIndex);
          this.onMarkersChanged(updated);
          return;
        }

        if (this._drag.kind === 'pan') {
          const dxPx = x - this._drag.startX;
          const deltaSamples = dxPx * this.samplesPerPx;
          // Drag right -> move view left
          this.centerSample = this._drag.startCenterSample - Math.round(deltaSamples);
          this.render();
        }
      });

      const endDrag = () => {
        if (!this._drag) return;
        this._drag = null;
      };
      this.canvasEl.addEventListener('pointerup', endDrag);
      this.canvasEl.addEventListener('pointercancel', endDrag);

      this.canvasEl.addEventListener('wheel', (e) => {
        if (!this.audioBuffer) return;
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();

        const rect = this.canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const widthPx = this._cssWidthPx();
        const xClamped = Math.max(0, Math.min(widthPx - 1, x));

        const range = this.getVisibleRange();
        if (!range) return;

        const sampleAtCursor = range.startSample + Math.round(xClamped * this.samplesPerPx);

        const factor = e.deltaY > 0 ? 1.18 : 0.86;
        const nextSamplesPerPx = this.samplesPerPx * factor;

        const minSamplesPerPx = 0.25;
        const maxSamplesPerPx = Math.max(1, this.audioBuffer.length / 10);
        const clamped = Math.max(minSamplesPerPx, Math.min(maxSamplesPerPx, nextSamplesPerPx));

        if (Math.abs(clamped - this.samplesPerPx) < 1e-9) return;

        this.samplesPerPx = clamped;

        // Keep cursor sample stable.
        const newHalfSpanSamples = (this.samplesPerPx * widthPx) / 2;
        const newStartSample = sampleAtCursor - Math.round(xClamped * this.samplesPerPx);
        this.centerSample = newStartSample + Math.round(newHalfSpanSamples);

        this.render();
      }, { passive: false });
    }

    _hitTestMarkerAtX(xPx) {
      const range = this.getVisibleRange();
      if (!range || !this.audioBuffer) return null;
      const thresholdPx = 6;

      for (const name of ['A', 'B', 'C', 'X', 'Y']) {
        const s = this.markers[name];
        if (s == null) continue;
        const x = (s - range.startSample) / this.samplesPerPx;
        if (Math.abs(x - xPx) <= thresholdPx) return { markerName: name };
      }
      return null;
    }

    _sampleIndexAtX(xPx) {
      const range = this.getVisibleRange();
      if (!range) return null;
      const sample = range.startSample + Math.round(xPx * this.samplesPerPx);
      return sample;
    }

    _withOrderConstraints(markerName, sampleIndex) {
      const { A, B, C, X, Y } = this.markers;
      const d = this.audioBuffer.length - 1;

      const next = { ...this.markers };

      if (markerName === 'A') {
        const max = B != null ? B - 1 : d;
        next.A = Math.max(0, Math.min(max, sampleIndex));
        return next;
      }
      if (markerName === 'B') {
        const min = A != null ? A + 1 : 0;
        const max = C != null ? C - 1 : d;
        next.B = Math.max(min, Math.min(max, sampleIndex));
        return next;
      }
      if (markerName === 'C') {
        const min = B != null ? B + 1 : 0;
        const max = X != null ? X - 1 : d;
        next.C = Math.max(min, Math.min(max, sampleIndex));
        return next;
      }
      if (markerName === 'X') {
        const min = C != null ? C + 1 : 0;
        const max = Y != null ? Y - 1 : d;
        next.X = Math.max(min, Math.min(max, sampleIndex));
        return next;
      }
      if (markerName === 'Y') {
        const min = X != null ? X + 1 : 0;
        next.Y = Math.max(min, Math.min(d, sampleIndex));
        return next;
      }

      return next;
    }

    render() {
      if (!this.audioBuffer) {
        this.overlayEl && (this.overlayEl.style.display = '');
        return;
      }
      if (this.overlayEl) this.overlayEl.style.display = 'none';

      this._resizeCanvas();

      const widthPx = this._cssWidthPx();
      const heightPx = 260;
      const { startSample, endSample } = this.getVisibleRange();
      const sr = this.sampleRate;

      // Background
      this.ctx.clearRect(0, 0, widthPx, heightPx);
      this.ctx.fillStyle = 'rgba(8, 12, 20, 0.25)';
      this.ctx.fillRect(0, 0, widthPx, heightPx);

      // Center line
      const midY = Math.floor(heightPx / 2);
      this.ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      this.ctx.beginPath();
      this.ctx.moveTo(0, midY);
      this.ctx.lineTo(widthPx, midY);
      this.ctx.stroke();

      // Waveform
      const numChannels = this.audioBuffer.numberOfChannels;

      const samplesPerPx = this.samplesPerPx;
      const clampedStart = Math.max(0, Math.min(this.audioBuffer.length - 1, startSample));

      // Draw as vertical lines with max abs peak per pixel.
      this.ctx.strokeStyle = 'rgba(93, 214, 255, 0.55)';
      this.ctx.lineWidth = 1;

      for (let x = 0; x < widthPx; x++) {
        const s0 = Math.floor(clampedStart + x * samplesPerPx);
        const s1 = Math.min(this.audioBuffer.length, Math.ceil(clampedStart + (x + 1) * samplesPerPx));
        if (s1 <= s0) continue;

        let maxAbs = 0;
        const span = s1 - s0;
        // When zoomed out, scanning every sample per pixel can be expensive.
        // For visualization only, approximate by stepping through samples.
        const stride = span > 2048 ? Math.ceil(span / 2048) : 1;
        for (let s = s0; s < s1; s += stride) {
          const idx = s;
          // Use cached channel data arrays for speed.
          let abs = 0;
          for (let ch = 0; ch < numChannels; ch++) {
            const cd = this._channelData[ch];
            abs = Math.max(abs, Math.abs(cd[idx]));
          }
          if (abs > maxAbs) maxAbs = abs;
        }

        const amp = Math.min(1, maxAbs);
        const yTop = midY - amp * (heightPx * 0.42);
        const yBot = midY + amp * (heightPx * 0.42);

        this.ctx.beginPath();
        this.ctx.moveTo(x + 0.5, yTop);
        this.ctx.lineTo(x + 0.5, yBot);
        this.ctx.stroke();
      }

      // Axis ticks
      const secondsPerPx = this.samplesPerPx / sr;
      const majorTickSec = chooseMajorTickSeconds(secondsPerPx, 1 / sr);
      const startSec = startSample / sr;
      const endSec = endSample / sr;

      const firstTick = Math.ceil(startSec / majorTickSec) * majorTickSec;
      this.ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      this.ctx.fillStyle = 'rgba(255,255,255,0.62)';
      this.ctx.strokeStyle = 'rgba(255,255,255,0.10)';

      for (let t = firstTick; t <= endSec + 1e-9; t += majorTickSec) {
        const x = (t * sr - startSample) / this.samplesPerPx;
        if (x < 0 || x > widthPx) continue;
        const xi = Math.round(x);
        this.ctx.beginPath();
        this.ctx.moveTo(xi + 0.5, heightPx - 34);
        this.ctx.lineTo(xi + 0.5, heightPx);
        this.ctx.stroke();

        let label = SlicerUtils.formatTime(t);
        if (majorTickSec < 0.001) {
          label = `${t.toFixed(6)}s`;
        } else if (majorTickSec < 0.01) {
          label = `${t.toFixed(5)}s`;
        } else if (majorTickSec < 0.1) {
          label = `${t.toFixed(4)}s`;
        } else {
          label = SlicerUtils.formatTime(t);
        }
        this.ctx.fillText(label, xi + 4, heightPx - 10);
      }

      // Markers
      for (const name of ['A', 'B', 'C', 'X', 'Y']) {
        const s = this.markers[name];
        if (s == null) continue;
        const x = (s - startSample) / this.samplesPerPx;
        if (x < -10 || x > widthPx + 10) continue;

        const color = MARKER_META[name]?.color || 'white';
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(x + 0.5, 0);
        this.ctx.lineTo(x + 0.5, heightPx);
        this.ctx.stroke();

        // Marker label
        const tSec = s / sr;
        const label = `${name} ${tSec.toFixed(3)}s`;
        const labelX = x + 8;
        const labelY = 18;
        this.ctx.fillStyle = 'rgba(0,0,0,0.35)';
        this.ctx.fillRect(labelX - 4, labelY - 12, Math.min(140, this.ctx.measureText(label).width + 8), 22);
        this.ctx.fillStyle = color;
        this.ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        this.ctx.fillText(label, labelX, labelY + 4);
      }
    }

    zoomBy(factor, pivotXpx) {
      if (!this.audioBuffer) return;
      const widthPx = this._cssWidthPx();
      const rect = this.canvasEl.getBoundingClientRect();
      const xClamped = pivotXpx == null ? Math.floor(widthPx / 2) : Math.max(0, Math.min(widthPx - 1, pivotXpx));

      const range = this.getVisibleRange();
      if (!range) return;

      const sampleAtCursor = range.startSample + Math.round(xClamped * this.samplesPerPx);

      const nextSamplesPerPx = this.samplesPerPx * factor;
      const minSamplesPerPx = 0.25;
      const maxSamplesPerPx = Math.max(1, this.audioBuffer.length / 10);
      const clamped = Math.max(minSamplesPerPx, Math.min(maxSamplesPerPx, nextSamplesPerPx));
      if (Math.abs(clamped - this.samplesPerPx) < 1e-9) return;

      this.samplesPerPx = clamped;

      // Keep cursor stable.
      const newHalfSpanSamples = (this.samplesPerPx * widthPx) / 2;
      const newStartSample = sampleAtCursor - Math.round(xClamped * this.samplesPerPx);
      this.centerSample = newStartSample + Math.round(newHalfSpanSamples);

      this.render();
    }
  }

  window.SlicerTimeline = { SlicerTimeline };
})();

