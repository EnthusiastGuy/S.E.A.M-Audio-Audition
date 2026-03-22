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

function formatPartRowDuration(ps, song, partIndex) {
  const d = ps.partDurations[partIndex];
  if (isFinite(d) && d > 0) return fmtTimeHTML(d);
  if (partIndex >= 0) {
    const pd = song.parts[partIndex]?._dur;
    if (isFinite(pd) && pd > 0) return fmtTimeHTML(pd);
  }
  if (partIndex === -1 && song.duration > 0) return fmtTimeHTML(song.duration);
  return '—';
}

// ─── PLAYER AREA (visibility: row toggle only; see togglePartSheet) ─────────────────
/** Re-render parts list + seekbar when the sheet is open; does not show/hide (no tie to play/stop). */
function refreshPlayerAreaIfVisible(fmt, songIdx) {
  const key  = `${fmt}_${songIdx}`;
  const area = document.getElementById(`player-area-${key}`);
  if (!area || !area.classList.contains('visible')) return;
  ensurePlayerState(fmt, songIdx);
  renderPlayerArea(fmt, songIdx);
}

// ─── PLAYER AREA RENDER ──────────────────────────────────────
function renderPlayerArea(fmt, songIdx) {
  const key  = `${fmt}_${songIdx}`;
  const area = document.getElementById(`player-area-${key}`);
  const ps   = STATE.players[key];
  const song = STATE.songs[fmt][songIdx];
  if (!area || !ps) return;

  area.innerHTML = '';

  // Parts list
  const partsList = document.createElement('div');
  partsList.className = 'parts-list';
  partsList.id = `parts-list-${key}`;

  const allFiles = [];
  if (song.mainHandle) allFiles.push({ label: song.mainFile || song.name, partIndex: -1, isMain: true });
  song.parts.forEach((p, i) => allFiles.push({ label: p.file, partIndex: i, isMain: false }));

  allFiles.forEach((f, rowIdx) => {
    // Wrapper for part item + mini bar
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'part-item-wrapper';
    itemWrapper.dataset.partIndex = f.partIndex;

    const item = document.createElement('div');
    item.className = 'part-item';
    item.dataset.partIndex = f.partIndex;
    item.draggable = true;

    const colNr = document.createElement('div');
    colNr.className = 'part-item-col-nr';
    colNr.setAttribute('aria-hidden', 'true');
    item.appendChild(colNr);

    const nameCell = document.createElement('div');
    nameCell.className = 'part-item-name';

    const dot = document.createElement('span');
    dot.className = 'part-color-dot';
    dot.style.background = f.isMain ? 'var(--text3)' : partColor(f.partIndex);
    nameCell.appendChild(dot);

    const lbl = document.createElement('span');
    lbl.className = 'part-label';
    lbl.textContent = f.label;
    nameCell.appendChild(lbl);
    item.appendChild(nameCell);

    const durEl = document.createElement('span');
    durEl.className = 'col-dur';
    const durStr = formatPartRowDuration(ps, song, f.partIndex);
    if (durStr === '—') durEl.textContent = durStr;
    else durEl.innerHTML = durStr;
    item.appendChild(durEl);

    const colParts = document.createElement('div');
    colParts.className = 'part-item-col-parts';
    colParts.setAttribute('aria-hidden', 'true');
    item.appendChild(colParts);

    const actions = document.createElement('div');
    actions.className = 'part-item-actions col-action';

    // Play part button
    const pBtn = document.createElement('button');
    pBtn.className = 't-btn play btn-sm part-play-btn';
    pBtn.title = 'Play this part';
    pBtn.innerHTML = '&#9654;';
    pBtn.onclick = (e) => {
      e.stopPropagation();
      handleDirectPartPlayClick(fmt, songIdx, f.partIndex, itemWrapper);
    };
    actions.appendChild(pBtn);

    // Play looped (same track repeats until Stop)
    const lpBtn = document.createElement('button');
    lpBtn.className = 't-btn play btn-sm part-play-loop-btn';
    lpBtn.title = 'Play looped';
    lpBtn.setAttribute('aria-label', 'Play looped');
    lpBtn.innerHTML =
      '&#9654;<span class="part-loop-glyph" aria-hidden="true">&#8635;</span>';
    lpBtn.onclick = (e) => {
      e.stopPropagation();
      handleDirectPartLoopClick(fmt, songIdx, f.partIndex, itemWrapper);
    };
    actions.appendChild(lpBtn);

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
    actions.appendChild(sBtn);

    const tlSingleBtn = document.createElement('button');
    tlSingleBtn.type = 'button';
    tlSingleBtn.className = 't-btn btn-sm timeline-place-btn timeline-place-btn--one';
    tlSingleBtn.title = 'Add this file to the timeline';
    tlSingleBtn.setAttribute('aria-label', 'Add this file to the timeline');
    tlSingleBtn.innerHTML =
      '<svg class="timeline-btn-svg" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="7" width="3.5" height="9" rx="1" fill="currentColor"/><rect x="8.25" y="4" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="14.5" y="5.5" width="3.5" height="10.5" rx="1" fill="currentColor"/><path d="M7 18h6l-3 3z" fill="currentColor"/></svg>';
    tlSingleBtn.onclick = (e) => {
      e.stopPropagation();
      appendPartToTimeline(fmt, songIdx, f.partIndex);
    };
    actions.appendChild(tlSingleBtn);

    const dlCtl = makePartDownloadControl(fmt, songIdx, f.partIndex);
    actions.appendChild(dlCtl);
    item.appendChild(actions);

    itemWrapper.appendChild(item);

    // Mini seek + waveform (shown when this part is playing directly) — below the row
    const miniStack = document.createElement('div');
    miniStack.className = 'part-mini-stack';
    miniStack.id = `part-mini-stack-${key}-${f.partIndex}`;

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
    miniStack.appendChild(miniBar);

    const partPreviewWrap = document.createElement('div');
    partPreviewWrap.className = 'brick-preview-wrap part-mini-preview-wrap';
    partPreviewWrap.id = `part-mini-preview-wrap-${key}-${f.partIndex}`;
    partPreviewWrap.setAttribute('role', 'img');
    partPreviewWrap.setAttribute(
      'aria-label',
      'Part waveform: one loop tiles seamlessly; playhead at center; vertical lines mark loop repeats.'
    );
    const partPreviewCanvas = document.createElement('canvas');
    partPreviewCanvas.className = 'brick-preview-canvas';
    partPreviewCanvas.id = `part-mini-preview-canvas-${key}-${f.partIndex}`;
    partPreviewCanvas.setAttribute('aria-hidden', 'true');
    const partPreviewFlash = document.createElement('div');
    partPreviewFlash.className = 'brick-preview-flash';
    partPreviewWrap.appendChild(partPreviewCanvas);
    partPreviewWrap.appendChild(partPreviewFlash);
    miniStack.appendChild(partPreviewWrap);

    itemWrapper.appendChild(miniStack);
    wirePartMiniPreview(fmt, songIdx, f.partIndex);

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
  updateActionButtons(fmt, songIdx, inferTransportState(fmt, songIdx));
  syncBrickPreview(fmt, songIdx);
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
    updateActionButtons(fmt, songIdx, inferTransportState(fmt, songIdx));
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
