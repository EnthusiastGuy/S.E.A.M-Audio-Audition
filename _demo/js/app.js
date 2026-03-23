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

/** Brave and some file:// contexts omit File System Access API; webkitdirectory still works. */
function pickFolderViaWebkitDirectoryInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    try {
      input.webkitdirectory = true;
    } catch (_) {}
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');

    let done = false;
    let armFocusTimer = null;
    let pollTimer = null;

    const finish = () => {
      if (armFocusTimer !== null) {
        clearTimeout(armFocusTimer);
        armFocusTimer = null;
      }
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      window.removeEventListener('focus', onWinFocus);
      if (input.parentNode) input.remove();
    };

    const fail = err => {
      if (done) return;
      done = true;
      finish();
      reject(err);
    };

    const ok = files => {
      if (done) return;
      done = true;
      finish();
      resolve(files);
    };

    function tryConsumeFiles() {
      if (done) return true;
      const files = Array.from(input.files || []);
      if (!files.length) return false;
      const rel0 = files[0].webkitRelativePath;
      if (typeof rel0 !== 'string' || !rel0.length) {
        fail(
          new Error(
            'Folder selection is not supported in this browser. Try Chrome or Edge, or open this page via http://localhost.'
          )
        );
        return true;
      }
      ok(files);
      return true;
    }

    input.addEventListener('change', () => {
      tryConsumeFiles();
    });

    input.addEventListener('cancel', () => {
      fail(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    });

    function onWinFocus() {
      window.removeEventListener('focus', onWinFocus);
      let attempts = 0;
      const maxAttempts = 80;
      const poll = () => {
        if (done) return;
        if (tryConsumeFiles()) return;
        attempts++;
        if (attempts >= maxAttempts) {
          fail(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          return;
        }
        pollTimer = setTimeout(poll, 50);
      };
      setTimeout(poll, 0);
    }

    document.body.appendChild(input);
    input.click();

    armFocusTimer = setTimeout(() => {
      armFocusTimer = null;
      window.addEventListener('focus', onWinFocus);
    }, 400);
  });
}

function newVirtualDirNode(displayName) {
  return { _name: displayName, _dirMap: new Map(), _fileMap: new Map(), _final: false };
}

/** Windows + webkitdirectory often uses WAV/Wav; app expects wav like Chrome's native picker (case-insensitive). */
function findCaseInsensitiveDirKey(dirMap, name) {
  const nl = name.toLowerCase();
  for (const k of dirMap.keys()) {
    if (k.toLowerCase() === nl) return k;
  }
  return null;
}

function getOrCreateVirtualSubdir(parent, seg) {
  const existingKey = findCaseInsensitiveDirKey(parent._dirMap, seg);
  if (existingKey !== null) return parent._dirMap.get(existingKey);
  const child = newVirtualDirNode(seg);
  parent._dirMap.set(seg, child);
  return child;
}

function normalizeWebkitRelativeSegments(rel) {
  const raw = (rel || '').replace(/\\/g, '/').split('/');
  const out = [];
  for (const p of raw) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      out.pop();
      continue;
    }
    out.push(p);
  }
  return out;
}

/** If the browser includes parents before wav/, keep from the format folder down (pack-relative). */
function stripLeadingPathUntilWavSegment(segments) {
  const idx = segments.findIndex(s => s.toLowerCase() === 'wav');
  if (idx < 0) return segments;
  return segments.slice(idx);
}

/** True when this level looks like wav/: song subfolders each containing .wav files (no nested wav/ name). */
function virtualTreeLooksLikeWavFolder(raw) {
  if (!raw || !raw._dirMap || raw._dirMap.size === 0) return false;
  if (findCaseInsensitiveDirKey(raw._dirMap, 'wav') !== null) return false;
  for (const dir of raw._dirMap.values()) {
    if (!dir._fileMap || dir._fileMap.size === 0) continue;
    const hasWav = [...dir._fileMap.keys()].some(f => f.toLowerCase().endsWith('.wav'));
    if (hasWav) return true;
  }
  return false;
}

