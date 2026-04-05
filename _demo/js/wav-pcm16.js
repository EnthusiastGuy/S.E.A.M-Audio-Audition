/* =============================================================
   S.E.A.M — PCM 16-bit little-endian WAV parse & decode
   Standard linear PCM (WAVE_FORMAT_PCM = 1) and WAVE_FORMAT_EXTENSIBLE
   when SubFormat is KSDATAFORMAT_SUBTYPE_PCM and valid depth is 16-bit.
   Internal pipeline remains float32 AudioBuffers; export already writes PCM16.
   ============================================================= */

(function () {
  const PCM_GUID = new Uint8Array([
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
    0x80, 0x00, 0x00, 0xaa, 0x38, 0x9b, 0x71,
  ]);

  function guidMatches(u8, offset) {
    if (offset + 16 > u8.length) return false;
    for (let i = 0; i < 16; i++) {
      if (u8[offset + i] !== PCM_GUID[i]) return false;
    }
    return true;
  }

  function readFmt(view, u8, payload, size) {
    if (size < 16 || payload + size > u8.length) return null;

    const audioFormat = view.getUint16(payload, true);
    const numChannels = view.getUint16(payload + 2, true);
    const sampleRate = view.getUint32(payload + 4, true);
    const byteRate = view.getUint32(payload + 8, true);
    const blockAlign = view.getUint16(payload + 12, true);
    const bitsPerSample = view.getUint16(payload + 14, true);

    if (numChannels < 1 || numChannels > 32) return null;
    if (!Number.isFinite(sampleRate) || sampleRate < 1 || sampleRate > 384000)
      return null;
    if (blockAlign !== numChannels * 2) return null;

    let isPcm16 = false;
    if (audioFormat === 1) {
      isPcm16 = bitsPerSample === 16;
    } else if (audioFormat === 0xfffe && size >= 40) {
      const cbSize = view.getUint16(payload + 16, true);
      if (cbSize < 22 || size < 18 + cbSize) return null;
      const validBits = view.getUint16(payload + 18, true);
      const subOffset = payload + 24;
      if (!guidMatches(u8, subOffset)) return null;
      isPcm16 = validBits === 16 && bitsPerSample === 16;
    }

    if (!isPcm16) return null;

    const expectedByteRate = sampleRate * blockAlign;
    if (byteRate !== expectedByteRate) return null;

    return { sampleRate, numChannels, blockAlign };
  }

  /**
   * @param {ArrayBuffer} arrayBuffer
   * @param {{ strictData: boolean }} opts strictData: entire data chunk must be present (decode)
   * @returns {null | {
   *   sampleRate: number,
   *   numChannels: number,
   *   blockAlign: number,
   *   numFrames: number,
   *   dataOffset: number,
   *   dataSize: number
   * }}
   */
  function parseWavPcm16Layout(arrayBuffer, opts) {
    const strictData = !!(opts && opts.strictData);
    const u8 = new Uint8Array(arrayBuffer);
    if (u8.length < 12) return null;
    if (u8[0] !== 0x52 || u8[1] !== 0x49 || u8[2] !== 0x46 || u8[3] !== 0x46)
      return null;
    if (u8[8] !== 0x57 || u8[9] !== 0x41 || u8[10] !== 0x56 || u8[11] !== 0x45)
      return null;

    const view = new DataView(arrayBuffer);
    let fmtInfo = null;
    let dataOffset = 0;
    let dataSize = 0;

    let off = 12;
    while (off + 8 <= u8.length) {
      const id =
        String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
      const size = view.getUint32(off + 4, true);
      const payload = off + 8;

      if (id === 'fmt ' && fmtInfo === null) {
        if (payload + size > u8.length) return null;
        const parsed = readFmt(view, u8, payload, size);
        if (!parsed) return null;
        fmtInfo = parsed;
      } else if (id === 'data' && dataSize === 0) {
        dataOffset = payload;
        dataSize = size;
      }

      off = payload + size + (size & 1);
    }

    if (!fmtInfo || dataSize === 0) return null;

    const { sampleRate, numChannels, blockAlign } = fmtInfo;
    const numFrames = Math.floor(dataSize / blockAlign);
    if (numFrames <= 0) return null;

    if (strictData) {
      if (dataOffset + dataSize > u8.length) return null;
    }

    return {
      sampleRate,
      numChannels,
      blockAlign,
      numFrames,
      dataOffset,
      dataSize,
    };
  }

  /**
   * Duration in seconds for a PCM16 WAV, or null if not a decodable PCM16 layout.
   * Uses chunk headers only; full PCM payload need not be in the buffer.
   * @param {ArrayBuffer} arrayBuffer
   */
  function wavPcm16DurationFromArrayBuffer(arrayBuffer) {
    const L = parseWavPcm16Layout(arrayBuffer, { strictData: false });
    if (!L) return null;
    return L.numFrames / L.sampleRate;
  }

  /**
   * Decode PCM16 WAV to an AudioBuffer. Returns null if not PCM16 or corrupt.
   * @param {AudioContext} audioContext
   * @param {ArrayBuffer} arrayBuffer
   * @returns {AudioBuffer|null}
   */
  function tryDecodePcm16WavToAudioBuffer(audioContext, arrayBuffer) {
    const L = parseWavPcm16Layout(arrayBuffer, { strictData: true });
    if (!L) return null;

    const { sampleRate, numChannels, numFrames, dataOffset } = L;
    const totalSamples = numFrames * numChannels;

    let intView;
    try {
      if (dataOffset % 2 === 0 && arrayBuffer.byteLength >= dataOffset + totalSamples * 2) {
        intView = new Int16Array(arrayBuffer, dataOffset, totalSamples);
      } else {
        const copy = arrayBuffer.slice(dataOffset, dataOffset + totalSamples * 2);
        intView = new Int16Array(copy);
      }
    } catch (e) {
      return null;
    }

    const buf = audioContext.createBuffer(numChannels, numFrames, sampleRate);
    for (let ch = 0; ch < numChannels; ch++) {
      const out = buf.getChannelData(ch);
      let i = ch;
      for (let f = 0; f < numFrames; f++, i += numChannels) {
        const s = intView[i];
        out[f] = s < 0 ? s / 0x8000 : s / 0x7fff;
      }
    }

    return buf;
  }

  globalThis.SEAM_WAV_PCM16 = {
    parseWavPcm16Layout,
    wavPcm16DurationFromArrayBuffer,
    tryDecodePcm16WavToAudioBuffer,
  };
})();
