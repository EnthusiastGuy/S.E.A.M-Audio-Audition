(() => {
  const el = {
    statusPill: document.getElementById('statusPill'),
    startScreen: document.getElementById('startScreen'),
    workspaceScreen: document.getElementById('workspaceScreen'),
    fileInput: document.getElementById('fileInput'),
    loadBtn: document.getElementById('loadBtn'),
    loadZone: document.querySelector('.upload-dropzone'),

    fileName: document.getElementById('fileName'),
    fileBitDepth: document.getElementById('fileBitDepth'),
    fileDuration: document.getElementById('fileDuration'),
    fileChannels: document.getElementById('fileChannels'),
    fileSampleRate: document.getElementById('fileSampleRate'),

    btnToolsMenu: document.getElementById('btnToolsMenu'),
    toolsDropdown: document.getElementById('toolsDropdown'),
    toolSliceLoop: document.getElementById('toolSliceLoop'),
    toolPanelSliceLoop: document.getElementById('toolPanelSliceLoop'),

    btnPlayOriginal: document.getElementById('btnPlayOriginal'),
    btnStop: document.getElementById('btnStop'),
    btnRenderAll: document.getElementById('btnRenderAll'),
    btnExportAll: document.getElementById('btnExportAll'),
    btnPlayIntro: document.getElementById('btnPlayIntro'),
    btnPlayLoop: document.getElementById('btnPlayLoop'),
    btnPlayOutro: document.getElementById('btnPlayOutro'),

    markerPlannerText: document.getElementById('markerPlannerText'),
    markersWarning: document.getElementById('markersWarning'),
    markersInputs: document.getElementById('markersInputs'),
    presetNameInput: document.getElementById('presetNameInput'),
    savePresetBtn: document.getElementById('savePresetBtn'),
    presetList: document.getElementById('presetList'),

    setMarkerA: document.getElementById('setMarkerA'),
    setMarkerB: document.getElementById('setMarkerB'),
    setMarkerC: document.getElementById('setMarkerC'),
    setMarkerX: document.getElementById('setMarkerX'),
    setMarkerY: document.getElementById('setMarkerY'),

    timelineContainer: document.getElementById('timelineContainer'),
    timelineCanvas: document.getElementById('timelineCanvas'),
    timelineOverlayHint: document.getElementById('timelineOverlayHint'),

    btnZoomIn: document.getElementById('btnZoomIn'),
    btnZoomOut: document.getElementById('btnZoomOut'),
  };

  const MARKER_NAMES = ['A', 'B', 'C', 'X', 'Y'];
  const PRESET_STORAGE_KEY = 'seam_slicer_marker_presets_v1';

  const state = {
    selectedFile: null,
    audioBuffer: null,
    wavMeta: null,
    markers: { A: null, B: null, C: null, X: null, Y: null }, // sample indices
    renderedParts: null,
    renderSignature: null,
    player: null,
    timeline: null,
    markerPresets: [],
  };

  function setStatus(text) {
    el.statusPill.textContent = text;
  }

  function setTool(toolName) {
    const isSliceLoop = toolName === 'slice-loop';
    el.toolPanelSliceLoop.classList.toggle('hidden', !isSliceLoop);
    el.toolSliceLoop.classList.toggle('active', isSliceLoop);
    el.toolsDropdown.classList.add('hidden');
  }

  function loadMarkerPresetsFromStorage() {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        p.startMs &&
        p.endMs &&
        Number.isFinite(Number(p.startMs.A)) &&
        Number.isFinite(Number(p.startMs.B)) &&
        Number.isFinite(Number(p.startMs.C)) &&
        Number.isFinite(Number(p.endMs.X)) &&
        Number.isFinite(Number(p.endMs.Y))
      );
    } catch (e) {
      console.warn('Could not load presets', e);
      return [];
    }
  }

  function persistMarkerPresets() {
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(state.markerPresets));
    } catch (e) {
      console.warn('Could not persist presets', e);
    }
  }

  function formatPresetDetail(preset) {
    const s = preset.startMs;
    const e = preset.endMs;
    const fmt = (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}ms`;
    return `A ${fmt(s.A)}  B ${fmt(s.B)}  C ${fmt(s.C)}  X ${fmt(e.X)}  Y ${fmt(e.Y)}`;
  }

  function toSampleFromMs(ms, sampleRate) {
    return Math.round((ms / 1000) * sampleRate);
  }

  function renderPresetList() {
    if (!el.presetList) return;
    el.presetList.innerHTML = '';

    if (!state.markerPresets.length) {
      const empty = document.createElement('div');
      empty.className = 'preset-detail';
      empty.textContent = 'No presets saved yet.';
      el.presetList.appendChild(empty);
      return;
    }

    state.markerPresets.forEach((preset) => {
      const item = document.createElement('div');
      item.className = 'preset-item';

      const meta = document.createElement('div');
      meta.className = 'preset-meta';

      const name = document.createElement('div');
      name.className = 'preset-name';
      name.textContent = preset.name;

      const detail = document.createElement('div');
      detail.className = 'preset-detail';
      detail.textContent = formatPresetDetail(preset);

      meta.appendChild(name);
      meta.appendChild(detail);

      const actions = document.createElement('div');
      actions.className = 'preset-actions';

      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-secondary';
      applyBtn.type = 'button';
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', () => applyMarkerPreset(preset.id));

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger';
      delBtn.type = 'button';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteMarkerPreset(preset.id));

      actions.appendChild(applyBtn);
      actions.appendChild(delBtn);

      item.appendChild(meta);
      item.appendChild(actions);
      el.presetList.appendChild(item);
    });
  }

  function getCurrentMarkersAsPresetOffsets() {
    if (!state.audioBuffer) return null;
    const { A, B, C, X, Y } = state.markers;
    if ([A, B, C, X, Y].some((v) => v == null)) return null;

    const sr = state.audioBuffer.sampleRate;
    const durationMs = Math.round(state.audioBuffer.duration * 1000);
    const toMs = (sampleIndex) => Math.round((sampleIndex / sr) * 1000);

    const Ams = toMs(A);
    const Bms = toMs(B);
    const Cms = toMs(C);
    const XmsAbs = toMs(X);
    const YmsAbs = toMs(Y);

    return {
      startMs: { A: Ams, B: Bms, C: Cms },
      endMs: {
        X: XmsAbs - durationMs,
        Y: YmsAbs - durationMs,
      },
    };
  }

  function saveCurrentMarkersAsPreset() {
    if (!state.audioBuffer) {
      setStatus('Load audio before saving a preset.');
      return;
    }
    const offsets = getCurrentMarkersAsPresetOffsets();
    if (!offsets) {
      setStatus('Set all markers (A,B,C,X,Y) before saving a preset.');
      return;
    }

    const rawName = (el.presetNameInput?.value || '').trim();
    const autoName = `Preset ${new Date().toLocaleString()}`;
    const preset = {
      id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: rawName || autoName,
      createdAt: Date.now(),
      startMs: offsets.startMs,
      endMs: offsets.endMs,
    };

    state.markerPresets.unshift(preset);
    persistMarkerPresets();
    renderPresetList();
    if (el.presetNameInput) el.presetNameInput.value = '';
    setStatus(`Saved preset "${preset.name}".`);
  }

  function applyMarkerPreset(presetId) {
    if (!state.audioBuffer) {
      setStatus('Load audio before applying presets.');
      return;
    }
    const preset = state.markerPresets.find((p) => p.id === presetId);
    if (!preset) return;

    const sr = state.audioBuffer.sampleRate;
    const maxSample = state.audioBuffer.length - 1;
    const durationMs = Math.round(state.audioBuffer.duration * 1000);

    const A = toSampleFromMs(Number(preset.startMs.A), sr);
    const B = toSampleFromMs(Number(preset.startMs.B), sr);
    const C = toSampleFromMs(Number(preset.startMs.C), sr);
    const X = toSampleFromMs(durationMs + Number(preset.endMs.X), sr);
    const Y = toSampleFromMs(durationMs + Number(preset.endMs.Y), sr);

    // Clamp and enforce strict ordering with at least 1-sample gaps.
    let nA = Math.max(0, Math.min(maxSample - 4, A));
    let nB = Math.max(nA + 1, Math.min(maxSample - 3, B));
    let nC = Math.max(nB + 1, Math.min(maxSample - 2, C));
    let nX = Math.max(nC + 1, Math.min(maxSample - 1, X));
    let nY = Math.max(nX + 1, Math.min(maxSample, Y));

    // If file is very short and constraints overflow, shift backward.
    if (nY > maxSample) nY = maxSample;
    if (nX >= nY) nX = nY - 1;
    if (nC >= nX) nC = nX - 1;
    if (nB >= nC) nB = nC - 1;
    if (nA >= nB) nA = nB - 1;

    if (!(nA >= 0 && nA < nB && nB < nC && nC < nX && nX < nY)) {
      setStatus('Preset could not fit this file duration. Try different markers.');
      return;
    }

    setMarkers({ A: nA, B: nB, C: nC, X: nX, Y: nY });
    setStatus(`Applied preset "${preset.name}".`);
  }

  function deleteMarkerPreset(presetId) {
    const idx = state.markerPresets.findIndex((p) => p.id === presetId);
    if (idx < 0) return;
    const [removed] = state.markerPresets.splice(idx, 1);
    persistMarkerPresets();
    renderPresetList();
    setStatus(`Deleted preset "${removed.name}".`);
  }

  function setWorkspaceEnabled(enabled) {
    el.btnPlayOriginal.disabled = !enabled;
    el.btnRenderAll.disabled = true;
    el.btnExportAll.disabled = true;
    el.btnStop.disabled = !enabled;
    el.btnPlayIntro.disabled = true;
    el.btnPlayLoop.disabled = true;
    el.btnPlayOutro.disabled = true;
  }

  function updateMarkerPlannerText(markerMode) {
    if (!markerMode) {
      el.markerPlannerText.textContent = 'Click the timeline after selecting which marker to set.';
      return;
    }
    el.markerPlannerText.textContent = `Click the timeline to set marker ${markerMode}.`;
  }

  function clampMarkerSample(name, sampleIndex) {
    if (!state.audioBuffer) return null;
    const len = state.audioBuffer.length;
    const s = Math.round(sampleIndex);
    return Math.max(0, Math.min(len - 1, s));
  }

  function applyOrderConstraints(markerName, sampleIndex) {
    const { A, B, C, X, Y } = state.markers;
    const d = state.audioBuffer.length - 1;
    const next = { ...state.markers };

    if (markerName === 'A') {
      const max = B != null ? B - 1 : d;
      next.A = Math.max(0, Math.min(max, sampleIndex));
    } else if (markerName === 'B') {
      const min = A != null ? A + 1 : 0;
      const max = C != null ? C - 1 : d;
      next.B = Math.max(min, Math.min(max, sampleIndex));
    } else if (markerName === 'C') {
      const min = B != null ? B + 1 : 0;
      const max = X != null ? X - 1 : d;
      next.C = Math.max(min, Math.min(max, sampleIndex));
    } else if (markerName === 'X') {
      const min = C != null ? C + 1 : 0;
      const max = Y != null ? Y - 1 : d;
      next.X = Math.max(min, Math.min(max, sampleIndex));
    } else if (markerName === 'Y') {
      const min = X != null ? X + 1 : 0;
      next.Y = Math.max(min, Math.min(d, sampleIndex));
    }
    return next;
  }

  function setMarkers(nextMarkers, { reRenderTimeline = true } = {}) {
    state.markers = { ...state.markers, ...nextMarkers };
    if (reRenderTimeline && state.timeline) state.timeline.setMarkers(state.markers);
    syncMarkerInputs();
    state.renderedParts = null;
    state.renderSignature = null;
    el.btnRenderAll.disabled = !isReadyToRender();
    el.btnExportAll.disabled = true;
    el.btnPlayIntro.disabled = true;
    el.btnPlayLoop.disabled = true;
    el.btnPlayOutro.disabled = true;
    validateMarkersAndUpdateWarning();
  }

  function validateMarkersAndUpdateWarning() {
    const warnEl = el.markersWarning;
    const { A, B, C, X, Y } = state.markers;
    if (!state.audioBuffer) {
      warnEl.textContent = '';
      return false;
    }

    const sr = state.audioBuffer.sampleRate;

    const missing = MARKER_NAMES.find((m) => state.markers[m] == null);
    if (missing) {
      warnEl.textContent = `Set marker ${missing}.`;
      return false;
    }

    if (!(A < B && B < C && C < X && X < Y)) {
      warnEl.textContent = 'Markers must be strictly increasing: A < B < C < X < Y.';
      return false;
    }

    const AB = B - A;
    const XY = Y - X;
    if (!(AB > 0 && XY > 0)) {
      warnEl.textContent = 'Invalid distances: require B > A and Y > X.';
      return false;
    }

    const warnings = [];
    const delta = Math.abs(AB - XY);
    if (delta > 1) {
      warnings.push(`(B-A) differs from (Y-X) by ${delta} samples (~${(delta / sr).toFixed(4)}s).`);
    }

    // Step 3 quality warning (non-blocking).
    const BC = C - B;
    const deltaBC = Math.abs(BC - XY);
    if (deltaBC > 1) {
      warnings.push(`(C-B) differs from (Y-X) by ${deltaBC} samples, outro seam may be less ideal.`);
    }

    // Additional sanity: AB must fit inside loop duration [B,X)
    if (AB > (X - B)) {
      warnEl.textContent = 'Invalid markers: require (B-A) <= (X-B) so the crossfade fits in the loop.';
      return false;
    }

    // Ensure indices in range
    const maxOk = state.audioBuffer.length - 1;
    if ([A, B, C, X, Y].some((s) => s < 0 || s > maxOk)) {
      warnEl.textContent = 'Invalid markers: out of range for this audio.';
      return false;
    }

    warnEl.textContent = warnings.length ? `Warning: ${warnings.join(' ')}` : '';

    // If we got here, we can render.
    return true;
  }

  function isReadyToRender() {
    if (!state.audioBuffer) return false;
    const { A, B, C, X, Y } = state.markers;
    if ([A, B, C, X, Y].some((s) => s == null)) return false;
    if (!(A < B && B < C && C < X && X < Y)) return false;
    const AB = B - A;
    if (!(AB > 0)) return false;
    if (AB > (X - B)) return false;
    const XY = Y - X;
    if (!(XY > 0)) return false;
    return true;
  }

  function syncMarkerInputs() {
    const buf = state.audioBuffer;
    if (!buf) return;

    for (const name of MARKER_NAMES) {
      const input = document.getElementById(`markerInput-${name}`);
      if (!input) continue;

      const sampleIndex = state.markers[name];
      if (sampleIndex == null) {
        input.value = '';
        input.placeholder = 'unset';
        continue;
      }

      const tSec = sampleIndex / buf.sampleRate;
      input.value = tSec.toFixed(4);
      input.dataset.sample = String(sampleIndex);
    }
  }

  function buildMarkerInputs() {
    const buf = state.audioBuffer;
    if (!buf) return;

    el.markersInputs.innerHTML = '';
    for (const name of MARKER_NAMES) {
      const dotColor = getComputedStyle(document.documentElement).getPropertyValue(`--${name.toLowerCase()}`).trim();
      const wrapper = document.createElement('div');
      wrapper.className = 'marker-input';

      const row = document.createElement('div');
      row.className = 'marker-row';
      const dot = document.createElement('div');
      dot.className = 'marker-dot';
      dot.style.background = dotColor || '#fff';

      const label = document.createElement('div');
      label.className = 'marker-name';
      label.textContent = name;

      const setBtn = document.createElement('button');
      setBtn.className = 'btn btn-tertiary btn-marker-mini';
      setBtn.type = 'button';
      setBtn.textContent = `Set ${name}`;
      setBtn.addEventListener('click', () => {
        setMarkerMode(name);
      });

      row.appendChild(dot);
      row.appendChild(label);
      row.appendChild(setBtn);

      const secondsLabel = document.createElement('label');
      secondsLabel.textContent = 'Seconds';

      const input = document.createElement('input');
      input.id = `markerInput-${name}`;
      input.type = 'number';
      input.step = '0.001';
      input.min = '0';
      input.max = buf.duration.toFixed(3);
      input.placeholder = 'unset';

      input.addEventListener('change', () => {
        const raw = input.value;
        if (!raw || raw.trim() === '') {
          // Keep it simple: do not allow clearing via numeric input.
          return;
        }
        const tSec = Number(raw);
        if (!Number.isFinite(tSec)) return;
        const sampleIndex = SlicerUtils.timeToSampleIndex(tSec, buf.sampleRate);
        const clamped = clampMarkerSample(name, sampleIndex);
        const constrained = applyOrderConstraints(name, clamped);
        setMarkers(constrained);
        validateMarkersAndUpdateWarning();
      });

      wrapper.appendChild(row);
      wrapper.appendChild(secondsLabel);
      wrapper.appendChild(input);
      el.markersInputs.appendChild(wrapper);
    }

    syncMarkerInputs();
  }

  function setMarkerMode(markerName) {
    state.timeline.setMarkerMode(markerName);

    // Active styling
    const btns = {
      A: el.setMarkerA,
      B: el.setMarkerB,
      C: el.setMarkerC,
      X: el.setMarkerX,
      Y: el.setMarkerY,
    };
    MARKER_NAMES.forEach((m) => btns[m].classList.toggle('active', m === markerName));
    updateMarkerPlannerText(markerName);
  }

  function clearMarkerModeIfSame(markerName) {
    if (state.timeline.markerMode === markerName) {
      setMarkerMode(null);
    }
  }

  async function renderIfPossible() {
    if (!state.audioBuffer) return;
    if (!isReadyToRender()) return;
    if (!validateMarkersAndUpdateWarning()) return;

    const sig = JSON.stringify(state.markers);
    if (state.renderedParts && state.renderSignature === sig) return;

    setStatus('Rendering parts locally…');
    el.btnRenderAll.disabled = true;
    el.btnExportAll.disabled = true;

    try {
      const markers = state.markers;
      state.renderedParts = await SlicerEngine.renderParts(state.audioBuffer, markers);
      state.renderSignature = sig;

      el.btnPlayIntro.disabled = false;
      el.btnPlayLoop.disabled = false;
      el.btnPlayOutro.disabled = false;
      el.btnExportAll.disabled = false;
      el.btnRenderAll.disabled = false;
      setStatus('Rendered. You can play and export.');
    } catch (e) {
      console.error(e);
      setStatus('Render failed. Check markers.');
      el.btnRenderAll.disabled = false;
      el.btnExportAll.disabled = true;
    }
  }

  function playPart(which) {
    if (!state.renderedParts) return;
    const buf = state.renderedParts[which];
    if (!buf) return;
    state.player.playBuffer(buf, 0);
  }

  async function onLoadFile(file) {
    state.selectedFile = file;
    if (!file) return;

    setStatus('Decoding audio…');

    const wavMeta = await SlicerAudioLoader.inspectWavFile(file);
    if (!wavMeta) {
      setStatus('Invalid WAV file.');
      throw new Error('Unsupported or invalid WAV file.');
    }
    state.wavMeta = wavMeta;
    if (Number(wavMeta.bitsPerSample) !== 24) {
      setStatus(`Expected 24-bit WAV, got ${wavMeta.bitsPerSample || 'unknown'}-bit.`);
      throw new Error('Only 24-bit WAV files are accepted in this build.');
    }

    const audioBuffer = await SlicerAudioLoader.decodeAudioFile(file);
    state.audioBuffer = audioBuffer;

    el.fileName.textContent = file.name || '—';
    el.fileBitDepth.textContent = `${wavMeta.bitsPerSample}-bit`;
    el.fileDuration.textContent = `${audioBuffer.duration.toFixed(3)}s`;
    el.fileChannels.textContent = String(audioBuffer.numberOfChannels);
    el.fileSampleRate.textContent = String(audioBuffer.sampleRate);

    state.renderedParts = null;
    state.renderSignature = null;
    state.markers = { A: null, B: null, C: null, X: null, Y: null };

    state.timeline.setAudioBuffer(audioBuffer);
    state.timeline.setMarkers(state.markers);
    buildMarkerInputs();
    validateMarkersAndUpdateWarning();
    el.workspaceScreen.classList.remove('hidden');
    el.startScreen.classList.add('hidden');

    setWorkspaceEnabled(true);
    el.btnPlayOriginal.disabled = false;
    el.btnRenderAll.disabled = true;
    setTool('slice-loop');

    setStatus('Audio loaded. Set markers to render parts.');
  }

  function exportParts() {
    if (!state.renderedParts) return;
    const base = SlicerUtils.getBaseFileName(state.selectedFile?.name || 'audio');

    const introBlob = SlicerWavExport.audioBufferToWavBlob(state.renderedParts.intro);
    const loopBlob = SlicerWavExport.audioBufferToWavBlob(state.renderedParts.loop);
    const outroBlob = SlicerWavExport.audioBufferToWavBlob(state.renderedParts.outro);

    SlicerUtils.downloadBlob(introBlob, `${base} 1.wav`);
    SlicerUtils.downloadBlob(loopBlob, `${base} 2.wav`);
    SlicerUtils.downloadBlob(outroBlob, `${base} 3.wav`);

    setStatus('Export started. Downloading WAV files…');
  }

  function attachZoomButtons() {
    el.btnZoomIn.addEventListener('click', () => {
      if (!state.timeline) return;
      state.timeline.zoomBy(0.86);
    });
    el.btnZoomOut.addEventListener('click', () => {
      if (!state.timeline) return;
      state.timeline.zoomBy(1.18);
    });
  }

  function initTimeline() {
    const TimelineCtor = window.SlicerTimeline && window.SlicerTimeline.SlicerTimeline;
    if (typeof TimelineCtor !== 'function') {
      throw new Error('Timeline module failed to load.');
    }

    state.timeline = new TimelineCtor({
      containerEl: el.timelineContainer,
      canvasEl: el.timelineCanvas,
      overlayEl: el.timelineOverlayHint,
      onPlaceMarkerAtSample: (markerName, sampleIndex) => {
        if (!state.audioBuffer) return;
        const constrained = applyOrderConstraints(markerName, clampMarkerSample(markerName, sampleIndex));
        setMarkers(constrained);
        // Keep mode; user may want to place multiple markers quickly.
        setStatus(`Set marker ${markerName} at ${(constrained[markerName] / state.audioBuffer.sampleRate).toFixed(3)}s`);
      },
      onMarkersChanged: (updatedMarkers) => {
        setMarkers(updatedMarkers);
      },
    });
  }

  function initUploadUI() {
    el.loadBtn.disabled = true;

    const tryEnable = () => {
      el.loadBtn.disabled = !state.selectedFile;
    };

    el.fileInput.addEventListener('change', () => {
      const f = el.fileInput.files && el.fileInput.files[0];
      state.selectedFile = f || null;
      tryEnable();
      setStatus(f ? `Selected: ${f.name} (expects 24-bit WAV)` : 'Waiting for audio…');
    });

    el.loadBtn.addEventListener('click', () => {
      if (!state.selectedFile) return;
      onLoadFile(state.selectedFile).catch((e) => {
        console.error(e);
        if (!/24-bit WAV/i.test(String(e && e.message))) {
          setStatus('Failed to load file.');
        }
      });
    });

    // Drag & drop
    window.addEventListener('dragover', (e) => {
      // Prevent browser from navigating to dropped file.
      e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      // Prevent browser from navigating to dropped file.
      e.preventDefault();
    });

    el.loadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    el.loadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      state.selectedFile = f;
      tryEnable();
      setStatus(`Selected: ${f.name} (expects 24-bit WAV)`);
    });
  }

  function initMarkerButtons() {
    const mapping = {
      A: el.setMarkerA,
      B: el.setMarkerB,
      C: el.setMarkerC,
      X: el.setMarkerX,
      Y: el.setMarkerY,
    };

    MARKER_NAMES.forEach((name) => {
      mapping[name].addEventListener('click', () => {
        setMarkerMode(name);
      });
    });
  }

  function initPlayback() {
    state.player = SlicerAudioLoader.createWebAudioPlayer();

    el.btnPlayOriginal.addEventListener('click', () => {
      if (!state.audioBuffer) return;
      state.player.playBuffer(state.audioBuffer, 0);
    });
    el.btnStop.addEventListener('click', () => state.player.stop());

    el.btnPlayIntro.addEventListener('click', () => playPart('intro'));
    el.btnPlayLoop.addEventListener('click', () => playPart('loop'));
    el.btnPlayOutro.addEventListener('click', () => playPart('outro'));
  }

  function initActions() {
    el.btnRenderAll.addEventListener('click', async () => {
      await renderIfPossible();
    });
    el.btnExportAll.addEventListener('click', () => {
      exportParts();
    });

    if (el.savePresetBtn) {
      el.savePresetBtn.addEventListener('click', () => saveCurrentMarkersAsPreset());
    }
  }

  function initToolMenu() {
    if (!el.btnToolsMenu) return;

    el.btnToolsMenu.addEventListener('click', () => {
      el.toolsDropdown.classList.toggle('hidden');
    });

    el.toolSliceLoop.addEventListener('click', () => {
      setTool('slice-loop');
    });

    window.addEventListener('click', (event) => {
      if (!el.btnToolsMenu.contains(event.target) && !el.toolsDropdown.contains(event.target)) {
        el.toolsDropdown.classList.add('hidden');
      }
    });
  }

  function init() {
    try {
      state.markerPresets = loadMarkerPresetsFromStorage();
      initTimeline();
      initUploadUI();
      initMarkerButtons();
      initPlayback();
      initActions();
      initToolMenu();
      attachZoomButtons();
      renderPresetList();

      // Default UI state
      setWorkspaceEnabled(false);
      updateMarkerPlannerText(null);
      setTool('slice-loop');
    } catch (e) {
      console.error(e);
      setStatus('Slicer failed to initialize. Check browser console for details.');
    }
  }

  init();
})();

