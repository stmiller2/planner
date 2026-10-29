'use strict';
/* The scratch board: a panel on the right of the calendar and day view for one-off to-dos that belong to no project.
   They're state.scratch = [{ id, title, done }] (no dates; they stay until deleted; ops in core/ops.js).
   Adding works like the sidebar: the "+ Add task" box at the end, or click the seam between two rows for a box right
   there; Enter adds and keeps the box open for the next one, Esc stops, a multi-line paste adds one task per line.
   Rows can be ticked off, renamed (double-click), deleted and dragged to reorder; "Clear done" deletes the ticked
   ones. The panel resizes from its left edge and collapses to a slim tab (drag it narrow, double-click the edge, the
   » button, or X); its width is ui.scw (0 = collapsed), shown through --scw on #app (#app's third grid column; day
   view stops short of it; the header lines up with it). */
const SC_MIN = 100, SC_TAB = 30;   // narrower than SC_MIN while dragging = collapse; the collapsed tab's width
let scAdd = null;      // open new-task box while typing: { beforeId } (null = at the end)
let scFocus = false;   // put the cursor in that box after the next draw
let scDrag = null;     // id of the scratch task being dragged
const scratch = () => state.scratch || [];

function setScw(w) {
  ui.scw = w; ui.scratchOpen = !!w; if (w) ui.scwLast = w;
  $('#app').style.setProperty('--scw', (w || SC_TAB) + 'px');
  $('#app').classList.toggle('scon', !!w);
}
function renderScratch() {
  const el = scEl;
  setScw(ui.scw);
  const list = scratch(), nDone = list.filter(s => s.done).length, nOpen = list.length - nDone;
  if (!ui.scw) {
    el.innerHTML = `<button class="sc-tab" data-act="sc-show" title="Show scratch board (x)">${ICON.dleft}<span>Scratch board</span>${nOpen ? `<b>${nOpen}</b>` : ''}</button>`;
    return;
  }
  const old = el.querySelector('.sc-add:not(.idle)'), keep = old ? old.value : '', oldList = el.querySelector('.sc-list'), top = oldList ? oldList.scrollTop : 0;
  const box_ = (idle) => `<input class="add sc-add ${idle ? 'idle' : ''}" placeholder="${idle ? '+ Add task' : 'New task (Enter to add, Esc to stop)'}">`;
  let rows = '';
  list.forEach(s => {
    if (scAdd && scAdd.beforeId === s.id) rows += box_(false);
    rows += `<div class="sc-row ${s.done ? 'done' : ''}" draggable="true" data-sid="${s.id}">
      <input type="checkbox" data-act="sc-done" data-id="${s.id}" ${s.done ? 'checked' : ''}>
      <span class="title" data-act="rename-s" data-id="${s.id}">${esc(s.title)}</span>
      <span class="acts"><button class="ic" data-act="sc-del" data-id="${s.id}" title="Delete">${ICON.trash}</button></span></div>`;
  });
  rows += box_(!(scAdd && !scAdd.beforeId));
  el.innerHTML = `
    <div class="sc-head">
      <div class="sc-ttl"><h2>Scratch board</h2><div class="sc-sub">Unscheduled one-off tasks</div></div>
      <span class="sc-btns">${nDone ? `<button class="ic" data-act="sc-clear" data-hint="Delete completed tasks" aria-label="Delete completed tasks">${ICON.clearDone}</button>` : ''}<button class="ic" data-act="sc-hide" data-hint="Collapse (x)" aria-label="Collapse">${ICON.dright}</button></span>
    </div>
    <div class="sc-list">${rows}</div>`;
  el.querySelector('.sc-list').scrollTop = top;
  const inp = el.querySelector('.sc-add:not(.idle)');
  if (inp) { inp.value = keep; if (scFocus) inp.focus(); }
  scFocus = false;
}

/* ---------- typing new tasks ---------- */
const scEl = $('#scratch');
const scBox = e => e.target.closest && e.target.closest('.sc-add');
function scStop() { if (!scAdd) return; scAdd = null; renderScratch(); }
// N (while the board is open): the new-task box at the end, ready to type
function scNew() { scAdd = { beforeId: null }; scFocus = true; renderScratch(); }
scEl.addEventListener('focusin', e => {   // the idle "+ Add task" box becomes the box for typing at the end
  const b = scBox(e); if (!b || !b.classList.contains('idle')) return;
  if (scAdd && scAdd.beforeId) { scAdd = { beforeId: null }; scFocus = true; renderScratch(); return; }   // (closes a box open higher up)
  scAdd = { beforeId: null }; b.classList.remove('idle'); b.placeholder = 'New task (Enter to add, Esc to stop)';
});
scEl.addEventListener('focusout', e => {   // leaving a box empty closes it (not when it's only being redrawn)
  const b = scBox(e); if (!b || rendering || b.value.trim()) return;
  setTimeout(() => { if (!document.activeElement || !document.activeElement.closest('.sc-add')) scStop(); }, 0);
});
scEl.addEventListener('keydown', e => {
  const b = scBox(e); if (!b) return;
  if (e.key === 'Enter') {
    const v = b.value; b.value = ''; scFocus = true;
    const ids = addScratch([v], scAdd && scAdd.beforeId);
    if (!ids.length) renderScratch();   // (nothing typed: just keep the box)
  } else if (e.key === 'Escape') { e.stopPropagation(); b.value = ''; b.blur(); scStop(); }
});
scEl.addEventListener('paste', e => {
  const b = scBox(e); if (!b) return;
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (/\r?\n/.test(text.trim())) { e.preventDefault(); scFocus = true; addScratch(text.split(/\r?\n/), scAdd && scAdd.beforeId); }
});

