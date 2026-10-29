'use strict';
/* Conflicts (holidays, travel…) in the UI: the sidebar section and its "+ Conflict" form, dragging conflict bars
   (move / stretch, on the calendar and in day view), and hover highlighting. The bars themselves are drawn by
   renderCal (calendar.js) and renderDayTimeline (dayview.js); the data rules are in core/model.js and core/ops.js. */
// "+ Conflict" opens a little form: a name, a start date and (optionally) an end date; Enter adds it
let cfAdding = false, cfDraft = { n: '', s: '', e: '', f: 'n' };
function addConflict() { cfAdding = true; cfDraft = { n: '', s: '', e: '', f: 'n' }; render(); }
function submitConflict() {
  const box = $('.cfadd'); if (!box) return;
  const ni = $('.cfa-n', box), si = $('.cfa-s', box), ei = $('.cfa-e', box);
  const st = parseDateText(si.value), en = parseDateText(ei.value, st || todayISO());
  if (!st) { si.classList.add('bad'); si.focus(); return; }
  if (en === null || (en && en < st)) { ei.classList.add('bad'); ei.focus(); return; }
  const c = { id: uid(), title: ni.value.trim() || 'Conflict', start: st, end: en || st };
  cfAdding = false; dhint.style.display = 'none';
  mutate(() => { state.conflicts = state.conflicts || []; state.conflicts.push(c); });
}
function conflictRow(c) {
  const span = c.start ? `<button class="date" data-act="cf-s" data-id="${c.id}" title="${fmtLong(c.start)}">${fmtShort(c.start)}</button>
      ${c.end !== c.start ? `<span class="cf-to">–</span><button class="date" data-act="cf-e" data-id="${c.id}" title="${fmtLong(c.end)}">${fmtShort(c.end)}</button>`
        : `<button class="mini cf-plus" data-act="cf-e" data-id="${c.id}">+ end</button>`}`
    : `<button class="date none" data-act="cf-s" data-id="${c.id}">no date</button>`;
  return `<div class="cfrow" data-cid="${c.id}">
    <span class="cfsw"></span>
    <span class="title" data-act="rename-c" data-id="${c.id}">${esc(c.title)}</span>
    <span class="rt"><span class="acts"><button class="ic" data-act="del-c" data-id="${c.id}" title="Delete">${ICON.trash}</button></span>${span}</span>
  </div>`;
}
// the sidebar lists conflicts that haven't passed yet; past ones stay on the calendar and are kept under Archive
const pastConfs = () => confs().filter(c => c.start && c.end < todayISO());
function renderConflicts() {
  const today = todayISO(), key = c => c.start || '9999';
  const list = confs().filter(c => !c.start || c.end >= today).sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  const form = cfAdding ? `<div class="cfadd">
      <input class="cfa-n" placeholder="Name, e.g. Thanksgiving" spellcheck="false">
      <div class="cfa-d"><input class="cfa-s" placeholder="Start" spellcheck="false"><span class="cf-to">–</span><input class="cfa-e" placeholder="End (optional)" spellcheck="false">
        <button class="ic" data-act="cf-cancel">${ICON.x}</button></div>
    </div>` : '';
  return `<section class="cfsec">
    <div class="sb-head cfh"><h2>Conflicts</h2><button class="mini" data-act="add-cf">+ Conflict</button></div>
    <div class="cflist">${form}${list.map(conflictRow).join('') || (cfAdding ? '' : '<div class="empty small cfnone">No upcoming conflicts</div>')}</div>
  </section>`;
}
// keep what's typed in the form across re-renders, and its focus
function syncConflictForm() {
  const box = $('.cfadd'); if (!box) return;
  const f = { n: $('.cfa-n', box), s: $('.cfa-s', box), e: $('.cfa-e', box) };
  f.n.value = cfDraft.n; f.s.value = cfDraft.s; f.e.value = cfDraft.e;
  const el = f[cfDraft.f] || f.n; el.focus(); el.setSelectionRange(el.value.length, el.value.length);
}
document.addEventListener('input', e => {
  const box = e.target.closest && e.target.closest('.cfadd'); if (!box) return;
  cfDraft = { n: $('.cfa-n', box).value, s: $('.cfa-s', box).value, e: $('.cfa-e', box).value, f: e.target.classList.contains('cfa-s') ? 's' : e.target.classList.contains('cfa-e') ? 'e' : 'n' };
  if (e.target.matches('.cfa-s')) dateHint(e.target);
  if (e.target.matches('.cfa-e')) dateHint(e.target, { allowEmpty: true, emptyText: 'one day', min: parseDateText($('.cfa-s', box).value) || undefined });
});
document.addEventListener('focusin', e => {
  if (!e.target.closest || !e.target.closest('.cfadd')) return;
  cfDraft.f = e.target.classList.contains('cfa-s') ? 's' : e.target.classList.contains('cfa-e') ? 'e' : 'n';
  if (e.target.matches('.cfa-s')) dateHint(e.target);
  else if (e.target.matches('.cfa-e')) dateHint(e.target, { allowEmpty: true, emptyText: 'one day', min: parseDateText($('.cfa-s', e.target.closest('.cfadd')).value) || undefined });
  else dhint.style.display = 'none';
});
document.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('.cfadd')) dhint.style.display = 'none'; });
document.addEventListener('keydown', e => {
  const box = e.target.closest && e.target.closest('.cfadd'); if (!box) return;
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); submitConflict(); }
  else if (e.key === 'Escape') { cfAdding = false; dhint.style.display = 'none'; render(); }
}, true);
// clicking elsewhere closes an untouched form
document.addEventListener('pointerdown', e => {
  if (cfAdding && !e.target.closest('.cfadd') && !e.target.closest('[data-act="add-cf"]') && !cfDraft.n && !cfDraft.s && !cfDraft.e) { cfAdding = false; dhint.style.display = 'none'; setTimeout(render, 0); }
});

