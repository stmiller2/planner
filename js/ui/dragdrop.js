'use strict';
/* HTML5 drag & drop shared by the sidebar and the calendar: what is being dragged (`drag`) and Option-drop.
   drag = { kind: 'task' | 'thread', id, from: 'side' | 'cal' | 'fail', ids? }: ids = a sidebar selection dragged together;
   'fail' = a failed attempt's chip (id = its task, fid = the attempt), which can only be dropped on a day and is
   draggable only while the task is unscheduled (failChip, ui/calendar.js). Dropping it back on the chip it came
   from calls the whole thing off, which is the only way out when the day it would land on is its own (failBail). */
// how tall a gap to open for rows `els` (what will actually land there), at most 3 rows' worth
const gapH = (els, one = 27) => Math.min(84, [...new Set(els.filter(Boolean))].reduce((a, x) => a + x.offsetHeight, 0) || one);
/* holding Option while dropping moves just that one task (unlinked; nothing else shifts). In an HTML5 drag, Chrome on
   macOS keeps the drag events' altKey as it was when the drag began, but Option pressed or let go mid-drag does change
   what the system offers the page: effectAllowed (set to 'copyMove' in dragstart) reads 'copy' while Option is down.
   Day-view drags are pointer events, whose altKey is current. */
const splitHeld = e => !!(e && (e.altKey || (drag && e.dataTransfer && e.dataTransfer.effectAllowed === 'copy')));

// drag & drop
let drag = null, dragSrc = [];   // dragSrc: the dragged item's rows / chips (dimmed while it's out)
document.addEventListener('dragstart', e => {
  const el = e.target.closest && e.target.closest('[draggable="true"]'); if (!el) return;
  closeMenu();
  if (el.dataset.tdrag) drag = { kind: 'thread', id: el.dataset.tdrag, from: 'side' };
  else if (el.dataset.id) drag = { kind: 'task', id: el.dataset.id, from: el.classList.contains('chip') ? 'cal' : 'side' };
  else if (el.dataset.kid) drag = { kind: 'task', id: el.dataset.kid, from: 'fail', fid: el.dataset.fid };   // a failed attempt: reschedules its task
  else return;
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData('text/plain', drag.id);
  // dragging one of several selected tasks (sidebar row or calendar chip): the whole selection goes, shown as a small
  // stack with a count
  if (drag.kind === 'task' && drag.from !== 'fail' && sel.size > 1 && sel.has(drag.id)) {
    drag.ids = selIds();
    const g = document.createElement('div'); g.id = 'dragstack';
    const f = findTask(drag.id);
    g.innerHTML = `<div class="ds-c" style="--c:${esc(colorOf(f.t))}"><span class="ds-t">${esc(f.task.title)}</span><span class="ds-n">${drag.ids.length}</span></div>`;
    document.body.appendChild(g); e.dataTransfer.setDragImage(g, 14, 14); setTimeout(() => g.remove(), 0);
    document.body.classList.add('drag-many');
  }
  document.body.classList.add('dragging'); hideInsline();
  // what's being dragged: how tall a gap to open for it (sidebar rows, a calendar chip), and its rows / chips dim
  // where they are (once Chrome has taken the drag image)
  const src = drag.kind === 'thread' ? [$(`#tree .thread[data-tid="${drag.id}"]`)]
    : drag.from === 'fail' ? [el] : (drag.ids || movingIds(drag.id, false)).flatMap(id => [taskEl(id), ...$$(`#grid .chip[data-id="${id}"]`)]);
  drag.h = drag.kind === 'thread' ? Math.min(64, (src[0] && src[0].offsetHeight) || 27) : 0;   // tasks: per spot (gapH)
  drag.ch = el.classList.contains('chip') ? el.offsetHeight : 38;
  dragSrc = src.filter(Boolean);
  setTimeout(() => { if (drag) dragSrc.forEach(x => x.classList.add('dragsrc')); }, 0);
  // open a small drop zone under each thread block (deferred so Chrome has taken the drag image first)
  if (drag.from === 'side') { const k = drag.kind; setTimeout(() => { if (drag) document.body.classList.add('drag-' + k); }, 0); }
});
// (a gap opened under the pointer: accept the drag entering it, so the drop still reaches the list it's in)
document.addEventListener('dragenter', e => { if (drag && e.target.closest && e.target.closest('.dgap')) e.preventDefault(); });
document.addEventListener('dragend', () => {
  dragSrc.forEach(x => x.classList.remove('dragsrc')); dragSrc = [];
  treeGap.hide(); calGap.hide();
  drag = null; document.body.classList.remove('dragging', 'drag-task', 'drag-thread', 'drag-many');
  $$('.day.over').forEach(x => x.classList.remove('over')); $('#tree').classList.remove('drop'); clearTdrop();
});
