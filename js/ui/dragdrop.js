'use strict';
/* HTML5 drag & drop shared by the sidebar and the calendar: what is being dragged (`drag`) and Option-drop.
   drag = { kind: 'task' | 'thread', id, from: 'side' | 'cal', ids? }: ids = a sidebar selection dragged together. */
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
  // dragging one of several selected sidebar rows: the whole selection goes, shown as a small stack with a count
  if (drag.kind === 'task' && drag.from === 'side' && sel.size > 1 && sel.has(drag.id)) {
    drag.ids = selIds();
    const g = document.createElement('div'); g.id = 'dragstack';
    const f = findTask(drag.id);
    g.innerHTML = `<div class="ds-c" style="--c:${esc(colorOf(f.t))}"><span class="ds-t">${esc(f.task.title)}</span><span class="ds-n">${drag.ids.length}</span></div>`;
    document.body.appendChild(g); e.dataTransfer.setDragImage(g, 14, 14); setTimeout(() => g.remove(), 0);
    document.body.classList.add('drag-many');
  }
  document.body.classList.add('dragging');
  // open a small drop zone under each thread block (deferred so Chrome has taken the drag image first)
  if (drag.from === 'side') { const k = drag.kind; setTimeout(() => { if (drag) document.body.classList.add('drag-' + k); }, 0); }
});
document.addEventListener('dragend', () => {
  drag = null; document.body.classList.remove('dragging', 'drag-task', 'drag-thread', 'drag-many');
  $$('.day.over').forEach(x => x.classList.remove('over')); $('#tree').classList.remove('drop'); clearTdrop();
});