/**
 * Brave/file:// sometimes prefixes an extra folder in webkitRelativePath, or the user picks an inner folder.
 * Walk single-directory chains until we find a wav child or a layout that already is wav/ contents.
 */
function resolveVirtualPackRoot(rawRoot) {
  let n = rawRoot;
  const maxDepth = 32;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (findCaseInsensitiveDirKey(n._dirMap, 'wav') !== null) return n;
    if (virtualTreeLooksLikeWavFolder(n)) return n;
    if (n._fileMap.size > 0) return rawRoot;
    if (n._dirMap.size !== 1) return rawRoot;
    n = n._dirMap.values().next().value;
  }
  return rawRoot;
}

/**
 * Heuristic for when the user selects the pack root directly:
 * we accept it as a "WAV format root" if at least one immediate subdirectory
 * contains at least one `.wav` file directly inside it.
 */
async function handleLooksLikeWavSongsRoot(rootHandle) {
  try {
    let checkedDirs = 0;
    for await (const [, dirHandle] of rootHandle.entries()) {
      if (!dirHandle || dirHandle.kind !== 'directory') continue;
      checkedDirs++;

      let foundWav = false;
      for await (const [fname, childHandle] of dirHandle.entries()) {
        if (!childHandle || childHandle.kind !== 'file') continue;
        const dot = fname.lastIndexOf('.');
        const ext = dot >= 0 ? fname.slice(dot + 1).toLowerCase() : '';
        if (ext === 'wav') {
          foundWav = true;
          break;
        }
      }

      if (foundWav) return true;
      if (checkedDirs >= 12) return false; // Cap work for big trees.
    }
  } catch (_) {
    // If the browser rejects some entries, just fall back to "not a songs root".
  }
  return false;
}

function createVirtualFileHandle(name, file) {
  return {
    kind: 'file',
    name,
    getFile() {
      return Promise.resolve(file);
    },
  };
}

function finalizeVirtualDirNode(node) {
  if (node._final) return node;
  node._final = true;
  node.kind = 'directory';
  node.name = node._name;

  node.getDirectoryHandle = async function (name, opts = {}) {
    const key = findCaseInsensitiveDirKey(node._dirMap, name);
    if (key === null) {
      throw new DOMException(
        'A requested file or directory could not be found at the time an operation was processed.',
        'NotFoundError'
      );
    }
    return finalizeVirtualDirNode(node._dirMap.get(key));
  };

  node.entries = async function* () {
    const keys = new Set([...node._dirMap.keys(), ...node._fileMap.keys()]);
    for (const key of [...keys].sort()) {
      if (node._dirMap.has(key)) {
        yield [key, finalizeVirtualDirNode(node._dirMap.get(key))];
      } else {
        yield [key, node._fileMap.get(key)];
      }
    }
  };

  return node;
}

function folderLabelFromWebkitFiles(files) {
  const paths = files
    .map(f => (f.webkitRelativePath || '').replace(/\\/g, '/'))
    .filter(Boolean)
    .sort();
  let h = 0;
  for (const p of paths) {
    for (let i = 0; i < p.length; i++) h = (Math.imul(31, h) + p.charCodeAt(i)) >>> 0;
  }
  const hex = h.toString(16).padStart(8, '0').slice(0, 8);
  return `Sample pack ${hex}`;
}

