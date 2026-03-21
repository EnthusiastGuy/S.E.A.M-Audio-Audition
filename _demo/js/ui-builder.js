/* =============================================================
   S.E.A.M Audio Audition — UI Builder: Tabs, Playlist & Totals
   ============================================================= */

// ─── BUILD UI ────────────────────────────────────────────────
function buildUI(savedSession) {
  const tabsNav  = document.getElementById('tabs-nav');
  const tabsCont = document.getElementById('tabs-content');
  tabsNav.innerHTML  = '';
  tabsCont.innerHTML = '';

  for (const fmt of STATE.formats) {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (fmt === STATE.currentFormat ? ' active' : '');
    btn.textContent = fmt.toUpperCase();
    btn.dataset.fmt = fmt;
    btn.addEventListener('click', () => switchTab(fmt));
    tabsNav.appendChild(btn);

    const div = document.createElement('div');
    div.className = 'tab-content' + (fmt === STATE.currentFormat ? ' active' : '');
    div.id = `tab-${fmt}`;
    tabsCont.appendChild(div);

    buildPlaylist(fmt, div);
  }

  updateTotals();
}

function switchTab(fmt) {
  STATE.currentFormat = fmt;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.fmt === fmt));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${fmt}`));
  saveSession();
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
  const hasParts = song.parts.length > 0;
  const missingMain = !song.mainHandle;

  const row = document.createElement('div');
  row.className = 'song-row' + (missingMain ? ' missing-main' : '');
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
  colName.className = 'col-name' + (missingMain ? ' missing' : '');
  colName.innerHTML = missingMain
    ? `${song.name}<span class="missing-tip">Main song file missing — only parts available</span>`
    : song.name;
  main.appendChild(colName);

  // Duration
  const colDur = document.createElement('div');
  colDur.className = 'col-dur';
  colDur.id = `dur-${key}`;
  colDur.textContent = song.duration > 0 ? fmtTime(song.duration) : '—';
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
  main.appendChild(colAction);

  row.appendChild(main);

  // Player area (expanded on play)
  const playerArea = document.createElement('div');
  playerArea.className = 'song-player-area';
  playerArea.id = `player-area-${key}`;
  row.appendChild(playerArea);

  return row;
}

function makePlayButton(fmt, songIdx) {
  const key = `${fmt}_${songIdx}`;
  const btn = document.createElement('button');
  btn.className = 't-btn play';
  btn.title = 'Play';
  btn.innerHTML = '&#9654;';
  btn.addEventListener('click', () => startPlaying(fmt, songIdx));
  return btn;
}

// ─── ACTION BUTTONS UPDATE ───────────────────────────────────
function updateActionButtons(fmt, songIdx, state) {
  const key    = `${fmt}_${songIdx}`;
  const colAct = document.getElementById(`action-${key}`);
  if (!colAct) return;
  colAct.innerHTML = '';

  const row = document.querySelector(`.song-row[data-key="${key}"]`);
  if (row) row.classList.toggle('playing', state === 'playing' || state === 'paused');

  if (state === 'playing') {
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 't-btn pause';
    pauseBtn.title = 'Pause';
    pauseBtn.innerHTML = '&#9646;&#9646;';
    pauseBtn.addEventListener('click', () => pausePlaying(fmt, songIdx));

    const stopBtn = document.createElement('button');
    stopBtn.className = 't-btn stop';
    stopBtn.title = 'Stop';
    stopBtn.innerHTML = '&#9632;';
    stopBtn.addEventListener('click', () => stopPlaying(fmt, songIdx));

    const dot = document.createElement('span');
    dot.className = 'status-dot';

    colAct.appendChild(pauseBtn);
    colAct.appendChild(stopBtn);
    colAct.appendChild(dot);
  } else if (state === 'paused') {
    const playBtn = document.createElement('button');
    playBtn.className = 't-btn play';
    playBtn.title = 'Resume';
    playBtn.innerHTML = '&#9654;';
    playBtn.addEventListener('click', () => resumePlaying(fmt, songIdx));

    const stopBtn = document.createElement('button');
    stopBtn.className = 't-btn stop';
    stopBtn.title = 'Stop';
    stopBtn.innerHTML = '&#9632;';
    stopBtn.addEventListener('click', () => stopPlaying(fmt, songIdx));

    colAct.appendChild(playBtn);
    colAct.appendChild(stopBtn);
  } else {
    colAct.appendChild(makePlayButton(fmt, songIdx));
  }
}

// ─── TOTALS ──────────────────────────────────────────────────
function updateTotals(fmt) {
  if (!fmt) { STATE.formats.forEach(f => updateTotals(f)); return; }
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
    `<span>Total: <span class="totals-val">${fmtTime(totalDur)}</span></span>` +
    `<span>Parts: <span class="totals-val">${totalParts}</span></span>`;
}