let cfDrag = null;
const calDayAt = (x, y) => { const el = document.elementsFromPoint(x, y).find(n => n.classList && n.classList.contains('day') && n.closest('#grid')); return el ? el.dataset.date : null; };
// start dragging conflict `id`: dayAt(x, y) says which day the pointer is over; redraw shows it live
function cfDragStart(e, id, mode, dayAt, redraw, d0) {
  const c = confs().find(x => x.id === id); d0 = d0 || dayAt(e.clientX, e.clientY); if (!c || !c.start || !d0) return false;
  cfDrag = { id, mode, d0, s0: c.start, e0: c.end, moved: false, dayAt, redraw };
  document.body.classList.add(mode === 'move' ? 'cf-moving' : 'cf-sizing');
  e.preventDefault(); e.stopPropagation();
  return true;
}
grid.addEventListener('pointerdown', e => {
  const b = e.target.closest('.cfb'); if (!b || e.button !== 0 || e.target.closest('.inl')) return;
  cfDragStart(e, b.dataset.cid, e.target.closest('.h.l') ? 'l' : e.target.closest('.h.r') ? 'r' : 'move', calDayAt, () => renderCal());
});
document.addEventListener('pointermove', e => {
  if (!cfDrag) return;
  const c = confs().find(x => x.id === cfDrag.id), d = cfDrag.dayAt(e.clientX, e.clientY); if (!c || !d) return;
  const k = diffDays(d, cfDrag.d0); let a = cfDrag.s0, b = cfDrag.e0;
  if (cfDrag.mode === 'move') { a = addDays(a, k); b = addDays(b, k); }
  else if (cfDrag.mode === 'l') { a = addDays(a, k); if (a > b) a = b; }
  else { b = addDays(b, k); if (b < a) b = a; }
  if (a !== c.start || b !== c.end) { c.start = a; c.end = b; touch(); cfDrag.moved = true; cfDrag.redraw(); }   // shown live; saved on release
});
document.addEventListener('pointerup', () => {
  if (!cfDrag) return;
  const d = cfDrag, c = confs().find(x => x.id === d.id); cfDrag = null;
  document.body.classList.remove('cf-moving', 'cf-sizing');
  if (!c) return;
  const a = c.start, b = c.end; c.start = d.s0; c.end = d.e0; touch();   // put it back, then make the change as one undoable step
  if (d.moved && (a !== d.s0 || b !== d.e0)) mutate(() => { c.start = a; c.end = b; }); else if (d.moved) d.redraw();
});
// hovering a conflict on the calendar or in the sidebar picks it out in both
let cfLit = false;   // some conflict is picked out (so the common case, nothing to undo, costs nothing)
document.addEventListener('mouseover', e => {
  const h = e.target.closest && e.target.closest('.cfb, .cfrow'), id = h && (h.dataset.cid);
  if (!id && !cfLit) return;
  $$('.cfb.hl, .cfrow.hl').forEach(x => { if (x.dataset.cid !== id) x.classList.remove('hl'); });
  if (id && !cfDrag) { $$(`.cfb[data-cid="${id}"], .cfrow[data-cid="${id}"]`).forEach(x => x.classList.add('hl')); cfLit = true; }
  else if (!id) cfLit = false;
});
