/* =============================================================
   S.E.A.M Audio Audition — UI Builder: Tabs, Playlist & Totals
   ============================================================= */

// ─── BUILD UI ────────────────────────────────────────────────
function buildUI(savedSession) {
  const content = document.getElementById('tabs-content');
  content.innerHTML = '';
  buildPlaylist('wav', content);
  updateTotals();
}

function buildPlaylist(fmt, container) {
  const songs = STATE.songs[fmt];
  const order = STATE.order[fmt];

  const header = document.createElement('div');
  header.className = 'playlist-container';
  container.appendChild(header);

  const hdr = document.createElement('div');
  hdr.className = 'playlist-header';
  hdr.innerHTML = `<div>Nr</div><div>Name</div><div style="text-align:center">Duration</div><div style="text-align:center">Parts</div><div style="text-align:right">Action</div>`;
  header.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'playlist-body';
  body.id = `playlist-body-${fmt}`;
  header.appendChild(body);

  renderPlaylistRows(fmt);

  const totalsDiv = document.createElement('div');
  totalsDiv.className = 'playlist-totals';
  totalsDiv.id = `totals-${fmt}`;
  container.appendChild(totalsDiv);
}

function renderPlaylistRows(fmt) {
  const body  = document.getElementById(`playlist-body-${fmt}`);
  if (!body) return;
  body.innerHTML = '';

  const songs = STATE.songs[fmt];
  const order = STATE.order[fmt];

  order.forEach((songIdx, displayIdx) => {
    const song = songs[songIdx];
    if (!song) return;
    const row = buildSongRow(fmt, songIdx, displayIdx + 1);
    body.appendChild(row);
  });

  initDragReorder(fmt);
  updateTotals(fmt);
}

function buildSongRow(fmt, songIdx, nr) {
  const song = STATE.songs[fmt][songIdx];
  const key  = `${fmt}_${songIdx}`;

  const row = document.createElement('div');
  row.className = 'song-row';
  row.draggable = true;
  row.dataset.fmt = fmt;
  row.dataset.idx = songIdx;
  row.dataset.key = key;

  const main = document.createElement('div');
  main.className = 'song-row-main';
  main.title = 'Click to view/edit parts';
  main.addEventListener('click', (e) => {
    // Keep transport/action controls from toggling the parts panel.
    if (e.target.closest('.col-action')) return;
    togglePartSheet(fmt, songIdx);
  });

  // Nr
  const colNr = document.createElement('div');
  colNr.className = 'col-nr';
  colNr.textContent = nr;
  main.appendChild(colNr);

  // Name
  const colName = document.createElement('div');
  colName.className = 'col-name';
  colName.textContent = song.name;
  main.appendChild(colName);

  // Duration
  const colDur = document.createElement('div');
  colDur.className = 'col-dur';
  colDur.id = `dur-${key}`;
  if (song.duration > 0) {
    colDur.innerHTML = fmtTimeHTML(song.duration);
  } else {
    colDur.textContent = '—';
  }
  main.appendChild(colDur);

  // Parts badge
  const colParts = document.createElement('div');
  colParts.className = 'col-parts';
  const badge = document.createElement('span');
  badge.className = 'parts-badge';
  badge.textContent = song.parts.length;
  badge.title = 'Click row to view/edit parts';
  colParts.appendChild(badge);
  main.appendChild(colParts);

  // Action
  const colAction = document.createElement('div');
  colAction.className = 'col-action';
  colAction.id = `action-${key}`;
  colAction.appendChild(makePlayButton(fmt, songIdx));
  const dlCtl = makeDownloadControl(fmt, songIdx);
  if (dlCtl) colAction.appendChild(dlCtl);
  const addAll = makeAddAllTimelineButton(fmt, songIdx);
  if (addAll) colAction.appendChild(addAll);
  main.appendChild(colAction);

  row.appendChild(main);

  // Player area (parts + timeline; visibility from row toggle only)
  const playerArea = document.createElement('div');
  playerArea.className = 'song-player-area';
  playerArea.id = `player-area-${key}`;
  row.appendChild(playerArea);

  return row;
}

