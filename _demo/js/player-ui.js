/* =============================================================
   S.E.A.M Audio Audition — Player UI & Part Sheet
   ============================================================= */

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
        stopDirectPart(ps);
        resetDirectPartUI(ps, `${fmt}_${songIdx}`, f.partIndex, item);
      } else {
        playPartDirectly(fmt, songIdx, f.partIndex, item);
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
        resetDirectPartUI(ps, `${fmt}_${songIdx}`, f.partIndex, item);
      }
    };
    item.appendChild(sBtn);

    // Mini bar (shown when this part is playing directly)
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
    item.appendChild(miniBar);

    // Drag from parts list to timeline
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('part-source', JSON.stringify({ fmt, songIdx, partIndex: f.partIndex, fromList: true }));
      e.dataTransfer.effectAllowed = 'copyMove';
      highlightPartInstances(key, f.partIndex, true);
    });
    item.addEventListener('dragend', () => {
      highlightPartInstances(key, f.partIndex, false);
    });

    // Hover highlight cross-reference
    item.addEventListener('mouseenter', () => highlightPartInstances(key, f.partIndex, true));
    item.addEventListener('mouseleave', () => highlightPartInstances(key, f.partIndex, false));

    partsList.appendChild(item);
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
