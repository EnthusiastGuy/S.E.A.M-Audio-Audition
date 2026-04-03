(() => {
  // Equal-power crossfade curves — constant perceived loudness across the transition.
  function xfadeOut(t) { return Math.cos(t * Math.PI * 0.5); }
  function xfadeIn(t)  { return Math.sin(t * Math.PI * 0.5); }

  function createBuffer(audioBuffer, outFrames) {
    const sr = audioBuffer.sampleRate;
    const ch = audioBuffer.numberOfChannels;
    const offline = new OfflineAudioContext(ch, outFrames, sr);
    if (typeof offline.createBuffer === 'function') {
      return offline.createBuffer(ch, outFrames, sr);
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio API unavailable.');
    return new Ctx().createBuffer(ch, outFrames, sr);
  }

  // ── Part 1 — Intro: original [0 .. B) ──────────────────────────
  //    Straight copy, no processing needed.
  function renderIntroPart(audioBuffer, B) {
    const end = Math.max(0, Math.min(audioBuffer.length, B));
    const out = createBuffer(audioBuffer, end);
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      out.getChannelData(ch).set(audioBuffer.getChannelData(ch).subarray(0, end));
    }
    return out;
  }

  // ── Part 2 — Loop body: original [B .. X] ──────────────────────
  //    At the tail, the AB segment [A..B] is crossfaded IN while the
  //    middle audio fades OUT.  This makes the last output sample equal
  //    src[B], which is also the first output sample — seamless loop.
  //
  //    Timeline picture (output indices):
  //
  //    |--- clean middle (src[B..overlapStart-1]) ---|--- crossfade ---|
  //                                                  ^                 ^
  //                                          overlapStart        loopLen-1
  //
  //    In the crossfade zone:
  //      middle (src[overlapStartAbs .. X]) fades OUT
  //      AB     (src[A .. B])               fades IN
  //    aligned so that output's last sample maps to src[B].
  function renderLoopPart(audioBuffer, markers) {
    const { A, B, X } = markers;
    const len = audioBuffer.length;

    if (!(B > A))  throw new Error('Require B > A');
    if (!(X > B))  throw new Error('Require X > B');
    if (!(X < len)) throw new Error('X out of range');

    const abLen   = B - A;        // number of crossfade samples (exclusive endpoints: A inclusive, B exclusive in the fade zone)
    const loopLen = X - B;        // output length in samples
    if (abLen < 1 || abLen > loopLen) throw new Error('Require 0 < (B-A) <= (X-B)');

    const fadeStart = loopLen - abLen; // output index where crossfade begins
    const out = createBuffer(audioBuffer, loopLen);

    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const dst = out.getChannelData(ch);
      const src = audioBuffer.getChannelData(ch);

      // Clean middle — straight copy of src[B .. B+fadeStart-1]
      for (let i = 0; i < fadeStart; i++) {
        dst[i] = src[B + i];
      }

      // Crossfade zone
      for (let j = 0; j < abLen; j++) {
        const t = j / abLen;             // 0 at start … approaches 1 at end
        const middleSample = src[B + fadeStart + j]; // fading out
        const abSample     = src[A + j];             // fading in
        dst[fadeStart + j] = middleSample * xfadeOut(t) + abSample * xfadeIn(t);
      }
    }

    // Safety: force last sample == first sample so a sample-accurate
    // loop player sees zero discontinuity.
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const d = out.getChannelData(ch);
      d[loopLen - 1] = d[0];
    }

    return out;
  }

  // ── Part 3 — Outro: original [X .. end) ────────────────────────
  //    At the head, BC segment [B..C] is crossfaded OUT while the
  //    outro audio (src[X..]) fades IN.
  //
  //    |--- crossfade ---|--- clean outro tail (src[X+fadeLen..end]) ---|
  //    ^                 ^
  //    0            fadeLen-1
  //
  //    In the crossfade zone:
  //      BC    (src[B .. B+fadeLen-1]) fades OUT
  //      outro (src[X .. X+fadeLen-1]) fades IN
  function renderOutroPart(audioBuffer, markers) {
    const { B, C, X, Y } = markers;
    const len = audioBuffer.length;

    if (!(C > B))  throw new Error('Require C > B');
    if (!(Y > X))  throw new Error('Require Y > X');
    if (!(X >= 0 && X < len)) throw new Error('X out of range');

    const outroLen = len - X;
    const bcLen    = C - B;
    const xyLen    = Y - X;
    const fadeLen  = Math.max(1, Math.min(bcLen, xyLen, outroLen));

    const out = createBuffer(audioBuffer, outroLen);

    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const dst = out.getChannelData(ch);
      const src = audioBuffer.getChannelData(ch);

      // Crossfade zone
      for (let j = 0; j < fadeLen; j++) {
        const t = j / fadeLen;             // 0 at start … approaches 1 at end
        const bcSample    = src[B + j];    // fading out
        const outroSample = src[X + j];    // fading in
        dst[j] = bcSample * xfadeOut(t) + outroSample * xfadeIn(t);
      }

      // Clean outro tail
      for (let i = fadeLen; i < outroLen; i++) {
        dst[i] = src[X + i];
      }
    }

    return out;
  }

  async function renderParts(audioBuffer, markers) {
    const { A, B, C, X, Y } = markers;
    if ([A, B, C, X, Y].some(v => !Number.isFinite(v) || v < 0))
      throw new Error('All markers must be set');
    if (!(audioBuffer.length > 0)) throw new Error('Audio buffer empty');

    return {
      intro: renderIntroPart(audioBuffer, B),
      loop:  renderLoopPart(audioBuffer, markers),
      outro: renderOutroPart(audioBuffer, markers),
    };
  }

  window.SlicerEngine = { renderParts };
})();
