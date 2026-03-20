/* =============================================================
   S.E.A.M Audio Audition — Drag Reorder Rows
   ============================================================= */

function initDragReorder(fmt) {
  const body = document.getElementById(`playlist-body-${fmt}`);
  if (!body) return;

  let dragSrc = null;

  body.querySelectorAll('.song-row').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      if (e.target.closest('.part-item') || e.target.closest('.part-brick')) return;
      dragSrc = row;
      row.classList.add('dragging');
      e.dataTransfer.setData('row-move', row.dataset.idx);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      body.querySelectorAll('.song-row').forEach(r => {
        r.classList.remove('drag-over-top','drag-over-bottom');
      });
      dragSrc = null;
    });
    row.addEventListener('dragover', (e) => {
      if (!dragSrc || dragSrc === row) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const mid  = rect.top + rect.height / 2;
      body.querySelectorAll('.song-row').forEach(r => r.classList.remove('drag-over-top','drag-over-bottom'));
      row.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragSrc || dragSrc === row) return;
      const srcIdx  = parseInt(dragSrc.dataset.idx);
      const dstIdx  = parseInt(row.dataset.idx);
      const order   = STATE.order[fmt];
      const srcPos  = order.indexOf(srcIdx);
      const dstPos  = order.indexOf(dstIdx);
      if (srcPos === -1 || dstPos === -1) return;
      const rect = row.getBoundingClientRect();
      const mid  = rect.top + rect.height / 2;
      order.splice(srcPos, 1);
      const finalPos = e.clientY < mid ? order.indexOf(dstIdx) : order.indexOf(dstIdx) + 1;
      order.splice(finalPos, 0, srcIdx);
      renderPlaylistRows(fmt);
      saveSession();
    });
  });
}
