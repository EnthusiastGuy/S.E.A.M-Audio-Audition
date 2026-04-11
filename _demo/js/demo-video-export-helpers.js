/* =============================================================
   S.E.A.M — Demo video export helpers: playlist strip (forum-style
   ellipsis when many songs), layout metrics, on-disk audio size.
   Loaded before demo-video-export.js (see index.html).
   ============================================================= */

(function initSeamDemoVideoExportHelpers(global) {
  'use strict';

  /** Playlist chip strip is capped at this row count; overflow uses forum-style ellipsis. */
  const MAX_PLAYLIST_ROWS = 5;

  const ELLIPSIS_CHIP_TEXT = '···';

  /**
   * Greedy line break using minimum chipXGap (same rules as pre-justify flow).
   * @template T
   * @param {T[]} items
   * @param {number} innerW content width (W - 2*pad)
   * @param {number} chipXGap minimum horizontal gap between chips
   * @param {(item: T) => number} widthForItem
   * @returns {T[][]}
   */
  function breakPlaylistIntoRows(items, innerW, chipXGap, widthForItem) {
    const rows = [];
    let row = [];
    let cursor = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const w = widthForItem(item);
      if (row.length > 0 && cursor + chipXGap + w > innerW + 1e-6) {
        rows.push(row);
        row = [];
        cursor = 0;
      }
      row.push(item);
      cursor += row.length === 1 ? w : chipXGap + w;
    }
    if (row.length) rows.push(row);
    return rows;
  }

  /**
   * Space-between horizontally: first chip at `pad`, last ends at `pad + innerW`;
   * one chip is centered; gaps between chips share leftover width equally.
   * @param {number[]} widths
   * @param {number} innerW
   * @param {number} pad canvas left padding
   * @returns {number[]} x of each chip’s left edge
   */
  function justifyRowXArray(widths, innerW, pad) {
    const n = widths.length;
    if (n === 0) return [];
    if (n === 1) return [pad + (innerW - widths[0]) / 2];
    const sumTw = widths.reduce((a, b) => a + b, 0);
    const gap = (innerW - sumTw) / (n - 1);
    const xs = [pad];
    for (let i = 1; i < n; i++) {
      xs.push(xs[i - 1] + widths[i - 1] + gap);
    }
    return xs;
  }

  /**
   * @template T
   * @param {T[]} items
   * @param {number} innerW
   * @param {number} pad
   * @param {number} chipXGap
   * @param {number} topInset
   * @param {number} chipH
   * @param {number} chipGap vertical gap between rows
   * @param {(item: T) => number} widthForItem
   * @returns {{ rows: { items: T[], widths: number[], xs: number[] }[], rowCount: number, lastChipTopY: number, bandHeightFromPad: number }}
   */
  function computePlaylistJustifiedLayout(items, innerW, pad, chipXGap, topInset, chipH, chipGap, widthForItem) {
    const rowItems = breakPlaylistIntoRows(items, innerW, chipXGap, widthForItem);
    const rows = rowItems.map((r) => {
      const widths = r.map(widthForItem);
      const xs = justifyRowXArray(widths, innerW, pad);
      return { items: r, widths, xs };
    });
    const rowCount = items.length === 0 ? 1 : rows.length;
    const lastChipTopY =
      items.length === 0 ? pad + topInset : pad + topInset + (rowCount - 1) * (chipH + chipGap);
    const bandHeightFromPad =
      items.length === 0 ? topInset + chipH : lastChipTopY + chipH - pad;
    return { rows, rowCount, lastChipTopY, bandHeightFromPad };
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {string[]} rawTitles
   * @param {number} W
   * @param {number} pad
   * @param {(orderOneBased: number, rawTitle: string) => string} chipLabel
   * @param {number} s UI scale (e.g. CANVAS_W/1280)
   * @param {string} stack font stack CSS
   * @param {number} [playlistMul]
   * @returns {{ lastChipTopY: number, chipH: number, rowCount: number, bandHeightFromPad: number, topInset: number, chipGap: number, chipPad: number, chipXGap: number }}
   */
  function measurePlaylistChipLayout(ctx, rawTitles, W, pad, chipLabel, s, stack, playlistMul) {
    const pm = Math.max(0.35, playlistMul || 1);
    ctx.font = `600 ${Math.round(15 * s * pm)}px ${stack}`;
    const topInset = Math.round(8 * s * pm);
    const chipH = Math.round(28 * s * pm);
    const chipPad = Math.round(8 * s * pm);
    const chipGap = Math.round(6 * s * pm);
    const chipXGap = Math.round(8 * s * pm);
    const innerW = W - 2 * pad;
    const items = rawTitles.map((_, i) => ({ kind: 'song', index: i }));
    function widthForItem(item) {
      const label = chipLabel(item.index + 1, rawTitles[item.index]);
      return Math.min(ctx.measureText(label).width + chipPad * 2, W - pad * 2);
    }
    const { rowCount, lastChipTopY, bandHeightFromPad } = computePlaylistJustifiedLayout(
      items,
      innerW,
      pad,
      chipXGap,
      topInset,
      chipH,
      chipGap,
      widthForItem,
    );
    return { lastChipTopY, chipH, rowCount, bandHeightFromPad, topInset, chipGap, chipPad, chipXGap };
  }

  /**
   * @param {number[]} sortedIdx ascending unique song indices
   * @returns {Array<{ kind: 'song', index: number } | { kind: 'ellipsis' }>}
   */
  function songIndicesToStripItems(sortedIdx) {
    const items = [];
    for (let k = 0; k < sortedIdx.length; k++) {
      const idx = sortedIdx[k];
      if (k > 0 && sortedIdx[k - 1] + 1 < idx) items.push({ kind: 'ellipsis' });
      items.push({ kind: 'song', index: idx });
    }
    return items;
  }

  function visibleIndicesFromHeadTail(n, currentIdx, head, tail) {
    if (n <= 0) return [];
    const c = Math.min(Math.max(0, currentIdx), n - 1);
    const set = new Set();
    const hn = Math.min(head, n);
    const tn = Math.min(tail, n);
    for (let i = 0; i < hn; i++) set.add(i);
    for (let i = n - tn; i < n; i++) if (i >= 0) set.add(i);
    set.add(c);
    return [...set].sort((a, b) => a - b);
  }

  /**
   * @param {Array<{ kind: 'song', index: number } | { kind: 'ellipsis' }>} items
   */
  function measurePlaylistStripLayout(ctx, items, rawTitles, W, pad, chipLabel, s, stack, playlistMul) {
    const pm = Math.max(0.35, playlistMul || 1);
    ctx.font = `600 ${Math.round(15 * s * pm)}px ${stack}`;
    const topInset = Math.round(8 * s * pm);
    const chipH = Math.round(28 * s * pm);
    const chipPad = Math.round(8 * s * pm);
    const chipGap = Math.round(6 * s * pm);
    const chipXGap = Math.round(8 * s * pm);
    const innerW = W - 2 * pad;

    function widthForItem(item) {
      if (item.kind === 'ellipsis') {
        const w = ctx.measureText(ELLIPSIS_CHIP_TEXT).width + chipPad * 2;
        return Math.max(Math.round(34 * pm), Math.min(w, W - pad * 2));
      }
      const label = chipLabel(item.index + 1, rawTitles[item.index]);
      return Math.min(ctx.measureText(label).width + chipPad * 2, W - pad * 2);
    }

    const { rowCount, lastChipTopY, bandHeightFromPad } = computePlaylistJustifiedLayout(
      items,
      innerW,
      pad,
      chipXGap,
      topInset,
      chipH,
      chipGap,
      widthForItem,
    );
    return {
      lastChipTopY: items.length === 0 ? pad + topInset : lastChipTopY,
      chipH,
      rowCount,
      bandHeightFromPad,
      topInset,
      chipGap,
      chipPad,
      chipXGap,
    };
  }

  /**
   * Full list if it fits in maxRows; otherwise first/last windows + current + forum ellipses, tuned to stay within maxRows.
   * @returns {{ items: Array<{ kind: 'song', index: number } | { kind: 'ellipsis' }>, compressed: boolean, lastChipTopY: number, chipH: number, rowCount: number, bandHeightFromPad: number, topInset: number, chipGap: number, chipPad: number, chipXGap: number }}
   */
  function resolvePlaylistChipStrip(ctx, rawTitles, currentIdx, W, pad, chipLabel, s, stack, playlistMul, maxRows) {
    const cap = Math.max(1, Math.min(10, maxRows || MAX_PLAYLIST_ROWS));
    const n = rawTitles.length;
    const pm = Math.max(0.35, playlistMul || 1);
    const chipPad = Math.round(8 * s * pm);
    const chipXGap = Math.round(8 * s * pm);
    const topInset = Math.round(8 * s * pm);
    const chipH = Math.round(28 * s * pm);
    const chipGap = Math.round(6 * s * pm);

    if (n === 0) {
      return {
        items: [],
        compressed: false,
        lastChipTopY: pad + topInset,
        chipH,
        rowCount: 1,
        bandHeightFromPad: topInset + chipH,
        topInset,
        chipGap,
        chipPad,
        chipXGap,
      };
    }

    const fullMetrics = measurePlaylistChipLayout(ctx, rawTitles, W, pad, chipLabel, s, stack, playlistMul);
    if (fullMetrics.rowCount <= cap) {
      const items = rawTitles.map((_, i) => ({ kind: 'song', index: i }));
      return { items, compressed: false, ...fullMetrics };
    }

    for (let h = 5; h >= 1; h--) {
      for (let t = 5; t >= 1; t--) {
        const idx = visibleIndicesFromHeadTail(n, currentIdx, h, t);
        const items = songIndicesToStripItems(idx);
        const m = measurePlaylistStripLayout(ctx, items, rawTitles, W, pad, chipLabel, s, stack, playlistMul);
        if (m.rowCount <= cap) {
          return { items, compressed: true, ...m };
        }
      }
    }

    let idx = visibleIndicesFromHeadTail(n, currentIdx, 1, 1);
    let items = songIndicesToStripItems(idx);
    let m = measurePlaylistStripLayout(ctx, items, rawTitles, W, pad, chipLabel, s, stack, playlistMul);
    if (m.rowCount > cap) {
      idx = [...new Set([0, Math.min(Math.max(0, currentIdx), n - 1), n - 1])].sort((a, b) => a - b);
      items = songIndicesToStripItems(idx);
      m = measurePlaylistStripLayout(ctx, items, rawTitles, W, pad, chipLabel, s, stack, playlistMul);
    }
    return { items, compressed: true, ...m };
  }

  function playlistBandHeightCap(topInset, chipH, chipGap, rows) {
    const r = rows != null ? rows : MAX_PLAYLIST_ROWS;
    return topInset + r * chipH + (r - 1) * chipGap;
  }

  /**
   * @param {number} bandHeightFromPad
   * @param {number} topInset
   * @param {number} chipH
   * @param {number} chipGap
   * @param {number} s
   * @returns {number} playlist band height (from y=pad downward)
   */
  function resolvePlaylistBandHeight(bandHeightFromPad, topInset, chipH, chipGap, s) {
    const rowCap = playlistBandHeightCap(topInset, chipH, chipGap);
    const needed = Math.min(bandHeightFromPad, rowCap);
    const oneRowMin = topInset + chipH + Math.round(6 * s);
    return Math.max(oneRowMin, needed);
  }

  /**
   * @param {number} bytes
   * @returns {string}
   */
  function formatBytesBinary(bytes) {
    if (!isFinite(bytes) || bytes <= 0) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    const d = i === 0 ? 0 : v >= 10 ? 0 : 1;
    return `${v.toFixed(d)} ${u[i]}`;
  }

  /**
   * @param {number} bytes
   * @returns {string} e.g. "Size: 24.1 MB (.flac)"
   */
  function formatFlacSizeDetailLine(bytes) {
    const core = formatBytesBinary(bytes);
    if (!core) return 'Size: — (.flac)';
    return `Size: ${core} (.flac)`;
  }

  /**
   * Sum byte length of main + all part files on disk (best effort).
   * @param {object|null|undefined} song
   * @returns {Promise<number>}
   */
  async function sumSongSourceAudioBytes(song) {
    if (!song) return 0;
    let sum = 0;
    try {
      if (song.mainHandle && typeof song.mainHandle.getFile === 'function') {
        const f = await song.mainHandle.getFile();
        sum += Number(f.size) || 0;
      }
    } catch {
      /* ignore */
    }
    const parts = Array.isArray(song.parts) ? song.parts : [];
    for (const p of parts) {
      try {
        if (p && p.handle && typeof p.handle.getFile === 'function') {
          const f = await p.handle.getFile();
          sum += Number(f.size) || 0;
        }
      } catch {
        /* ignore */
      }
    }
    return sum;
  }

  global.SEAM_DEMO_VIDEO_EXPORT = {
    MAX_PLAYLIST_ROWS,
    ELLIPSIS_CHIP_TEXT,
    resolvePlaylistChipStrip,
    computePlaylistJustifiedLayout,
    playlistBandHeightCap,
    resolvePlaylistBandHeight,
    formatFlacSizeDetailLine,
    sumSongSourceAudioBytes,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
