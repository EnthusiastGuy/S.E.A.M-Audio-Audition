/* =============================================================
   S.E.A.M — QuickTime-style moov.udta.meta.ilst description atom
   for MP4 (UTF-8 in ilst.desc). Load before demo-video-export.js.
   ============================================================= */

(function initSeamMp4DescriptionMeta(global) {
  'use strict';

  const MAX_DESCRIPTION_UTF8_BYTES = 65502;

  function writeU32BE(u8, o, v) {
    u8[o] = (v >>> 24) & 255;
    u8[o + 1] = (v >>> 16) & 255;
    u8[o + 2] = (v >>> 8) & 255;
    u8[o + 3] = v & 255;
  }

  /**
   * @param {string} descriptionText full YouTube-style chapter text (truncated if huge)
   * @returns {Uint8Array|null} complete `meta` box (not `udta`), or null if empty
   */
  function buildMetaIlstDescriptionAtom(descriptionText) {
    const raw = String(descriptionText || '').trim();
    if (!raw) return null;

    const enc = new TextEncoder();
    let textBytes = enc.encode(raw);
    if (textBytes.length > MAX_DESCRIPTION_UTF8_BYTES) {
      textBytes = textBytes.slice(0, MAX_DESCRIPTION_UTF8_BYTES);
    }

    const dataBoxSize = 8 + 4 + 4 + textBytes.length;
    const descItemSize = 8 + dataBoxSize;
    const ilstSize = 8 + descItemSize;
    const hdlrSize = 33;
    const metaSize = 8 + 4 + hdlrSize + ilstSize;

    const buf = new Uint8Array(metaSize);
    let o = 0;

    writeU32BE(buf, o, metaSize);
    o += 4;
    buf[o++] = 0x6d;
    buf[o++] = 0x65;
    buf[o++] = 0x74;
    buf[o++] = 0x61;
    buf[o++] = 0;
    buf[o++] = 0;
    buf[o++] = 0;
    buf[o++] = 0;

    writeU32BE(buf, o, hdlrSize);
    o += 4;
    buf[o++] = 0x68;
    buf[o++] = 0x64;
    buf[o++] = 0x6c;
    buf[o++] = 0x72;
    buf[o++] = 0;
    buf[o++] = 0;
    buf[o++] = 0;
    buf[o++] = 0;
    writeU32BE(buf, o, 0);
    o += 4;
    buf[o++] = 0x6d;
    buf[o++] = 0x64;
    buf[o++] = 0x69;
    buf[o++] = 0x72;
    writeU32BE(buf, o, 0);
    o += 4;
    writeU32BE(buf, o, 0);
    o += 4;
    writeU32BE(buf, o, 0);
    o += 4;
    buf[o++] = 0;

    writeU32BE(buf, o, ilstSize);
    o += 4;
    buf[o++] = 0x69;
    buf[o++] = 0x6c;
    buf[o++] = 0x73;
    buf[o++] = 0x74;

    writeU32BE(buf, o, descItemSize);
    o += 4;
    buf[o++] = 0x64;
    buf[o++] = 0x65;
    buf[o++] = 0x73;
    buf[o++] = 0x63;

    writeU32BE(buf, o, dataBoxSize);
    o += 4;
    buf[o++] = 0x64;
    buf[o++] = 0x61;
    buf[o++] = 0x74;
    buf[o++] = 0x61;
    writeU32BE(buf, o, 1);
    o += 4;
    writeU32BE(buf, o, 0);
    o += 4;
    buf.set(textBytes, o);

    return buf;
  }

  global.SEAM_MP4_DESCRIPTION_META = {
    buildMetaIlstDescriptionAtom,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