/** Mimics FileSystemDirectoryHandle enough for discoverSongs / scanFormat / getFile(). Not serializable to IndexedDB. */
function buildVirtualRootFromWebkitFiles(files, displayName) {
  const root = newVirtualDirNode(displayName);
  for (const file of files) {
    let segments = normalizeWebkitRelativeSegments(file.webkitRelativePath || file.name || '');
    segments = stripLeadingPathUntilWavSegment(segments);
    if (segments.length < 2) continue;

    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      node = getOrCreateVirtualSubdir(node, segments[i]);
    }
    const fname = segments[segments.length - 1];
    node._fileMap.set(fname, createVirtualFileHandle(fname, file));
  }
  const effective = resolveVirtualPackRoot(root);
  const sealed = finalizeVirtualDirNode(effective);
  sealed.__seamWebkitFallback = true;
  sealed.__seamVirtualRootIsWav =
    findCaseInsensitiveDirKey(effective._dirMap, 'wav') === null && virtualTreeLooksLikeWavFolder(effective);
  return sealed;
}

async function selectFolder() {
  hideRecentPathPopover();
  const statusEl = document.getElementById('select-status');
  try {
    let rootHandle = null;
    let saveToRecent = false;

    if (typeof window.showDirectoryPicker === 'function') {
      try {
        rootHandle = await window.showDirectoryPicker({ mode: 'read' });
        saveToRecent = true;
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('showDirectoryPicker failed, using folder upload fallback:', e);
      }
    }

    if (!rootHandle) {
      statusEl.textContent = 'Opening folder picker…';
      const files = await pickFolderViaWebkitDirectoryInput();
      rootHandle = buildVirtualRootFromWebkitFiles(files, folderLabelFromWebkitFiles(files));
    }

    STATE.rootDir = rootHandle;
    if (saveToRecent) {
      await addRecentProject(rootHandle);
    }
    renderRecentProjects();
    renderFolderSwitcher();
    statusEl.textContent = `Loading: ${rootHandle.name} …`;
    await discoverSongs(rootHandle);
  } catch (e) {
    if (e.name === 'AbortError') {
      statusEl.textContent = '';
      return;
    }
    statusEl.textContent = 'Could not open folder: ' + e.message;
  }
}

const APP_LOADING_QUIPS = [
  'Counting waveforms like sheep. They keep beat.',
  'Teaching the browser to tap in 4/4.',
  'Inspecting every clip for groove violations.',
  'Audio elves are currently labeling transients.',
  'Calibrating dramatic pauses...',
  'Untangling cables that only exist in software.',
  'Checking if silence is truly intentional.',
  'Convincing MP3 bits to cooperate.',
  'Stretching before lifting heavy WAVs.',
  'Polishing kick drums to a mirror finish.',
  'Negotiating peace between CPU and fan.',
  'Measuring reverb tails with tiny rulers.',
  'Finding the loud part and making it louder in spirit.',
  'Compressing expectations, not your creativity.',
  'Loading audio. Please do not feed the DAW.',
  'Checking browser patience levels.',
  'Rendering vibes at maximum fidelity.',
  'Rehearsing the loading screen solo.',
  'Reticulating splines... but for audio.',
  'Turning coffee into progress updates.',
  'Synchronizing imaginary metronomes.',
  'Verifying that bass still causes face stank.',
  'Unwrapping fresh buffers.',
  'Listening for hidden kazoo tracks.',
  'Counting cuts so you do not have to.',
  'Aligning waveforms with moon phases.',
  'Defragmenting funk.',
  'Giving each sample a tiny pep talk.',
  'Making sure every snare arrives on time.',
  'Reducing awkward silence since 2026.',
  'Sending browser a motivational speech.',
  'Applying anti-chaos coating to timelines.',
  'Testing if this loading message is funny enough.',
  'Pretending this is instant while working hard.',
  'Hydrating the waveform hamsters.',
  'Decoding audio and life choices.',
  'Requesting one more millisecond from reality.',
  'Summoning progress from the event loop.',
  'Making waiting look intentional.',
  'Assembling your clips with dramatic flair.',
  'Avoiding eye contact with unoptimized code paths.',
  'Making sure your cuts stay sharp.',
  'Sanding rough edges off large folders.',
  'Converting impatience into throughput.',
  'Mildly judging corrupted filenames.',
  'Swapping panic for progress.',
  'Whispering sweet nothings to Web Audio.',
  'Running a background montage sequence.',
  'Speedrunning the boring part.',
  'Keeping it smooth while files act huge.',
  'Double-checking that wait means wait.',
  'Loading complete soon-ish. Probably. Maybe.',
  'No bytes were harmed during this loading.',
  'Bargaining with entropy.',
  'Trying not to wake the crash dialog.',
  'Good things come to those who buffer.',
];

