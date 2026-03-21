/* =============================================================
   S.E.A.M Audio Audition — File Parsing & Directory Scanning
   ============================================================= */

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
      const ext = fname.slice(fname.lastIndexOf('.')+1).toLowerCase();
      if (ext !== 'wav') continue;

      const parsed = parseFilename(fname);
      const entry  = ensureSong(songName);

      if (parsed.partNum === null) {
        entry.mainFile   = fname;
        entry.mainHandle = fileHandle;
      } else {
        entry.parts.set(parsed.partNum, { file: fname, handle: fileHandle, nexts: parsed.nexts });
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

  result.sort((a,b) => a.name.localeCompare(b.name));
  result.forEach((s,i) => { s.key = `${i}_${s.name}`; });

  return result;
}

// ─── DURATION HELPER ─────────────────────────────────────────
async function getFileDuration(fileHandle) {
  try {
    const file = await fileHandle.getFile();
    const url  = URL.createObjectURL(file);
    return await new Promise((res, rej) => {
      const a = new Audio();
      a.onloadedmetadata = () => { URL.revokeObjectURL(url); res(a.duration || 0); };
      a.onerror = () => { URL.revokeObjectURL(url); res(0); };
      a.src = url;
    });
  } catch(e) { return 0; }
}
