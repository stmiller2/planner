'use strict';
/* HTML5 drag & drop shared by the sidebar and the calendar: what is being dragged (`drag`) and Option-drop. */
// holding Option while dropping moves just that one task (unlinked; nothing else shifts)
const splitHeld = e => !!(e && e.altKey);

// drag & drop
let drag = null;
document.addEventListener('dragstart', e => {
  const el = e.target.closest && e.target.closest('[draggable="true"]'); if (!el) return;
  closeMenu();
  if (el.dataset.tdrag) drag = { kind: 'thread', id: el.dataset.tdrag, from: 'side' };
  else if (el.dataset.id) drag = { kind: 'task', id: el.dataset.id, from: el.classList.contains('chip') ? 'cal' : 'side' };
  else return;
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', el.dataset.id);
  document.body.classList.add('dragging');
  // open a small drop zone under each thread block (deferred so Chrome has taken the drag image first)
  if (drag.from === 'side') { const k = drag.kind; setTimeout(() => { if (drag) document.body.classList.add('drag-' + k); }, 0); }
});
document.addEventListener('dragend', () => {
  drag = null; document.body.classList.remove('dragging', 'drag-task', 'drag-thread');
  $$('.day.over').forEach(x => x.classList.remove('over')); $('#tree').classList.remove('drop'); clearTdrop();
});
