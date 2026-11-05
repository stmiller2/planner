'use strict';
/* Task notes: free text kept on a task (task.notes). Written in a small window opened from the task's gear menu in
   the sidebar ("Add notes" / "Edit notes"); a task with notes gets a small mark after its title, and resting the
   pointer on it for a second (sidebar row, calendar chip, day-view list item or block) shows them in a hover note
   that can also be edited in place (double-click its text). */
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
// After resting on a task for NT_DELAY ms. The note stays while the pointer is on the task or on the note itself
// (crossing the gap between them, or a quick slip off, is forgiven for NT_GRACE ms), so a long note can be scrolled.
// Double-clicking its text edits it in place: ⌘↩ / Ctrl+↩ saves and keeps the note open, Esc goes back without
// saving, and pressing anywhere else saves and closes it (Enter is a new line). Gone on leaving both the task and the
// note, pressing elsewhere, scrolling elsewhere, typing or dragging.
const NT_DELAY = 1000, NT_GRACE = 300, NT_SEL = '#tree .task[data-id], #grid .chip[data-id], #dayview .dv-item[data-id], #dayview .dv-blk[data-id]';
const ntip = document.createElement('div'); ntip.id = 'ntip'; document.body.appendChild(ntip);
// ntFor: the task under the pointer; ntOn / ntId: the task (element, id) whose note is showing; ntGone: the grace timer;
// ntEdit: the in-place editor while open ({ ta, save })
let ntFor = null, ntTimer = null, ntOn = null, ntId = null, ntGone = null, ntEdit = null;
function dropNotesTip() {   // the note itself (an in-place edit is saved first); a task waiting to show its note still will
  clearTimeout(ntGone); ntGone = null;
  if (ntEdit) ntEdit.save();
  ntOn = ntId = null; ntip.style.display = 'none'; ntip.style.width = '';
}
function hideNotesTip() { clearTimeout(ntTimer); ntTimer = null; dropNotesTip(); }
const ntStay = () => { clearTimeout(ntGone); ntGone = null; };
document.addEventListener('mouseover', e => {
  if (ntip.contains(e.target)) return ntStay();
  if (ntEdit) return;                                   // while editing, only a press elsewhere (or ⌘↩ / Esc) ends it
  const el = e.target.closest ? e.target.closest(NT_SEL) : null;
  if (ntOn && el && !ntOn.isConnected && el.dataset.id === ntId) ntOn = el;   // its task was redrawn (e.g. after saving)
  if (ntOn) { if (el === ntOn) ntStay(); else if (!ntGone) ntGone = setTimeout(dropNotesTip, NT_GRACE); }
  if (el === ntFor) return;
  ntFor = el; clearTimeout(ntTimer); ntTimer = null;
  if (!el || el === ntOn || drag || dv || $('#modal').style.display === 'grid') return;
  const f = findTask(el.dataset.id); if (!f || !f.task.notes) return;
  ntTimer = setTimeout(() => showNotesTip(el), NT_DELAY);
});
let ntRect = null;   // where the task was when its note opened (the note is placed beside it)
function placeNotesTip() {
  const r = ntRect, w = ntip.offsetWidth, h = ntip.offsetHeight;
  ntip.style.left = clamp(r.left + 10, 8, innerWidth - w - 8) + 'px';
  ntip.style.top = (r.bottom + h + 6 < innerHeight ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
}
function showNotesTip(el) {
  const f = findTask(el.dataset.id);
  if (!el.isConnected || !f || !f.task.notes || drag || dv || el.querySelector('.inl') || menu.style.display === 'block') return;
  dropNotesTip();
  // a short day-view block shows only part of its label, so the note carries its time and thread too; a calendar
  // chip with notes has no hover title (it would cover this), so its path goes here instead
  const p = el.classList.contains('dv-blk') && el.classList.contains('short') && planOf(f.task);
  const sub = p ? `${fmtSpan(p.start, p.dur)} · ${f.t.name}` : el.classList.contains('chip') ? [f.p.name, ...f.path].join(' › ') + (isLoose(f.p, f.t) ? '' : ` #${f.i + 1}`) : '';
  ntip.style.setProperty('--c', colorOf(f.t));
  ntip.innerHTML = `<div class="nt-t">${esc(f.task.title)}</div>${sub ? `<div class="tm">${esc(sub)}</div>` : ''}<div class="nt-b">${esc(f.task.notes)}</div>`;
  ntip.style.display = 'block'; ntip.scrollTop = 0;
  ntOn = el; ntId = f.task.id; ntRect = el.getBoundingClientRect();
  placeNotesTip();
}
// editing in place: double-click the note's text
ntip.addEventListener('dblclick', e => {
  const b = e.target.closest('.nt-b'); if (!b || ntEdit || !ntId) return;
  const f = findTask(ntId); if (!f) return;
  e.preventDefault(); getSelection().removeAllRanges();
  const id = ntId, cur = f.task.notes || '';
  ntip.style.width = clamp(Math.max(ntip.offsetWidth, 300), 0, Math.min(340, innerWidth - 16)) + 'px';   // room to type
  const ta = document.createElement('textarea'); ta.className = 'nt-ed'; ta.value = cur; ta.spellcheck = true;
  const k = document.createElement('div'); k.className = 'nt-k'; k.textContent = '⌘↩ to save · Esc to cancel';
  b.replaceWith(ta); ta.after(k);
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  // done: back to showing the note (keep = stay open); saving an empty note removes it (and the note closes)
  const done = (save, keep) => {
    if (ntEdit !== ed) return; ntEdit = null;
    const v = ta.value.trim();
    if (save && v !== cur.trim()) setTaskNotes(id, v);
    const now = (findTask(id) || { task: {} }).task.notes;
    if (!keep || !now) { if (keep) dropNotesTip(); return; }
    const nb = document.createElement('div'); nb.className = 'nt-b'; nb.textContent = now;
    ta.replaceWith(nb); k.remove(); ntip.style.width = ''; placeNotesTip();
  };
  const ed = { ta, save: () => done(true, false) };
  ntEdit = ed;
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); done(true, true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(false, true); }
  });
  fit(); placeNotesTip();
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
});
// pressing (to click, drag or rename) anywhere but on the note hides it, and it stays hidden until the pointer moves
// onto another task; so does typing, except in the note's own box (and ⌘C / Ctrl+C, to copy text selected in it)
document.addEventListener('pointerdown', e => { if (!ntip.contains(e.target)) hideNotesTip(); }, true);
document.addEventListener('dragstart', hideNotesTip, true);
document.addEventListener('keydown', e => {
  if (ntip.contains(e.target) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') || ['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;
  hideNotesTip();
}, true);
document.addEventListener('scroll', e => { if (!ntip.contains(e.target)) hideNotesTip(); }, true);
document.addEventListener('mouseleave', () => { if (ntEdit) return; ntFor = null; hideNotesTip(); });