function makePlayButton(fmt, songIdx) {
  const btn = document.createElement('button');
  btn.className = 't-btn play';
  btn.title = 'Play';
  btn.innerHTML = '&#9654;';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    startPlaying(fmt, songIdx);
  });
  return btn;
}

let activeDownloadDropdown = null;

function closeActiveDownloadDropdown() {
  if (!activeDownloadDropdown) return;
  activeDownloadDropdown.classList.add('hidden');
  activeDownloadDropdown = null;
}

function makeDownloadControl(fmt, songIdx) {
  const song = STATE.songs[fmt][songIdx];
  const key = `${fmt}_${songIdx}`;
  const ps = ensurePlayerState(fmt, songIdx);
  // Show stitched-composition export whenever a timeline can be built,
  // even if the optional full-song file is missing.
  const hasExportableSource = !!song && (!!song.mainHandle || (Array.isArray(song.parts) && song.parts.length > 0));
  if (!hasExportableSource || !ps) return null;

  const wrap = document.createElement('div');
  wrap.className = 'download-split';

  const mainBtn = document.createElement('button');
  mainBtn.className = 't-btn dl-main';
  mainBtn.title = 'Download stitched composition';
  const fmtLabel = (ps.downloadFormat || 'wav').toUpperCase();
  mainBtn.innerHTML = `&#128229; <span class="dl-fmt">${fmtLabel}</span>`;
  mainBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadCompositionPreview(fmt, songIdx, ps.downloadFormat || 'wav');
  });
  wrap.appendChild(mainBtn);

  const arrowBtn = document.createElement('button');
  arrowBtn.className = 't-btn dl-arrow';
  arrowBtn.title = 'Select download format';
  arrowBtn.innerHTML = '&#9662;';
  wrap.appendChild(arrowBtn);

  const dd = document.createElement('div');
  dd.className = 'download-format-dropdown hidden';
  ['wav', 'mp3', 'ogg'].forEach((fmtOpt) => {
    const opt = document.createElement('button');
    opt.className = 'download-format-option';
    opt.textContent = fmtOpt.toUpperCase();
    if ((ps.downloadFormat || 'wav') === fmtOpt) opt.classList.add('selected');
    opt.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ps.downloadFormat = fmtOpt;
      const lbl = mainBtn.querySelector('.dl-fmt');
      if (lbl) lbl.textContent = fmtOpt.toUpperCase();
      dd.querySelectorAll('.download-format-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      saveSession();
      closeActiveDownloadDropdown();
    });
    dd.appendChild(opt);
  });
  wrap.appendChild(dd);

  arrowBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dd.classList.contains('hidden');
    closeActiveDownloadDropdown();
    if (willOpen) {
      dd.classList.remove('hidden');
      activeDownloadDropdown = dd;
      setTimeout(() => {
        document.addEventListener('click', closeActiveDownloadDropdown, { once: true });
      }, 0);
    }
  });

  return wrap;
}

function makeAddAllTimelineButton(fmt, songIdx) {
  const song = STATE.songs[fmt][songIdx];
  if (!song || !song.parts.length) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 't-btn btn-sm timeline-place-btn timeline-place-btn--all';
  btn.title = 'Replace timeline with all parts in order (1 … n)';
  btn.setAttribute('aria-label', 'Replace timeline with all parts in order');
  btn.innerHTML =
    '<svg class="timeline-btn-svg timeline-btn-svg--all" viewBox="0 0 26 20" aria-hidden="true"><rect x="1" y="6" width="2.5" height="10" rx="0.5" fill="currentColor"/><rect x="4.5" y="4" width="2.5" height="12" rx="0.5" fill="currentColor"/><rect x="8" y="6.5" width="2.5" height="9.5" rx="0.5" fill="currentColor"/><rect x="15.5" y="5.5" width="2.5" height="10.5" rx="0.5" fill="currentColor"/><rect x="19" y="3.5" width="2.5" height="12.5" rx="0.5" fill="currentColor"/><rect x="22.5" y="6" width="2.5" height="10" rx="0.5" fill="currentColor"/><path d="M10 18h6l-3 3z" fill="currentColor"/></svg>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    replaceTimelineWithAllPartsOrdered(fmt, songIdx);
  });
  return btn;
}