let appLoadingQuipTimer = null;
let appLoadingQuipIndex = 0;
let appLoadingQuipOrder = [];

function shuffleArray(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function setAppLoadingSubtitle(message) {
  const sub = document.getElementById('app-loading-subtitle');
  if (sub) sub.textContent = message || '';
}

function rotateAppLoadingSubtitle() {
  if (!appLoadingQuipOrder.length) return;
  if (appLoadingQuipIndex >= appLoadingQuipOrder.length) {
    appLoadingQuipOrder = shuffleArray(APP_LOADING_QUIPS);
    appLoadingQuipIndex = 0;
  }
  setAppLoadingSubtitle(appLoadingQuipOrder[appLoadingQuipIndex]);
  appLoadingQuipIndex += 1;
}

function startAppLoadingQuips() {
  if (appLoadingQuipTimer != null) return;
  if (!appLoadingQuipOrder.length) {
    appLoadingQuipOrder = shuffleArray(APP_LOADING_QUIPS);
    appLoadingQuipIndex = 0;
  }
  rotateAppLoadingSubtitle();
  appLoadingQuipTimer = window.setInterval(rotateAppLoadingSubtitle, 2600);
}

function stopAppLoadingQuips() {
  if (appLoadingQuipTimer != null) {
    clearInterval(appLoadingQuipTimer);
    appLoadingQuipTimer = null;
  }
}

let headerQuipDismissTimer = null;
let headerQuipFadeTimer = null;

function dismissHeaderQuip() {
  if (headerQuipDismissTimer != null) {
    clearTimeout(headerQuipDismissTimer);
    headerQuipDismissTimer = null;
  }
  if (headerQuipFadeTimer != null) {
    clearTimeout(headerQuipFadeTimer);
    headerQuipFadeTimer = null;
  }
  const el = document.getElementById('header-quip-banner');
  const txt = document.getElementById('header-quip-text');
  if (el) {
    el.classList.remove('header-quip-banner--visible');
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
  }
  if (txt) txt.textContent = '';
}

function showHeaderQuip(text) {
  const el = document.getElementById('header-quip-banner');
  const txt = document.getElementById('header-quip-text');
  if (!el || !txt || !text) return;
  dismissHeaderQuip();
  txt.textContent = text;
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
  void el.offsetWidth;
  el.classList.add('header-quip-banner--visible');
  const holdMs =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 4500
      : 8200;
  headerQuipDismissTimer = window.setTimeout(() => {
    headerQuipDismissTimer = null;
    el.classList.remove('header-quip-banner--visible');
    headerQuipFadeTimer = window.setTimeout(() => {
      headerQuipFadeTimer = null;
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
      txt.textContent = '';
    }, 420);
  }, holdMs);
}

function resetAppLoadingOverlayDom() {
  const overlay = document.getElementById('app-loading-overlay');
  const label = document.getElementById('app-loading-label');
  const sub = document.getElementById('app-loading-subtitle');
  if (overlay) {
    overlay.style.removeProperty('opacity');
  }
  if (label) label.textContent = 'Loading…';
  if (sub) sub.textContent = 'Warming up the audio goblins...';
}

function finishAppLoadingHide() {
  const overlay = document.getElementById('app-loading-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('app-loading-active');
  resetAppLoadingOverlayDom();
}

function showAppLoading(message) {
  const overlay = document.getElementById('app-loading-overlay');
  const label = document.getElementById('app-loading-label');
  if (!overlay) return;
  dismissHeaderQuip();
  resetAppLoadingOverlayDom();
  if (label) label.textContent = message || 'Loading…';
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('app-loading-active');
  startAppLoadingQuips();
}

function setAppLoadingLabel(message) {
  const label = document.getElementById('app-loading-label');
  if (label) label.textContent = message || 'Loading…';
}

function hideAppLoading() {
  const overlay = document.getElementById('app-loading-overlay');
  if (!overlay) return;
  stopAppLoadingQuips();
  const sub = document.getElementById('app-loading-subtitle');
  const quipText = sub && sub.textContent ? sub.textContent.trim() : '';
  if (overlay.classList.contains('hidden')) {
    document.body.classList.remove('app-loading-active');
    return;
  }
  finishAppLoadingHide();
  if (quipText) {
    showHeaderQuip(quipText);
  }
}

async function discoverSongs(rootHandle) {
  const statusEl = document.getElementById('select-status');
  const fmt = 'wav';
  let fmtHandle = null;
  try {
    fmtHandle = await rootHandle.getDirectoryHandle(fmt, { create: false });
  } catch (e) {
    // ignore; we'll fall back below
  }

  if (!fmtHandle) {
    const looksLikeSongsRoot = rootHandle.__seamVirtualRootIsWav || (await handleLooksLikeWavSongsRoot(rootHandle));
    if (looksLikeSongsRoot) {
      // Either the browser didn't expose a `wav/` folder or the user selected the pack root.
      fmtHandle = rootHandle;
    }
  }

  if (!fmtHandle) {
    STATE.songs[fmt] = [];
    STATE.order[fmt] = [];
    statusEl.textContent = rootHandle.__seamWebkitFallback
      ? 'Could not find song folders. Expected a `wav/` directory, or song subfolders with `.wav` files inside the selected folder.'
      : 'Could not find song folders. Expected a `wav/` directory, or song subfolders with `.wav` files inside the selected folder.';
    return;
  }

  const packLabel = rootHandle.name || 'library';
  const scanningMsg = fmtHandle === rootHandle ? 'Scanning WAV song folders …' : `Scanning ${fmt}/ …`;
  showAppLoading(`${scanningMsg} (${packLabel})`);
  statusEl.textContent = scanningMsg;
  await new Promise(r => requestAnimationFrame(r));

  try {
    const songs = await scanFormat(fmtHandle);
    STATE.songs[fmt] = songs;
    STATE.order[fmt] = songs.map((_,i) => i);

    const jobs = [];
    for (const song of STATE.songs.wav) {
      if (song.mainHandle) {
        jobs.push(() =>
          getFileDuration(song.mainHandle).then(d => {
            song.duration = d;
            song._mainFileDur = d;
          })
        );
      } else if (song.parts.length > 0) {
        for (const p of song.parts) {
          jobs.push(() =>
            getFileDuration(p.handle).then(d => {
              p._dur = d;
            })
          );
        }
      }
    }
    const totalJobs = jobs.length;
    let doneJobs = 0;
    const setDurationProgress = () => {
      if (totalJobs <= 0) {
        statusEl.textContent = 'No audio files found to measure.';
        setAppLoadingLabel('No audio files found to measure.');
        return;
      }
      const msg = `Loading durations... ${doneJobs}/${totalJobs}`;
      statusEl.textContent = msg;
      setAppLoadingLabel(msg);
    };
    setDurationProgress();

    await Promise.all(
      jobs.map(runJob =>
        runJob().finally(() => {
          doneJobs += 1;
          setDurationProgress();
        })
      )
    );

    for (const song of STATE.songs.wav) {
      if (!song.mainHandle && song.parts.length > 0) {
        song.duration = song.parts.reduce((acc, p) => acc + (p._dur || 0), 0);
      }
    }

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
      STATE.waveformMaxPartDurationSec = saved.waveformMaxPartDurationSec ?? 20;
      const sp = saved.seamPreviewMs;
      const spn = Number(sp);
      STATE.seamPreviewMs =
        sp === undefined || sp === null || !Number.isFinite(spn)
          ? 2000
          : Math.min(60000, Math.max(50, Math.round(spn)));

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

    STATE.order[fmt].forEach(songIdx => {
      ensurePlayerState(fmt, songIdx);
      syncSongCompositeDuration(fmt, songIdx);
    });

    // Restore open part sheets
    if (saved && saved.openSheets) {
      for (const sheetKey of saved.openSheets) {
        const [fmtKey, idxStr] = sheetKey.split('_');
        const songIdx = parseInt(idxStr, 10);
        if (STATE.songs[fmtKey] && STATE.songs[fmtKey][songIdx]) {
          togglePartSheet(fmtKey, songIdx);
        }
      }
    }

    statusEl.textContent = '';
  } finally {
    hideAppLoading();
  }
}

// ─── REMOTE NEWS / PROMOS ───────────────────────────────────
const SEAM_NEWS_FEED_URL =
  'https://raw.githubusercontent.com/EnthusiastGuy/S.E.A.M-News-Feed/main/feed.json';
const SEAM_LAST_READ_VERSION_KEY = 'seam_last_read_version';

let seamNewsFeed = null;
let seamNewsLatestVersion = null;
let seamNewsFetchPromise = null;
let seamNewsRenderedVersion = null;

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Silent: localStorage may be blocked (private mode, etc.)
  }
}

