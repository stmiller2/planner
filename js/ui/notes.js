'use strict';
/* Task notes: free text kept on a task (task.notes). Written in a small window opened from the task's gear menu in
   the sidebar ("Add notes" / "Edit notes"); a task with notes gets a small mark after its title, and resting the
   pointer on it for a second (sidebar row, calendar chip, day-view list item or block) shows them. */
const noteMark = k => k.notes ? `<span class="nti">${ICON.notes}</span>` : '';

/* ---------- writing them ---------- */
// ⌘↩ / Ctrl+↩ or Save keeps them, Esc or Cancel doesn't; clicking outside the window keeps them too (so a stray
// click never loses what was typed). Saved empty = no notes.
function editNotes(id) {
  const f = findTask(id); if (!f) return;
  hideNotesTip();
  showModal(`<h3 class="nt-h">Notes<span>${esc(f.task.title)}</span></h3>
    <textarea class="nt-ta" id="ntText" spellcheck="true" placeholder="Anything to remember for this task">${esc(f.task.notes || '')}</textarea>
    <div class="row nt-row"><button class="btn primary" id="ntSave">Save</button><button class="btn" id="ntCancel">Cancel</button>
      ${f.task.notes ? '<button class="btn" id="ntClear">Remove notes</button>' : ''}<span class="sub">⌘↩ to save · Esc to cancel</span></div>`);
  const m = $('#modal'), ta = $('#ntText');
  const save = v => { hideModal(); setTaskNotes(id, v); };
  $('#ntSave').onclick = () => save(ta.value);
  $('#ntCancel').onclick = hideModal;
  if ($('#ntClear')) $('#ntClear').onclick = () => save('');
  m.onclick = e => { if (e.target === m) save(ta.value); };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(ta.value); } });
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

/* ---------- showing them ---------- */
// after resting on a task for NT_DELAY ms; gone on leaving it, pressing, scrolling, typing or dragging
const NT_DELAY = 1000, NT_SEL = '#tree .task[data-id], #grid .chip[data-id], #dayview .dv-item[data-id], #dayview .dv-blk[data-id]';
const ntip = document.createElement('div'); ntip.id = 'ntip'; document.body.appendChild(ntip);
let ntFor = null, ntTimer = null;
function hideNotesTip() { clearTimeout(ntTimer); ntTimer = null; ntip.style.display = 'none'; }
document.addEventListener('mouseover', e => {
  const el = e.target.closest ? e.target.closest(NT_SEL) : null;
  if (el === ntFor) return;
  ntFor = el; hideNotesTip();
  if (!el || drag || dv || $('#modal').style.display === 'grid') return;
  const f = findTask(el.dataset.id); if (!f || !f.task.notes) return;
  ntTimer = setTimeout(() => showNotesTip(el), NT_DELAY);
});
function showNotesTip(el) {
  const f = findTask(el.dataset.id);
  if (!el.isConnected || !f || !f.task.notes || drag || dv || el.querySelector('.inl') || menu.style.display === 'block') return;
  // a short day-view block shows only part of its label, so the note carries its time and thread too; a calendar
  // chip with notes has no hover title (it would cover this), so its path goes here instead
  const p = el.classList.contains('dv-blk') && el.classList.contains('short') && planOf(f.task);
  const sub = p ? `${fmtSpan(p.start, p.dur)} · ${f.t.name}` : el.classList.contains('chip') ? [f.p.name, ...f.path].join(' › ') + (isLoose(f.p, f.t) ? '' : ` #${f.i + 1}`) : '';
  ntip.style.setProperty('--c', colorOf(f.t));
  ntip.innerHTML = `<div class="nt-t">${esc(f.task.title)}</div>${sub ? `<div class="tm">${esc(sub)}</div>` : ''}<div class="nt-b">${esc(f.task.notes)}</div>`;
  ntip.style.display = 'block';
  const r = el.getBoundingClientRect(), w = ntip.offsetWidth, h = ntip.offsetHeight;
  ntip.style.left = clamp(r.left + 10, 8, innerWidth - w - 8) + 'px';
  ntip.style.top = (r.bottom + h + 6 < innerHeight ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
}
// pressing (to click, drag or rename) hides it, and it stays hidden until the pointer moves onto another task
['pointerdown', 'dragstart', 'keydown'].forEach(ev => document.addEventListener(ev, hideNotesTip, true));
document.addEventListener('scroll', hideNotesTip, true);
document.addEventListener('mouseleave', () => { ntFor = null; hideNotesTip(); });