function appendTransportButtons(container, fmt, songIdx, state) {
  if (state === 'playing') {
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 't-btn pause';
    pauseBtn.title = 'Pause';
    pauseBtn.innerHTML = '&#9646;&#9646;';
    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pausePlaying(fmt, songIdx);
    });

    const stopBtn = document.createElement('button');
    stopBtn.className = 't-btn stop';
    stopBtn.title = 'Stop';
    stopBtn.innerHTML = '&#9632;';
    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopPlaying(fmt, songIdx);
    });

    const dot = document.createElement('span');
    dot.className = 'status-dot';

    container.appendChild(pauseBtn);
    container.appendChild(stopBtn);
    container.appendChild(dot);
  } else if (state === 'paused') {
    const playBtn = document.createElement('button');
    playBtn.className = 't-btn play';
    playBtn.title = 'Resume';
    playBtn.innerHTML = '&#9654;';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resumePlaying(fmt, songIdx);
    });

    const stopBtn = document.createElement('button');
    stopBtn.className = 't-btn stop';
    stopBtn.title = 'Stop';
    stopBtn.innerHTML = '&#9632;';
    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopPlaying(fmt, songIdx);
    });

    container.appendChild(playBtn);
    container.appendChild(stopBtn);
  } else {
    container.appendChild(makePlayButton(fmt, songIdx));
  }
}

// ─── ACTION BUTTONS UPDATE ───────────────────────────────────
function updateActionButtons(fmt, songIdx, state) {
  const key = `${fmt}_${songIdx}`;
  const transportEl = document.getElementById(`transport-${key}`);
  const colAct = document.getElementById(`action-${key}`);
  if (!colAct) return;

  const row = document.querySelector(`.song-row[data-key="${key}"]`);
  if (row) row.classList.toggle('playing', state === 'playing' || state === 'paused');

  if (transportEl) {
    const controlsEl = document.getElementById(`transport-controls-${key}`);
    if (controlsEl) {
      controlsEl.innerHTML = '';
      appendTransportButtons(controlsEl, fmt, songIdx, state);
    } else {
      transportEl.innerHTML = '';
      appendTransportButtons(transportEl, fmt, songIdx, state);
    }
  }

  colAct.innerHTML = '';
  if (!transportEl) {
    appendTransportButtons(colAct, fmt, songIdx, state);
  }
  const dlCtl = makeDownloadControl(fmt, songIdx);
  if (dlCtl) colAct.appendChild(dlCtl);
  const addAll = makeAddAllTimelineButton(fmt, songIdx);
  if (addAll) colAct.appendChild(addAll);
}

// ─── TOTALS ──────────────────────────────────────────────────
function updateTotals(fmt) {
  if (!fmt) fmt = 'wav';
  const el = document.getElementById(`totals-${fmt}`);
  if (!el) return;

  const songs = STATE.songs[fmt];
  const order = STATE.order[fmt];
  let totalDur = 0;
  let totalParts = 0;
  order.forEach(idx => {
    const s = songs[idx];
    if (!s) return;
    totalDur  += s.duration || 0;
    totalParts += s.parts.length;
  });

  el.innerHTML = `<span>Songs: <span class="totals-val">${order.length}</span></span>` +
    `<span>Total: <span class="totals-val">${fmtTimeHTML(totalDur)}</span></span>` +
    `<span>Parts: <span class="totals-val">${totalParts}</span></span>`;
}
