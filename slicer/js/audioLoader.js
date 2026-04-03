(() => {
  let AC = null;

  async function ensureAudioContext() {
    if (AC) return AC;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio API unavailable in this browser.');
    AC = new Ctx();
    return AC;
  }

  async function decodeAudioFile(file) {
    const ac = await ensureAudioContext();
    const arrBuf = await file.arrayBuffer();
    // decodeAudioData supports ArrayBuffer in all modern browsers.
    const audioBuffer = await ac.decodeAudioData(arrBuf);
    return audioBuffer;
  }

  async function inspectWavFile(file) {
    const arrBuf = await file.arrayBuffer();
    const view = new DataView(arrBuf);
    if (view.byteLength < 44) return null;

    const read4 = (offset) => String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );

    if (read4(0) !== 'RIFF' || read4(8) !== 'WAVE') return null;

    let ptr = 12;
    while (ptr + 8 <= view.byteLength) {
      const chunkId = read4(ptr);
      const chunkSize = view.getUint32(ptr + 4, true);
      const dataOffset = ptr + 8;
      if (chunkId === 'fmt ' && dataOffset + 16 <= view.byteLength) {
        const audioFormat = view.getUint16(dataOffset, true);
        const channels = view.getUint16(dataOffset + 2, true);
        const sampleRate = view.getUint32(dataOffset + 4, true);
        const bitsPerSample = view.getUint16(dataOffset + 14, true);
        return { audioFormat, channels, sampleRate, bitsPerSample };
      }
      ptr = dataOffset + chunkSize + (chunkSize % 2);
    }

    return null;
  }

  function createWebAudioPlayer() {
    let currentSource = null;
    let stopFn = null;
    let playbackStartedAt = 0;

    async function playBuffer(audioBuffer, startAtSec = 0) {
      const ac = await ensureAudioContext();
      if (ac.state === 'suspended') await ac.resume();
      stop();

      const src = ac.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ac.destination);

      // Keep reference for stop.
      currentSource = src;
      playbackStartedAt = performance.now();
      src.start(0, Math.max(0, startAtSec));

      stopFn = () => {
        try {
          src.stop();
        } catch (e) {}
        currentSource = null;
        stopFn = null;
      };
    }

    function stop() {
      if (stopFn) stopFn();
    }

    return { playBuffer, stop };
  }

  window.SlicerAudioLoader = { decodeAudioFile, inspectWavFile, createWebAudioPlayer };
})();

