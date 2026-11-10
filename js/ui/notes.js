'use strict';
/* Task notes: free text kept on a task (task.notes). A task with notes gets a small mark after its title, and resting
   the pointer on it for a second (sidebar row, calendar chip, day-view list item or block) shows them in a hover note,
   which is also where they are written: double-click its text, or choose "Add notes" / "Edit notes" from the task's
   menu (its gear, or right-clicking it), which opens the note beside the task already in edit mode. */
const noteMark = k => k.notes ? `<span class="nti">${ICON.notes}</span>` : '';

/* ---------- writing them ---------- */
// from the task's menu: el = the task it was opened on (if it was redrawn since, the task's first element showing)
function editNotes(id, el) {
  const f = findTask(id); if (!f) return;
  if (!el || !el.isConnected || el.dataset.id !== id) el = [...document.querySelectorAll(NT_SEL)].find(x => x.dataset.id === id && x.getClientRects().length);
  hideNotesTip();
  if (!el) return;
  openNotesTip(el, f);
  editInTip();
}

/* ---------- showing them ---------- */
// the note's text as HTML, with web addresses (http://, https://, www.) as links that open in a new tab. Punctuation
// right after an address (a full stop, a closing bracket that isn't part of it) stays outside the link.
const NT_URL = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
function linkifyNotes(text) {
  let out = '', at = 0;
  for (const m of text.matchAll(NT_URL)) {
    let u = m[0];
    for (;;) {
      const c = u.slice(-1), opens = (u.match(/\(/g) || []).length, closes = (u.match(/\)/g) || []).length;
      if (/[.,;:!?'\]}>]/.test(c) || (c === ')' && closes > opens)) u = u.slice(0, -1); else break;
    }
    if (u.length < 5) continue;
    const href = /^www\./i.test(u) ? 'https://' + u : u;
    out += esc(text.slice(at, m.index)) + `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`;
    at = m.index + u.length;
  }
  return out + esc(text.slice(at));
}
// After resting on a task for NT_DELAY ms (a task with notes, or a short day-view block: see ntWants). The note stays while the pointer is on the task or on the note itself
// (crossing the gap between them, or a quick slip off, is forgiven for NT_GRACE ms), so a long note can be scrolled.
// Web addresses in it are links; double-clicking its text (not a link) edits it in place (editInTip). Once one has
// shown, the next opens at once (hoverDelay, dom.js; a short block's note counts as its own kind). Gone on leaving
// both the task and the note, pressing elsewhere, scrolling elsewhere, typing or dragging.
const NT_DELAY = 1000, NT_GRACE = 300, NT_SEL = '#tree .task[data-id], #grid .chip[data-id], #dayview .dv-item[data-id], #dayview .dv-blk[data-id]';
const ntip = document.createElement('div'); ntip.id = 'ntip'; document.body.appendChild(ntip);
// ntFor: the task under the pointer; ntOn / ntId: the task (element, id) whose note is showing; ntGone: the grace timer;
// ntEdit: the in-place editor while open ({ ta, save })
let ntFor = null, ntTimer = null, ntOn = null, ntId = null, ntGone = null, ntEdit = null, ntShownText = null;   // ntShownText: the text shown
let ntKind = null;   // 'notes' / 'blk' (a short day-view block) while shown from hovering (see hoverDelay)
const ntKindOf = el => el.classList.contains('dv-blk') && el.classList.contains('short') ? 'blk' : 'notes';
function dropNotesTip() {   // the note itself (an in-place edit is saved first); a task waiting to show its note still will
  clearTimeout(ntGone); ntGone = null;
  if (ntEdit) ntEdit.save();
  ntOn = ntId = null; ntip.style.display = 'none'; ntip.style.width = '';
  if (ntKind) hoverGone(ntKind); ntKind = null;
}
function hideNotesTip() { clearTimeout(ntTimer); ntTimer = null; dropNotesTip(); }
const ntStay = () => { clearTimeout(ntGone); ntGone = null; };
document.addEventListener('mouseover', e => {
  if (ntip.contains(e.target)) return ntStay();
  if (ntEdit) return;                                   // while editing, only a press elsewhere (or ↩ / Esc) ends it
  const el = e.target.closest ? e.target.closest(NT_SEL) : null;
  if (ntOn && el && !ntOn.isConnected && el.dataset.id === ntId) {   // its task was redrawn (e.g. after saving): the same task
    const now = (findTask(ntId) || { task: {} }).task.notes;
    if (now === ntShownText) ntOn = el; else if (ntWants(el, findTask(ntId))) showNotesTip(el); else dropNotesTip();   // (its notes changed meanwhile)
  }
  if (ntOn) { if (el === ntOn) ntStay(); else if (!ntGone) ntGone = setTimeout(dropNotesTip, NT_GRACE); }
  if (el === ntFor) return;
  ntFor = el; clearTimeout(ntTimer); ntTimer = null;
  if (!el || el === ntOn || drag || dv || $('#modal').style.display === 'grid') return;
  if (!ntWants(el, findTask(el.dataset.id))) return;
  ntTimer = setTimeout(() => showNotesTip(el), hoverDelay(ntKindOf(el), NT_DELAY));
});
// a task with notes gets the hover note; so does a short day-view block (its label is cut off), notes or not
const ntWants = (el, f) => !!f && (!!f.task.notes || (el.classList.contains('dv-blk') && el.classList.contains('short')));
let ntRect = null;   // where the task was when its note opened (the note is placed beside it)
function placeNotesTip() {
  const r = ntRect, w = ntip.offsetWidth, h = ntip.offsetHeight;
  ntip.style.left = clamp(r.left + 10, 8, innerWidth - w - 8) + 'px';
  ntip.style.top = (r.bottom + h + 6 < innerHeight ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
}
function showNotesTip(el) {
  const f = findTask(el.dataset.id);
  if (!el.isConnected || !ntWants(el, f) || drag || dv || el.querySelector('.inl') || menu.style.display === 'block') return;
  openNotesTip(el, f);
  ntKind = ntKindOf(el); hoverShown(ntKind);
}
function openNotesTip(el, f) {   // (also for a task without notes, to write some: editNotes)
  dropNotesTip();
  // a short day-view block shows only part of its label, so the note carries its time and thread too; a calendar
  // chip with notes has no hover title (it would cover this), so its path goes here instead
  const p = el.classList.contains('dv-blk') && el.classList.contains('short') && planOf(f.task);
  const sub = p ? `${fmtSpan(p.start, p.dur)} · ${f.t.name}` : el.classList.contains('chip') ? [f.p.name, ...f.path].join(' › ') + (isLoose(f.p, f.t) ? '' : ` #${f.i + 1}`) : '';
  ntip.style.setProperty('--c', colorOf(f.t));
  // a short block's checkbox is hard to hit, so its note carries one too (ticking it is the same as ticking the block)
  const ck = p ? `<input type="checkbox" data-act="done" data-id="${f.task.id}" ${f.task.done ? 'checked' : ''}>` : '';
  ntip.innerHTML = `<div class="nt-t ${ck ? 'ck' : ''}">${ck}<span>${esc(f.task.title)}</span></div>${sub ? `<div class="tm">${esc(sub)}</div>` : ''}${f.task.notes ? `<div class="nt-b">${linkifyNotes(f.task.notes)}</div>` : ''}`;
  ntip.style.display = 'block'; ntip.scrollTop = 0;
  ntOn = el; ntId = f.task.id; ntShownText = f.task.notes; ntRect = el.getBoundingClientRect();
  placeNotesTip();
}
// editing in place: double-click the note's text, or the task menu's "Add notes" / "Edit notes" (editNotes). ↩ saves
// and goes back to showing the note (⇧↩ is a new line), Esc goes back without saving, and pressing anywhere else saves
// and closes it. Saving it empty removes the notes (and the note closes).
ntip.addEventListener('dblclick', e => {
  if (!e.target.closest('.nt-b') || ntEdit || !ntId || e.target.closest('a')) return;   // (a link: just opens it)
  e.preventDefault(); getSelection().removeAllRanges();
  editInTip();
});
function editInTip() {
  const f = findTask(ntId); if (!f || ntEdit) return;
  const id = ntId, cur = f.task.notes || '', b = ntip.querySelector('.nt-b');
  ntip.style.width = clamp(Math.max(ntip.offsetWidth, 300), 0, Math.min(340, innerWidth - 16)) + 'px';   // room to type
  const ta = document.createElement('textarea'); ta.className = 'nt-ed'; ta.value = cur; ta.spellcheck = true;
  ta.placeholder = 'Anything to remember for this task';
  const k = document.createElement('div'); k.className = 'nt-k'; k.textContent = '↩ to save · Esc to cancel';
  if (b) b.replaceWith(ta); else ntip.append(ta);   // (no notes yet: below the title)
  ta.after(k);
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  // done: back to showing the note (keep = stay open); saving an empty note removes it (and the note closes)
  const done = (save, keep) => {
    if (ntEdit !== ed) return; ntEdit = null;
    const v = ta.value.trim();
    if (save && v !== cur.trim()) setTaskNotes(id, v);
    const now = (findTask(id) || { task: {} }).task.notes;
    if (!keep || !now) { if (keep) dropNotesTip(); return; }   // (a short block's note stays open once it's hovered again)
    const nb = document.createElement('div'); nb.className = 'nt-b'; nb.innerHTML = linkifyNotes(now); ntShownText = now;
    ta.replaceWith(nb); k.remove(); ntip.style.width = ''; placeNotesTip();
  };
  const ed = { ta, save: () => done(true, false) };
  ntEdit = ed;
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); done(true, true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(false, true); }
  });
  fit(); placeNotesTip();
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}
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
