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

/** Lazily created; declared before initRecentProjectsUI() so hideRecentPathPopover is safe at startup. */
let recentPathPopoverEl;

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

async function deleteRecentHandle(id) {
  const db = await getRecentProjectsDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(RECENT_STORE_NAME, 'readwrite');
    tx.objectStore(RECENT_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not delete stored directory handle'));
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

/** Full path when the host exposes it (e.g. some Electron/Tauri builds); plain Chromium usually omits it. */
function pathFromHandle(handle) {
  if (!handle) return undefined;
  if (typeof handle.path === 'string' && handle.path.length) return handle.path;
  if (typeof handle.nativePath === 'string' && handle.nativePath.length) return handle.nativePath;
  return undefined;
}

async function addRecentProject(handle) {
  if (!handle) return;
  const id = `project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await saveRecentHandle(id, handle);

  const meta = loadRecentProjectMeta();
  const prev = meta.find(entry => entry.name === handle.name);
  const current = meta.filter(entry => entry.name !== handle.name);
  const newPath = pathFromHandle(handle);
  const mergedPath =
    newPath ||
    (prev && typeof prev.path === 'string' && prev.path.length ? prev.path : undefined);
  current.unshift({ id, name: handle.name, path: mergedPath, updatedAt: Date.now() });
  saveRecentProjectMeta(current);
}

function initRecentProjectsUI() {
  initRecentPathPopoverListeners();
  renderRecentProjects();
  renderFolderSwitcher();
}

function getRecentPathPopover() {
  if (!recentPathPopoverEl) {
    recentPathPopoverEl = document.createElement('div');
    recentPathPopoverEl.id = 'recent-path-popover';
    recentPathPopoverEl.className = 'recent-path-popover';
    recentPathPopoverEl.setAttribute('role', 'tooltip');
    recentPathPopoverEl.setAttribute('hidden', '');
    document.body.appendChild(recentPathPopoverEl);
  }
  return recentPathPopoverEl;
}

function initRecentPathPopoverListeners() {
  const listEl = document.getElementById('recent-projects-list');
  if (!listEl || listEl.dataset.pathPopoverBound) return;
  listEl.dataset.pathPopoverBound = '1';
  listEl.addEventListener('scroll', () => hideRecentPathPopover(), { passive: true });
  window.addEventListener('resize', () => hideRecentPathPopover(), { passive: true });
}

function fillRecentPathPopover(el, item) {
  el.replaceChildren();
  const path = item.path && typeof item.path === 'string' ? item.path.trim() : '';
  if (path) {
    el.appendChild(document.createTextNode(path));
    return;
  }
  const label = document.createElement('div');
  label.className = 'recent-path-popover-label';
  label.textContent = 'Saved folder name';

  const value = document.createElement('div');
  value.className = 'recent-path-popover-value';
  value.textContent = item.name || '(unnamed folder)';

  el.appendChild(label);
  el.appendChild(value);

  if (typeof item.updatedAt === 'number' && !Number.isNaN(item.updatedAt)) {
    const meta = document.createElement('div');
    meta.className = 'recent-path-popover-meta';
    meta.textContent = `Last opened: ${new Date(item.updatedAt).toLocaleString()}`;
    el.appendChild(meta);
  }

  const note = document.createElement('div');
  note.className = 'recent-path-popover-note';
  note.textContent =
    'This browser does not expose the full filesystem path; only the folder name and history are stored.';
  el.appendChild(note);
}

function placeRecentPathPopover(btn, el) {
  el.removeAttribute('hidden');
  el.style.display = 'block';
  el.style.visibility = 'hidden';
  el.style.left = '-9999px';
  el.style.top = '0';
  void el.offsetWidth;
  const pr = el.getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  let left = br.left;
  let top = br.bottom + 6;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - 8 - pr.width;
  if (left < 8) left = 8;
  if (top + pr.height > window.innerHeight - 8) top = br.top - 6 - pr.height;
  if (top < 8) top = 8;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.visibility = 'visible';
}

function showRecentPathPopoverForItem(btn, item) {
  const el = getRecentPathPopover();
  fillRecentPathPopover(el, item);
  placeRecentPathPopover(btn, el);
  btn.setAttribute('aria-describedby', 'recent-path-popover');
}

function hideRecentPathPopover() {
  const el = recentPathPopoverEl;
  if (!el) return;
  el.setAttribute('hidden', '');
  el.style.display = '';
  el.style.visibility = '';
  el.style.left = '';
  el.style.top = '';
  document.querySelectorAll('[aria-describedby="recent-path-popover"]').forEach(n => {
    n.removeAttribute('aria-describedby');
  });
}

function bindRecentProjectPathPopover(row, btn, item) {
  const show = () => showRecentPathPopoverForItem(btn, item);
  const hide = () => {
    if (document.activeElement !== btn) hideRecentPathPopover();
  };
  row.addEventListener('mouseenter', show);
  row.addEventListener('mouseleave', hide);
  btn.addEventListener('focus', show);
  btn.addEventListener('blur', hide);
}

function openRecentRemoveConfirmModal(displayName) {
  return new Promise(resolve => {
    const overlay = document.getElementById('recent-remove-confirm-modal');
    const nameEl = document.getElementById('recent-remove-confirm-name');
    const btnCancel = document.getElementById('recent-remove-confirm-cancel');
    const btnRemove = document.getElementById('recent-remove-confirm-remove');
    if (!overlay || !nameEl || !btnCancel || !btnRemove) {
      resolve(false);
      return;
    }

    nameEl.textContent = displayName;

    function finish(ok) {
      overlay.classList.add('hidden');
      btnCancel.removeEventListener('click', onCancel);
      btnRemove.removeEventListener('click', onRemove);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(ok);
    }

    function onCancel() {
      finish(false);
    }
    function onRemove() {
      finish(true);
    }
    function onBackdrop(e) {
      if (e.target === overlay) finish(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    }

    btnCancel.addEventListener('click', onCancel);
    btnRemove.addEventListener('click', onRemove);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);

    overlay.classList.remove('hidden');
    btnCancel.focus();
  });
}

async function removeRecentProjectFromHistory(projectId, displayName) {
  hideRecentPathPopover();
  const confirmed = await openRecentRemoveConfirmModal(displayName);
  if (!confirmed) return;
  const list = loadRecentProjectMeta().filter(e => e.id !== projectId);
  saveRecentProjectMeta(list);
  try {
    await deleteRecentHandle(projectId);
  } catch (e) {
    console.warn('Could not remove stored directory handle:', e);
  }
  renderRecentProjects();
  renderFolderSwitcher();
}

function renderRecentProjects() {
  hideRecentPathPopover();
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
    const row = document.createElement('div');
    row.className = 'recent-project-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-project-btn';
    btn.textContent = item.name;
    btn.addEventListener('click', () => openRecentProject(item.id));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'brick-delete recent-project-delete';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove from recent projects';
    delBtn.setAttribute('aria-label', 'Remove from recent projects');
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      removeRecentProjectFromHistory(item.id, item.name);
    });

    row.appendChild(btn);
    row.appendChild(delBtn);
    bindRecentProjectPathPopover(row, btn, item);
    listEl.appendChild(row);
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
  hideRecentPathPopover();
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
  hideRecentPathPopover();
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