/* click-to-insert: hovering the seam between two rows (or just under the last one) shows the "+" line; clicking
   there opens a new-task box at exactly that spot */
function scSeam(e) {
  if (scDrag || e.target.closest('input, button, .inl')) return null;
  const listEl = e.target.closest('.sc-list'); if (!listEl) return null;
  const rows = $$('.sc-row', listEl), y = e.clientY;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (Math.abs(y - r.top) <= 4) return { beforeId: rows[i].dataset.sid, y: r.top, x: r.left };
    if (Math.abs(y - r.bottom) <= 4) return { beforeId: rows[i + 1] ? rows[i + 1].dataset.sid : null, y: r.bottom, x: r.left };
  }
  return null;
}
scEl.addEventListener('mousemove', e => {
  const s = scSeam(e);
  if (!s) return hideInsline();
  showGuide(insline, s.y, s.x, e.target.closest('.sc-list').getBoundingClientRect().right);
});
scEl.addEventListener('mouseleave', hideInsline);
scEl.addEventListener('scroll', hideInsline, true);
scEl.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const s = scSeam(e); if (!s) return;
  e.preventDefault(); hideInsline();
  scAdd = { beforeId: s.beforeId }; scFocus = true; renderScratch();
});

/* ---------- dragging rows to reorder ---------- */
// where a drop at y lands: before which row (null = the end), and the guide line's height
function scDropAt(listEl, y) {
  const rows = $$('.sc-row', listEl);
  for (const r of rows) { const b = r.getBoundingClientRect(); if (y < b.top + b.height / 2) return { beforeId: r.dataset.sid, y: b.top, x: b.left }; }
  const last = rows[rows.length - 1], b = last && last.getBoundingClientRect();
  return { beforeId: null, y: b ? b.bottom : listEl.getBoundingClientRect().top, x: b ? b.left : listEl.getBoundingClientRect().left };
}
const scNoop = (id, beforeId) => { const L = scratch(), i = L.findIndex(s => s.id === id); return beforeId === id || (L[i + 1] ? L[i + 1].id : null) === beforeId; };
scEl.addEventListener('dragstart', e => {
  const row = e.target.closest && e.target.closest('.sc-row'); if (!row) return;
  scDrag = row.dataset.sid; hideInsline();
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.textContent.trim());
  setTimeout(() => row.classList.add('dragging'), 0);
});
scEl.addEventListener('dragover', e => {
  const listEl = scDrag && e.target.closest('.sc-list'); if (!listEl) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const at = scDropAt(listEl, e.clientY);
  if (scNoop(scDrag, at.beforeId)) dropline.style.display = 'none';
  else showGuide(dropline, at.y, at.x, listEl.getBoundingClientRect().right);
});
scEl.addEventListener('drop', e => {
  const listEl = scDrag && e.target.closest('.sc-list'); if (!listEl) return;
  e.preventDefault(); dropline.style.display = 'none';
  const at = scDropAt(listEl, e.clientY), id = scDrag; scDrag = null;
  if (!scNoop(id, at.beforeId)) moveScratch(id, at.beforeId);
});
document.addEventListener('dragend', () => {
  if (!scDrag) return;
  scDrag = null; dropline.style.display = 'none'; $$('.sc-row.dragging').forEach(r => r.classList.remove('dragging'));
});

/* ---------- resizing / collapsing (the panel's left edge) ---------- */
const scRz = $('.sc-rz');
scRz.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault(); scRz.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
  const move = ev => {
    let w = Math.round(innerWidth - ev.clientX); if (w < SC_MIN) w = 0;
    w = Math.min(w, Math.round(innerWidth * 0.5));
    const flip = !!w !== !!ui.scw; setScw(w); if (flip) renderScratch();
  };
  const up = () => {
    scRz.removeEventListener('pointermove', move); scRz.removeEventListener('pointerup', up); document.body.classList.remove('resizing');
    saveUI(); render();   // (day view's timeline redraws for its new width; the calendar refits itself)
  };
  scRz.addEventListener('pointermove', move); scRz.addEventListener('pointerup', up);
});
scRz.addEventListener('dblclick', () => toggleScratch());
// open / close the board (X, the » button, the collapsed tab); it stays that way until you switch views
function toggleScratch(open = !ui.scw) { setScw(open ? Math.max(SC_MIN, ui.scwLast || 280) : 0); saveUI(); render(); }
// going to the calendar or day view: open or close the board as Settings says for that view (no redraw: the caller does)
function scratchForView() {
  if (ui.scratchRemember) return;   // (Settings: "Remember open / closed")
  setScw(ui[ui.dayView ? 'scratchDay' : 'scratchCal'] ? Math.max(SC_MIN, ui.scwLast || 280) : 0);
}
