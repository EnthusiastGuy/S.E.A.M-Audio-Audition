(() => {
  const Utils = {};

  Utils.clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  Utils.formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return '—';
    seconds = Math.max(0, seconds);
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);

    const pad2 = (n) => String(n).padStart(2, '0');
    const pad3 = (n) => String(n).padStart(3, '0');

    if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
    return `${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
  };

  Utils.sanitizeFileName = (name) =>
    String(name || '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  Utils.getBaseFileName = (fileName) => {
    const s = Utils.sanitizeFileName(fileName);
    const dot = s.lastIndexOf('.');
    return dot > 0 ? s.slice(0, dot) : s || 'audio';
  };

  Utils.downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  Utils.isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

  Utils.timeToSampleIndex = (tSec, sampleRate) => {
    if (!Number.isFinite(tSec) || !Number.isFinite(sampleRate)) return null;
    return Math.round(tSec * sampleRate);
  };

  Utils.sampleIndexToTime = (sampleIndex, sampleRate) => {
    if (!Number.isFinite(sampleIndex) || !Number.isFinite(sampleRate)) return null;
    return sampleIndex / sampleRate;
  };

  window.SlicerUtils = Utils;
})();

