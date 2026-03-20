/* =============================================================
   S.E.A.M Audio Audition — Folder Selection, Discovery & Init
   ============================================================= */

// ─── FOLDER SELECT ───────────────────────────────────────────
document.getElementById('btn-select').addEventListener('click', selectFolder);
document.getElementById('btn-reselect').addEventListener('click', selectFolder);

async function selectFolder() {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    STATE.rootDir   = dirHandle;
    document.getElementById('select-status').textContent = `Loading: ${dirHandle.name} …`;
    await discoverSongs(dirHandle);
  } catch(e) {
    if (e.name !== 'AbortError') {
      document.getElementById('select-status').textContent = 'Could not open folder: ' + e.message;
    }
  }
}

async function discoverSongs(rootHandle) {
  const statusEl = document.getElementById('select-status');

  for (const fmt of STATE.formats) {
    let fmtHandle = null;
    try {
      fmtHandle = await rootHandle.getDirectoryHandle(fmt, { create: false });
    } catch(e) {
      STATE.songs[fmt] = [];
      continue;
    }

    statusEl.textContent = `Scanning ${fmt}/ …`;
    const songs = await scanFormat(fmtHandle);
    STATE.songs[fmt] = songs;
    STATE.order[fmt] = songs.map((_,i) => i);
  }

  // Load durations
  statusEl.textContent = 'Loading durations …';
  const allLoaders = [];
  for (const fmt of STATE.formats) {
    for (const song of STATE.songs[fmt]) {
      if (song.mainHandle) {
        allLoaders.push(
          getFileDuration(song.mainHandle).then(d => {
            song.duration = d;
          })
        );
      } else if (song.parts.length > 0) {
        const pLoaders = song.parts.map(p =>
          getFileDuration(p.handle).then(d => { p._dur = d; return d; })
        );
        allLoaders.push(
          Promise.all(pLoaders).then(durs => {
            song.duration = durs.reduce((a,b) => a+b, 0);
          })
        );
      }
    }
  }
  await Promise.all(allLoaders);

  // Restore session
  const saved = loadSession();
  STATE._savedSession = saved;
  if (saved) {
    STATE.crossfade    = saved.crossfade    ?? 0;
    STATE.speedPercent = saved.speedPercent ?? 100;
    STATE.currentFormat = saved.currentFormat ?? 'mp3';

    for (const fmt of STATE.formats) {
      if (saved.order && saved.order[fmt]) {
        const validOrder = saved.order[fmt].filter(i => STATE.songs[fmt][i] !== undefined);
        STATE.songs[fmt].forEach((_,i) => { if (!validOrder.includes(i)) validOrder.push(i); });
        STATE.order[fmt] = validOrder;
      }
    }
  }

  // Switch to main app
  document.getElementById('setup-panel').style.display = 'none';
  document.getElementById('main-app').style.display    = 'block';
  document.getElementById('btn-reselect').style.display = '';

  buildUI(saved);
  initKnob();
  initCrossfade();

  // Restore knob / crossfade values
  const cf = document.getElementById('crossfade-slider');
  if (cf) { cf.value = STATE.crossfade; document.getElementById('crossfade-val').textContent = `${STATE.crossfade} ms`; }

  // Restore open part sheets
  if (saved && saved.openSheets) {
    for (const sheetKey of saved.openSheets) {
      const [fmt, idxStr] = sheetKey.split('_');
      const songIdx = parseInt(idxStr, 10);
      if (STATE.songs[fmt] && STATE.songs[fmt][songIdx]) {
        togglePartSheet(fmt, songIdx);
      }
    }
  }

  statusEl.textContent = '';
}

// ─── INIT ────────────────────────────────────────────────────
initHelp();
