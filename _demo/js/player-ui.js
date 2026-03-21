/* =============================================================
   S.E.A.M Audio Audition — Player UI & Part Sheet
   ============================================================= */

let activePartDownloadDropdown = null;
function closeActivePartDownloadDropdown() {
  if (!activePartDownloadDropdown) return;
  activePartDownloadDropdown.classList.add('hidden');
  activePartDownloadDropdown = null;
}

function makePartDownloadControl(fmt, songIdx, partIndex) {
  const key = `${fmt}_${songIdx}`;
  const ps = ensurePlayerState(fmt, songIdx);
  if (!ps.partDownloadFormats) ps.partDownloadFormats = {};
  const selected = (ps.partDownloadFormats[String(partIndex)] || 'wav').toLowerCase();

  const wrap = document.createElement('div');
  wrap.className = 'download-split part-download-split';

  const mainBtn = document.createElement('button');
  mainBtn.className = 't-btn dl-main';
  mainBtn.title = 'Download this file';
  mainBtn.innerHTML = `&#128229; <span class="dl-fmt">${selected.toUpperCase()}</span>`;
  mainBtn.onclick = (e) => {
    e.stopPropagation();
    downloadPartPreview(fmt, songIdx, partIndex, ps.partDownloadFormats[String(partIndex)] || 'wav');
  };
  wrap.appendChild(mainBtn);

  const arrowBtn = document.createElement('button');
  arrowBtn.className = 't-btn dl-arrow';
  arrowBtn.title = 'Select download format';
  arrowBtn.innerHTML = '&#9662;';
  wrap.appendChild(arrowBtn);

  const dd = document.createElement('div');
  dd.className = 'download-format-dropdown hidden';
  dd.id = `part-download-dd-${key}-${partIndex}`;
  ['wav', 'mp3', 'ogg'].forEach((fmtOpt) => {
    const opt = document.createElement('button');
    opt.className = 'download-format-option';
    opt.textContent = fmtOpt.toUpperCase();
    if (selected === fmtOpt) opt.classList.add('selected');
    opt.onclick = (ev) => {
      ev.stopPropagation();
      ps.partDownloadFormats[String(partIndex)] = fmtOpt;
      const lbl = mainBtn.querySelector('.dl-fmt');
      if (lbl) lbl.textContent = fmtOpt.toUpperCase();
      dd.querySelectorAll('.download-format-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      saveSession();
      closeActivePartDownloadDropdown();
    };
    dd.appendChild(opt);
  });
  wrap.appendChild(dd);

  arrowBtn.onclick = (e) => {
    e.stopPropagation();
    const willOpen = dd.classList.contains('hidden');
    closeActivePartDownloadDropdown();
    if (willOpen) {
      dd.classList.remove('hidden');
      activePartDownloadDropdown = dd;
      setTimeout(() => {
        document.addEventListener('click', closeActivePartDownloadDropdown, { once: true });
      }, 0);
    }
  };

  return wrap;
}

// ─── SHOW / HIDE PLAYER AREA ─────────────────────────────────
function showPlayerArea(fmt, songIdx) {
  const key  = `${fmt}_${songIdx}`;
  const area = document.getElementById(`player-area-${key}`);
  if (!area) return;
  area.innerHTML = '';
  area.classList.add('visible');
  renderPlayerArea(fmt, songIdx);
}

function hidePlayerArea(fmt, songIdx) {
  const key  = `${fmt}_${songIdx}`;
  const area = document.getElementById(`player-area-${key}`);
  if (!area) return;
  area.classList.remove('visible');
  area.innerHTML = '';
}

// ─── PLAYER AREA RENDER ──────────────────────────────────────
function renderPlayerArea(fmt, songIdx) {
  const key  = `${fmt}_${songIdx}`;
  const area = document.getElementById(`player-area-${key}`);
  const ps   = STATE.players[key];
  const song = STATE.songs[fmt][songIdx];
  if (!area || !ps) return;

  // Parts list
  const partsList = document.createElement('div');
  partsList.className = 'parts-list';
  partsList.id = `parts-list-${key}`;

  const allFiles = [];
  if (song.mainHandle) allFiles.push({ label: song.mainFile || song.name, partIndex: -1, isMain: true });
  song.parts.forEach((p, i) => allFiles.push({ label: p.file, partIndex: i, isMain: false }));

  allFiles.forEach(f => {
    // Wrapper for part item + mini bar
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'part-item-wrapper';
    itemWrapper.dataset.partIndex = f.partIndex;

    const item = document.createElement('div');
    item.className = 'part-item';
    item.dataset.partIndex = f.partIndex;
    item.draggable = true;

    const dot = document.createElement('span');
    dot.className = 'part-color-dot';
    dot.style.background = f.isMain ? 'var(--text3)' : partColor(f.partIndex);
    item.appendChild(dot);

    const lbl = document.createElement('span');
    lbl.className = 'part-label';
    lbl.textContent = f.label;
    item.appendChild(lbl);

    // Play part button
    const pBtn = document.createElement('button');
    pBtn.className = 't-btn play btn-sm part-play-btn';
    pBtn.title = 'Play this part';
    pBtn.innerHTML = '&#9654;';
    pBtn.onclick = (e) => {
      e.stopPropagation();
      const ps = STATE.players[`${fmt}_${songIdx}`];
      if (ps && ps._directNode && ps._directPartIndex === f.partIndex) {
        // Currently playing: pause it
        if (!ps._directPaused) {
          pauseDirectPart(ps);
          pBtn.innerHTML = '&#9654;';
          pBtn.title = 'Resume';
        } else {
          // Currently paused: resume it
          resumeDirectPart(ps);
          pBtn.innerHTML = '&#9646;&#9646;';
          pBtn.title = 'Pause';
        }
      } else {
        // Not playing: start playing
        playPartDirectly(fmt, songIdx, f.partIndex, itemWrapper);
      }
    };
    item.appendChild(pBtn);

    // Stop part button
    const sBtn = document.createElement('button');
    sBtn.className = 't-btn stop btn-sm part-stop-btn';
    sBtn.title = 'Stop';
    sBtn.innerHTML = '&#9632;';
    sBtn.style.display = 'none';
    sBtn.onclick = (e) => {
      e.stopPropagation();
      const ps = STATE.players[`${fmt}_${songIdx}`];
      if (ps) {
        stopDirectPart(ps);
        resetDirectPartUI(ps, `${fmt}_${songIdx}`, f.partIndex, itemWrapper);
      }
    };
    item.appendChild(sBtn);

    const dlCtl = makePartDownloadControl(fmt, songIdx, f.partIndex);
    item.appendChild(dlCtl);

    itemWrapper.appendChild(item);

    // Mini bar (shown when this part is playing directly) - BELOW the item
    const miniBar = document.createElement('div');
    miniBar.className = 'part-mini-bar';
    miniBar.id = `mini-bar-${key}-${f.partIndex}`;
    const miniFill = document.createElement('div');
    miniFill.className = 'part-mini-fill';
    miniFill.id = `mini-fill-${key}-${f.partIndex}`;
    const miniHandle = document.createElement('div');
    miniHandle.className = 'part-mini-handle';
    miniHandle.id = `mini-handle-${key}-${f.partIndex}`;
    miniBar.appendChild(miniFill);
    miniBar.appendChild(miniHandle);
    itemWrapper.appendChild(miniBar);

    // Drag from parts list to timeline
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('part-source', JSON.stringify({ fmt, songIdx, partIndex: f.partIndex, fromList: true }));
      e.dataTransfer.effectAllowed = 'copyMove';
      highlightPartInstances(key, f.partIndex, true);
    });
    item.addEventListener('dragend', () => {
      highlightPartInstances(key, f.partIndex, false);
    });

    item.addEventListener('mouseenter', () => highlightPartInstances(key, f.partIndex, true));
    item.addEventListener('mouseleave', () => highlightPartInstances(key, f.partIndex, false));

    partsList.appendChild(itemWrapper);
  });

  area.appendChild(partsList);

  // Seek bar + part bricks
  const seekContainer = document.createElement('div');
  seekContainer.className = 'seekbar-container';
  seekContainer.id = `seek-container-${key}`;
  area.appendChild(seekContainer);

  renderSeekBar(fmt, songIdx);
}

// ─── HIGHLIGHT CROSS-REFERENCE ───────────────────────────────
function highlightPartInstances(key, partIndex, on) {
  const listItems = document.querySelectorAll(`#parts-list-${key} .part-item`);
  listItems.forEach(item => {
    if (parseInt(item.dataset.partIndex) === partIndex) {
      item.classList.toggle('highlighted', on);
    }
  });
  const bricks = document.querySelectorAll(`.part-brick[data-key="${key}"][data-part="${partIndex}"]`);
  bricks.forEach(b => b.classList.toggle('highlighted', on));
}

// ─── PART SHEET TOGGLE ───────────────────────────────────────
function togglePartSheet(fmt, songIdx) {
  const key  = `${fmt}_${songIdx}`;
  const area = document.getElementById(`player-area-${key}`);
  if (!area) return;

  const isOpen = openPartSheets.has(key);
  if (isOpen) {
    area.classList.remove('visible');
    area.innerHTML = '';
    openPartSheets.delete(key);
    saveSession();
  } else {
    ensurePlayerState(fmt, songIdx);
    preloadSong(fmt, songIdx).then(() => {
      area.classList.add('visible');
      renderPlayerArea(fmt, songIdx);
      openPartSheets.add(key);
      saveSession();
    });
  }
}
