/* =============================================================
   S.E.A.M Audio Audition — Folder Selection, Discovery & Init
   ============================================================= */

// ─── FOLDER SELECT ───────────────────────────────────────────
document.getElementById('btn-select').addEventListener('click', selectFolder);
document.getElementById('folder-switcher').addEventListener('change', onFolderSwitcherChange);

const RECENT_PROJECTS_MAX = 10;
const RECENT_DB_NAME = 'seam_recent_projects_db';
const RECENT_STORE_NAME = 'handles';
const RECENT_LIST_KEY = 'seam_recent_projects_v1';

initRecentProjectsUI();

async function getRecentProjectsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(RECENT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECENT_STORE_NAME)) {
        db.createObjectStore(RECENT_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open IndexedDB'));
  });
}

async function saveRecentHandle(id, handle) {
  const db = await getRecentProjectsDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(RECENT_STORE_NAME, 'readwrite');
    tx.objectStore(RECENT_STORE_NAME).put(handle, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not save directory handle'));
  });
}

async function loadRecentHandle(id) {
  const db = await getRecentProjectsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECENT_STORE_NAME, 'readonly');
    const req = tx.objectStore(RECENT_STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('Could not read directory handle'));
  });
}

function loadRecentProjectMeta() {
  try {
    const raw = localStorage.getItem(RECENT_LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(e => e && typeof e.id === 'string' && typeof e.name === 'string');
  } catch (e) {
    return [];
  }
}

function saveRecentProjectMeta(list) {
  localStorage.setItem(RECENT_LIST_KEY, JSON.stringify(list.slice(0, RECENT_PROJECTS_MAX)));
}

async function addRecentProject(handle) {
  if (!handle) return;
  const id = `project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await saveRecentHandle(id, handle);

  const current = loadRecentProjectMeta().filter(entry => entry.name !== handle.name);
  current.unshift({ id, name: handle.name, updatedAt: Date.now() });
  saveRecentProjectMeta(current);
}

function initRecentProjectsUI() {
  renderRecentProjects();
  renderFolderSwitcher();
}

function renderRecentProjects() {
  const wrap = document.getElementById('recent-projects-wrap');
  const listEl = document.getElementById('recent-projects-list');
  if (!wrap || !listEl) return;

  const items = loadRecentProjectMeta().slice(0, RECENT_PROJECTS_MAX);
  listEl.innerHTML = '';

  if (!items.length) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = '';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-project-btn';
    btn.textContent = item.name;
    btn.addEventListener('click', () => openRecentProject(item.id));
    listEl.appendChild(btn);
  }
}

function renderFolderSwitcher() {
  const switcher = document.getElementById('folder-switcher');
  if (!switcher) return;

  const items = loadRecentProjectMeta().slice(0, RECENT_PROJECTS_MAX);
  switcher.innerHTML = '';

  const labelOpt = document.createElement('option');
  labelOpt.value = '';
  labelOpt.textContent = 'Change Folder';
  switcher.appendChild(labelOpt);

  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = `recent:${item.id}`;
    opt.textContent = item.name;
    switcher.appendChild(opt);
  }

  const browseOpt = document.createElement('option');
  browseOpt.value = 'browse';
  browseOpt.textContent = 'Browse…';
  switcher.appendChild(browseOpt);

  switcher.value = '';
}

async function onFolderSwitcherChange(e) {
  const value = e.target.value;
  e.target.value = '';
  if (!value) return;
  if (value === 'browse') {
    await selectFolder();
    return;
  }
  if (value.startsWith('recent:')) {
    const projectId = value.slice('recent:'.length);
    await openRecentProject(projectId);
  }
}

async function openRecentProject(projectId) {
  const statusEl = document.getElementById('select-status');
  try {
    statusEl.textContent = 'Reopening recent project …';
    const handle = await loadRecentHandle(projectId);
    if (!handle) {
      statusEl.textContent = 'This recent project is no longer available.';
      return;
    }

    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') {
      perm = await handle.requestPermission({ mode: 'read' });
    }
    if (perm !== 'granted') {
      statusEl.textContent = 'Permission denied for that folder.';
      return;
    }

    STATE.rootDir = handle;
    await addRecentProject(handle);
    renderRecentProjects();
    renderFolderSwitcher();
    statusEl.textContent = `Loading: ${handle.name} …`;
    await discoverSongs(handle);
  } catch (e) {
    statusEl.textContent = 'Could not reopen recent project: ' + e.message;
  }
}

async function selectFolder() {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    STATE.rootDir   = dirHandle;
    await addRecentProject(dirHandle);
    renderRecentProjects();
    renderFolderSwitcher();
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
  const fmt = 'wav';
  let fmtHandle = null;
  try {
    fmtHandle = await rootHandle.getDirectoryHandle(fmt, { create: false });
  } catch(e) {
    STATE.songs[fmt] = [];
    STATE.order[fmt] = [];
    statusEl.textContent = 'Missing required wav/ directory.';
    return;
  }
  statusEl.textContent = `Scanning ${fmt}/ …`;
  const songs = await scanFormat(fmtHandle);
  STATE.songs[fmt] = songs;
  STATE.order[fmt] = songs.map((_,i) => i);

  // Load durations
  statusEl.textContent = 'Loading durations …';
  const allLoaders = [];
  for (const song of STATE.songs.wav) {
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
  await Promise.all(allLoaders);

  // Restore session
  const saved = loadSession();
  STATE._savedSession = saved;
  if (saved) {
    STATE.crossfade    = saved.crossfade    ?? 0;
    STATE.speedPercent = saved.speedPercent ?? 100;
    STATE.currentFormat = 'wav';
    if (saved.encoding) {
      STATE.encoding = saved.encoding;
    }

    if (saved.order && saved.order.wav) {
      const validOrder = saved.order.wav.filter(i => STATE.songs.wav[i] !== undefined);
      STATE.songs.wav.forEach((_,i) => { if (!validOrder.includes(i)) validOrder.push(i); });
      STATE.order.wav = validOrder;
    }
  }

  // Switch to main app
  document.getElementById('setup-panel').style.display = 'none';
  document.getElementById('main-app').style.display    = 'flex';
  document.getElementById('folder-switcher').style.display = '';

  buildUI(saved);
  initKnob();
  initCrossfade();

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
initEncodingSettings();
