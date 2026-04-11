/* =============================================================
   S.E.A.M Audio Audition — File Parsing & Directory Scanning
   ============================================================= */

const SEAM_SEGMENT_AUDIO_EXTS = new Set(['wav', 'flac']);

function seamSegmentAudioExt(fname) {
  const dot = fname.lastIndexOf('.');
  return dot >= 0 ? fname.slice(dot + 1).toLowerCase() : '';
}

/** Lower rank wins when the same part or main exists in multiple formats (prefer WAV over FLAC). */
function seamSegmentAudioExtRank(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'wav') return 0;
  if (e === 'flac') return 1;
  return 99;
}

// ─── FILE PARSING ────────────────────────────────────────────
/*
  Part filename pattern: "Song Name N -> A, B, C.ext"
  Full song filename: "Song Name.ext" (no number/arrow)
  Returns: { songName, partNum (or null), nexts: [Numbers] }
*/
function parseFilename(fname) {
  const dot = fname.lastIndexOf('.');
  const base = dot >= 0 ? fname.slice(0, dot) : fname;
  const ext  = dot >= 0 ? fname.slice(dot+1).toLowerCase() : '';

  // Try to match part pattern:  "... N - A, B, C" or "... N -> A, B, C"
  const partMatch = base.match(/^(.+?)\s+(\d+)\s*(?:->|-)\s*([\d,\s]+)$/);
  if (partMatch) {
    const songName = partMatch[1].trim();
    const partNum  = parseInt(partMatch[2], 10);
    const nexts    = partMatch[3].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    return { songName, partNum, nexts, base, ext };
  }

  // Try terminal part pattern: "... N.ext" with a number at end but no arrow
  const termMatch = base.match(/^(.+?)\s+(\d+)$/);
  if (termMatch) {
    const songName = termMatch[1].trim();
    const partNum  = parseInt(termMatch[2], 10);
    return { songName, partNum, nexts: [], base, ext };
  }

  // Otherwise it's the full song
  return { songName: base.trim(), partNum: null, nexts: [], base, ext };
}

// ─── SONG FOLDER ORDER ───────────────────────────────────────
/** Leading integer at start of folder name (e.g. "1. Title" → 1). */
function leadingPrefixNumber(name) {
  const m = String(name).match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function compareSongFolderNames(a, b) {
  const na = leadingPrefixNumber(a.name);
  const nb = leadingPrefixNumber(b.name);
  if (na != null && nb != null && na !== nb) return na - nb;
  return a.name.localeCompare(b.name);
}

// ─── SCAN DIRECTORY ──────────────────────────────────────────
async function scanFormat(formatHandle) {
  const songMap = new Map();
  function ensureSong(name) {
    if (!songMap.has(name)) songMap.set(name, { mainFile: null, mainHandle: null, parts: new Map() });
    return songMap.get(name);
  }

  for await (const [dirName, dirHandle] of formatHandle.entries()) {
    if (dirHandle.kind !== 'directory') continue;
    const songName = dirName;

    for await (const [fname, fileHandle] of dirHandle.entries()) {
      if (fileHandle.kind !== 'file') continue;
      const ext = seamSegmentAudioExt(fname);
      if (!SEAM_SEGMENT_AUDIO_EXTS.has(ext)) continue;

      const parsed = parseFilename(fname);
      const entry  = ensureSong(songName);
      const rank = seamSegmentAudioExtRank(ext);

      if (parsed.partNum === null) {
        const curRank = entry.mainFile ? seamSegmentAudioExtRank(seamSegmentAudioExt(entry.mainFile)) : 99;
        if (!entry.mainHandle || rank <= curRank) {
          entry.mainFile   = fname;
          entry.mainHandle = fileHandle;
        }
      } else {
        const existing = entry.parts.get(parsed.partNum);
        const curRank = existing ? seamSegmentAudioExtRank(seamSegmentAudioExt(existing.file)) : 99;
        if (!existing || rank <= curRank) {
          entry.parts.set(parsed.partNum, { file: fname, handle: fileHandle, nexts: parsed.nexts });
        }
      }
    }
  }

  const result = [];
  for (const [name, data] of songMap.entries()) {
    const partsArr = Array.from(data.parts.entries())
      .map(([num, p]) => ({ num, ...p }))
      .sort((a,b) => a.num - b.num);

    if (!data.mainHandle && partsArr.length === 0) continue;

    result.push({
      name,
      mainHandle: data.mainHandle,
      mainFile: data.mainFile,
      parts: partsArr,
      duration: 0,
      key: null,
    });
  }

  result.sort(compareSongFolderNames);
  result.forEach((s,i) => { s.key = `${i}_${s.name}`; });

  return result;
}

// ─── DURATION HELPER ─────────────────────────────────────────
async function getFileDuration(fileHandle) {
  try {
    const file = await fileHandle.getFile();
    const name = String(file.name || '').toLowerCase();
    const seamWav = globalThis.SEAM_WAV_PCM16;

    if (seamWav && name.endsWith('.wav')) {
      const tryProbe = async maxBytes => {
        const n = Math.min(file.size, maxBytes);
        if (n < 12) return null;
        const buf = await file.slice(0, n).arrayBuffer();
        return seamWav.wavPcm16DurationFromArrayBuffer(buf);
      };

      let d = await tryProbe(4 * 1024 * 1024);
      if (d == null || !Number.isFinite(d) || d <= 0) {
        if (file.size > 4 * 1024 * 1024 && file.size <= 64 * 1024 * 1024) {
          d = await tryProbe(file.size);
        }
      }
      if (d != null && Number.isFinite(d) && d > 0) return d;
    }

    const url = URL.createObjectURL(file);
    return await new Promise((res, rej) => {
      const a = new Audio();
      a.onloadedmetadata = () => { URL.revokeObjectURL(url); res(a.duration || 0); };
      a.onerror = () => { URL.revokeObjectURL(url); res(0); };
      a.src = url;
    });
  } catch (e) { return 0; }
}