function coerceVersion(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isLatestVersionNewer(latestVersion, storedVersion) {
  const ln = coerceVersion(latestVersion);
  const sn = coerceVersion(storedVersion);
  if (ln != null && sn != null) return ln > sn;
  if (latestVersion == null) return false;
  if (storedVersion == null) return true;
  return String(latestVersion) > String(storedVersion);
}

function truncateText(str, maxLen) {
  const s = typeof str === 'string' ? str : '';
  if (s.length <= maxLen) return s;
  const cut = Math.max(0, maxLen - 3);
  return s.slice(0, cut) + '...';
}

function formatTimestamp(ts) {
  if (ts == null) return '';
  const num = Number(ts);
  if (Number.isFinite(num)) {
    // Heuristic: if the value looks like seconds, convert to ms.
    const ms = num > 0 && num < 1e12 ? num * 1000 : num;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  const d = new Date(ts);
  if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  return String(ts);
}

function renderMoreArticle(article) {
  const el = document.createElement('article');
  el.className = 'more-article';

  const title = truncateText(article?.title || '', 256);
  const titleEl = document.createElement('div');
  titleEl.className = 'more-article-title';
  titleEl.textContent = title || '(Untitled)';
  el.appendChild(titleEl);

  const dateEl = document.createElement('div');
  dateEl.className = 'more-article-date';
  dateEl.textContent = formatTimestamp(article?.timestamp);
  if (dateEl.textContent) el.appendChild(dateEl);

  if (typeof article?.image_url === 'string' && article.image_url.trim().length) {
    const img = document.createElement('img');
    // Cache-bust so updated feeds don't leave the browser showing old bitmaps.
    img.src = appendUrlParam(article.image_url, 'seam_version', seamNewsLatestVersion);
    img.alt = title || 'Promo image';
    el.appendChild(img);
  }

  const bodyEl = document.createElement('div');
  bodyEl.className = 'more-article-body';
  const bodyHtml = typeof article?.body === 'string' ? article.body : '';
  bodyEl.appendChild(renderExpandableBody(bodyHtml));
  el.appendChild(bodyEl);

  return el;
}

function renderExpandableBody(bodyHtml) {
  const container = document.createElement('div');

  if (!bodyHtml || typeof bodyHtml !== 'string') {
    container.innerHTML = '';
    return container;
  }

  const wrapper = document.createElement('div');
  wrapper.innerHTML = bodyHtml;
  const paragraphs = wrapper.querySelectorAll('p');

  // "Long" = more than one paragraph. Show first paragraph only, with ...more / ...less toggle.
  if (!paragraphs || paragraphs.length <= 1) {
    container.innerHTML = bodyHtml;
    return container;
  }

  const previewHtml = paragraphs[0].outerHTML;
  let expanded = false;

  function makeToggleLink(text) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = text;
    a.className = 'more-body-toggle';
    return a;
  }

  function renderCollapsed() {
    expanded = false;
    container.innerHTML = previewHtml;

    const spacer = document.createElement('div');
    spacer.style.height = '8px';
    container.appendChild(spacer);

    const more = makeToggleLink('...more');
    more.addEventListener('click', (e) => {
      e.preventDefault();
      renderExpanded();
    });
    container.appendChild(more);
  }

  function renderExpanded() {
    expanded = true;
    container.innerHTML = bodyHtml;

    const lessWrap = document.createElement('div');
    lessWrap.style.marginTop = '10px';

    const less = makeToggleLink('...less');
    less.addEventListener('click', (e) => {
      e.preventDefault();
      renderCollapsed();
    });
    lessWrap.appendChild(less);
    container.appendChild(lessWrap);
  }

  // Start collapsed.
  renderCollapsed();
  return container;
}

function appendUrlParam(url, key, value) {
  if (typeof url !== 'string' || !url.trim()) return url;
  if (value == null) return url;
  const hasQuery = url.includes('?');
  const sep = hasQuery ? '&' : '?';
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
}

function getSeamNewsFeedUrlWithCacheBuster() {
  // Cache-bust the JSON request to avoid browsers returning a stale GitHub raw response.
  return appendUrlParam(SEAM_NEWS_FEED_URL, 'seam_cache_bust', Date.now().toString(36));
}

function renderMoreFeed(feed) {
  const articles = Array.isArray(feed?.articles) ? feed.articles : [];
  const news = articles.filter(a => a && a.type === 'news');
  const pack = articles.filter(a => a && a.type === 'pack');
  const archive = articles.filter(a => a && a.type !== 'news' && a.type !== 'pack');

  const newsListEl = document.getElementById('more-news-list');
  const archiveListEl = document.getElementById('more-archive-list');
  const packListEl = document.getElementById('more-pack-list');
  if (!newsListEl || !archiveListEl || !packListEl) return;

  newsListEl.replaceChildren();
  if (news.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No news right now.';
    newsListEl.appendChild(p);
  } else {
    for (const a of news) newsListEl.appendChild(renderMoreArticle(a));
  }

  archiveListEl.replaceChildren();
  if (archive.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Nothing in the archive at the moment.';
    archiveListEl.appendChild(p);
  } else {
    for (const a of archive) archiveListEl.appendChild(renderMoreArticle(a));
  }

  packListEl.replaceChildren();
  if (pack.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No pack articles right now.';
    packListEl.appendChild(p);
  } else {
    for (const a of pack) packListEl.appendChild(renderMoreArticle(a));
  }
}

function updateMoreBadge(unreadNewsCount) {
  const badgeEl = document.getElementById('more-badge');
  if (!badgeEl) return;
  if (unreadNewsCount > 0) {
    badgeEl.textContent = String(unreadNewsCount);
    badgeEl.classList.remove('hidden');
  } else {
    badgeEl.textContent = '0';
    badgeEl.classList.add('hidden');
  }
}

function hideMoreBadge() {
  updateMoreBadge(0);
}

function showMoreLoading() {
  const loadingEl = document.getElementById('more-loading');
  const contentEl = document.getElementById('more-content');
  if (!loadingEl || !contentEl) return;
  loadingEl.classList.remove('hidden');
  contentEl.classList.add('hidden');
}

function showMoreContent() {
  const loadingEl = document.getElementById('more-loading');
  const contentEl = document.getElementById('more-content');
  if (!loadingEl || !contentEl) return;
  loadingEl.classList.add('hidden');
  contentEl.classList.remove('hidden');
}

function hideMoreButton() {
  const btnMore = document.getElementById('btn-more');
  const badgeEl = document.getElementById('more-badge');
  const modal = document.getElementById('more-modal');
  if (btnMore) btnMore.style.display = 'none';
  if (badgeEl) badgeEl.classList.add('hidden');
  if (modal) modal.classList.add('hidden');
}

async function fetchSeamNewsFeed() {
  const url = getSeamNewsFeedUrlWithCacheBuster();
  // Keep this a "simple" GET (no custom headers) to avoid CORS preflight.
  // The unique query param is what forces the updated JSON.
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  return await res.json();
}

function initMoreRemoteNewsPromo() {
  const btnMore = document.getElementById('btn-more');
  const moreModal = document.getElementById('more-modal');
  const moreClose = document.getElementById('more-close');
  if (!btnMore || !moreModal || !moreClose) return;

  // Ensure hidden by default; we toggle classes in JS.
  moreModal.classList.add('hidden');
  showMoreLoading();
  hideMoreBadge();

  btnMore.addEventListener('click', async () => {
    // If fetch is still in-flight, show the loading state inside the modal.
    moreModal.classList.remove('hidden');
    showMoreLoading();
    hideMoreBadge();

    try {
      // Always re-fetch when opening so a bumped `latest_version` discards old content.
      const feed = await fetchSeamNewsFeed();
      seamNewsFeed = feed;

      seamNewsLatestVersion = feed?.latest_version ?? null;
      if (seamNewsLatestVersion != null) {
        safeLocalStorageSet(SEAM_LAST_READ_VERSION_KEY, seamNewsLatestVersion);
      }
      hideMoreBadge();

      // If this is a new version, discard previous content and render fresh.
      if (seamNewsLatestVersion !== seamNewsRenderedVersion) {
        renderMoreFeed(feed);
        seamNewsRenderedVersion = seamNewsLatestVersion;
      } else {
        // Same version as last render: still show it (in case the modal content was cleared).
        renderMoreFeed(feed);
      }
      showMoreContent();
    } catch {
      // Fail silently: hide the whole feature if the remote feed can't be loaded.
      hideMoreButton();
    }
  });

  moreClose.addEventListener('click', () => {
    moreModal.classList.add('hidden');
  });

  moreModal.addEventListener('click', (e) => {
    if (e.target === moreModal) moreModal.classList.add('hidden');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !moreModal.classList.contains('hidden')) {
      moreModal.classList.add('hidden');
    }
  });

  // Start the fetch immediately on app init.
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    hideMoreButton();
    return;
  }
  seamNewsFetchPromise = fetchSeamNewsFeed();
  seamNewsFetchPromise
    .then((feed) => {
      seamNewsFeed = feed;
      seamNewsLatestVersion = feed?.latest_version ?? null;

      const storedLastRead = safeLocalStorageGet(SEAM_LAST_READ_VERSION_KEY);
      if (seamNewsLatestVersion == null) {
        hideMoreBadge();
        return;
      }

      if (isLatestVersionNewer(seamNewsLatestVersion, storedLastRead)) {
        // Feed has changed since last read; the next modal open should discard old content.
        seamNewsRenderedVersion = null;
        const articles = Array.isArray(feed?.articles) ? feed.articles : [];
        const unreadNewsCount = articles.filter(a => a && a.type === 'news').length;
        updateMoreBadge(unreadNewsCount);
      } else {
        hideMoreBadge();
      }
    })
    .catch(() => {
      // Silent failure: app continues normally without More.
      hideMoreButton();
    });
}

// ─── INIT ────────────────────────────────────────────────────
initHelp();
initEncodingSettings();
initMoreRemoteNewsPromo();
