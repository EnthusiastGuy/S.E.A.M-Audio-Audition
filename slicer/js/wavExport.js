(() => {
  function audioBufferToWavBlob(audioBuffer) {
    // 24-bit PCM WAV export.
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const numFrames = audioBuffer.length;
    const bytesPerSample = 3; // 24-bit
    const dataSize = numFrames * numChannels * bytesPerSample;

    const wavBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(wavBuffer);

    function writeStr(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM format = 1
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, 24, true); // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
        // Signed 24-bit little-endian PCM.
        let int24 = sample < 0 ? Math.round(sample * 0x800000) : Math.round(sample * 0x7fffff);
        int24 = Math.max(-0x800000, Math.min(0x7fffff, int24));
        if (int24 < 0) int24 += 0x1000000; // two's complement for 24-bit

        view.setUint8(offset, int24 & 0xff);
        view.setUint8(offset + 1, (int24 >> 8) & 0xff);
        view.setUint8(offset + 2, (int24 >> 16) & 0xff);
        offset += 3;
      }
    }

    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  window.SlicerWavExport = { audioBufferToWavBlob };
})();

