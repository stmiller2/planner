'use strict';
/* Day view interactions: click-between-tasks to add, hover tooltips, the start / end time popover, dragging
   conflicts in day view, and dragging tasks onto / around the timeline (place, move, resize, remove, reorder). */
// "click between tasks" in the day list: a + line under a task, or just above the first task under a thread
// heading; clicking opens a new-task box there
function dvSeam(e) {
  if (dv || e.target.closest('input, button, select, .dv-dh')) return null;
  const list = $('#dayview .dv-list'); if (!list || !list.contains(e.target)) return null;
  const right = list.getBoundingClientRect().right;
  for (const it of $$('#dayview .dv-item[data-id]')) {
    const r = it.getBoundingClientRect(), grp = it.closest('.dv-grp');
    const at = grp.querySelector('.dv-item[data-id]') === it && e.clientY >= r.top - 6 && e.clientY <= r.top + 4 ? { before: true, y: r.top - 2 }
      : e.clientY >= r.bottom - 5 && e.clientY <= r.bottom + 5 ? { y: r.bottom + 2 } : null;
    if (at) return { id: it.dataset.id, tid: grp.dataset.tid, day: (findTask(it.dataset.id) || {}).task?.date || ui.dayView, x: r.left, right, ...at };
  }
  return null;
}
$('#dayview').addEventListener('mousemove', e => {
  const s = dvSeam(e);
  if (!s) { if (!e.target.closest('#tree')) hideInsline(); return; }
  showGuide(insline, s.y, s.x, s.right);
});
$('#dayview').addEventListener('mouseleave', hideInsline);
$('#dayview').addEventListener('keydown', e => {
  if (!e.target.classList.contains('dvadd')) return;
  if (e.key === 'Enter') {
    const v = e.target.value; e.target.value = '';
    addDayTasks(e.target.dataset.tid, [v], dvAdd && dvAdd.afterId, dvAdd && dvAdd.day, dvAdd && dvAdd.beforeId);
  } else if (e.key === 'Escape') { e.stopPropagation(); dvAdd = null; renderDay(); }
});
$('#dayview').addEventListener('paste', e => {
  if (!e.target.classList.contains('dvadd')) return;
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!/\r?\n/.test(text.trim())) return;
  e.preventDefault();
  addDayTasks(e.target.dataset.tid, text.split(/\r?\n/), dvAdd && dvAdd.afterId, dvAdd && dvAdd.day, dvAdd && dvAdd.beforeId);
});
$('#dayview').addEventListener('focusout', e => {
  if (!e.target.classList.contains('dvadd') || rendering || e.target.value.trim()) return;
  setTimeout(() => { if (dvAdd && !document.activeElement.closest('.dvadd')) { dvAdd = null; renderDay(); } }, 0);
});

// the full project › thread › sub path for a thread heading in the list, only after hovering a moment (so it doesn't
// cover what's below while you work; once one has shown, the next opens at once: hoverDelay, dom.js). (Short timeline
// blocks get the hover note instead, with its own rules: notes.js)
const dvtip = $('#dvtip');
let tipTimer = null, tipFor = null;
function hideTip() { clearTimeout(tipTimer); tipTimer = null; tipFor = null; if (dvtip.style.display === 'block') hoverGone('th'); dvtip.style.display = 'none'; }
$('#dayview').addEventListener('mouseover', e => {
  const b = e.target.closest('.dv-th');
  if (!b || dv) return hideTip();
  if (b === tipFor) return;
  hideTip(); tipFor = b;
  tipTimer = setTimeout(() => {
    if (!b.isConnected || dv) return;
    const x = findThread(b.closest('.dv-grp').dataset.tid); if (!x) return;
    dvtip.style.setProperty('--c', colorOf(x.t));
    dvtip.innerHTML = `<div>${esc([x.p.name, ...x.path].join(' › '))}</div>`;
    const r = b.getBoundingClientRect(); dvtip.style.display = 'block'; hoverShown('th');
    const w = dvtip.offsetWidth, h = dvtip.offsetHeight;
    dvtip.style.left = Math.min(innerWidth - w - 8, r.left + 10) + 'px';
    dvtip.style.top = (r.bottom + h + 6 < innerHeight ? r.bottom + 4 : r.top - h - 4) + 'px';
  }, hoverDelay('th', 1250));
});
$('#dayview').addEventListener('mouseleave', hideTip);

/* single click on a timeline block or a list item: a small popover to type exact start / end times.
   Typed times aren't snapped. Start and end are set independently (left empty, the end keeps the current length, or an hour).
   Enter (or clicking away) saves, Esc cancels, ↑ / ↓ step by the snap interval (⇧ for an hour). */
let tpop = null, tpopTimer = null, dvNoClick = 0;
const tpEl = $('#tpop');
function openTimePop(id, x, y) {
  const f = findTask(id); if (!f || !f.task.date) return;
  hideTip(); closeTimePop(true);
  const p = planOf(f.task);
  tpop = { id, scroll: [($('#dayview .dv-scroll') || {}).scrollTop, ($('#dayview .dv-list') || {}).scrollTop], dur: p ? p.dur : DEFAULT_DUR };
  tpEl.style.setProperty('--c', colorOf(f.t));
  tpEl.innerHTML = `<button class="ic tp-x" title="Close">${ICON.x}</button>
    <div class="tp-h">${esc(f.task.title)}</div>
    <div class="tp-row"><label>Start<input class="tp-s" spellcheck="false" autocomplete="off"></label><span class="tp-dash">–</span><label>End<input class="tp-e" spellcheck="false" autocomplete="off"></label></div>
    <div class="tp-f"><span class="tp-d"></span>${p ? '<button class="mini tp-clear">Take off timeline</button>' : ''}</div>
    <div class="tp-k" title="Hold ⇧ Shift with ↑ / ↓ to step by an hour">Enter saves · ↑↓ ±${ui.snap} min · Esc cancels</div>`;
  fillTimePop();
  tpEl.style.display = 'block';
  const w = tpEl.offsetWidth, h = tpEl.offsetHeight;
  tpEl.style.left = clamp(x + 12, 8, innerWidth - w - 8) + 'px';
  tpEl.style.top = (y + 12 + h < innerHeight - 8 ? y + 12 : Math.max(8, y - h - 12)) + 'px';
  const si = tpEl.querySelector('.tp-s'); si.focus(); si.select();
}
// put the task's current times in the fields (blank for a task that isn't on the timeline yet)
function fillTimePop() {
  const f = findTask(tpop.id), p = planOf(f.task);
  tpEl.querySelector('.tp-s').value = p ? fmtTime(p.start) : '';
  tpEl.querySelector('.tp-e').value = p ? fmtEnd(p.start + p.dur) : '';
  if (p) tpop.dur = p.dur;
  checkTimePop();
}
// read both fields: { start, end } if they make a valid slot, otherwise null (and mark what's wrong)
function checkTimePop() {
  const f = findTask(tpop.id), p = f && planOf(f.task);
  const si = tpEl.querySelector('.tp-s'), ei = tpEl.querySelector('.tp-e'), d = tpEl.querySelector('.tp-d');
  const s = parseTime(si.value, p ? p.start : 9 * 60, false), e = parseTime(ei.value, s ?? (p ? p.start + p.dur : 10 * 60), true);
  si.classList.toggle('bad', Number.isNaN(s)); ei.classList.toggle('bad', Number.isNaN(e) || (s != null && e != null && e <= s));
  d.classList.remove('bad');
  if (s == null && e == null) { d.textContent = p ? '' : 'Not on the timeline yet'; return null; }
  if (Number.isNaN(s) || Number.isNaN(e) || s == null) { d.textContent = 'Type a time like 9:30, 2pm or 14:00'; d.classList.add('bad'); return null; }
  const end = e == null ? Math.min(1440, s + tpop.dur) : e;
  if (end <= s) { d.textContent = 'End must be after start'; d.classList.add('bad'); return null; }
  d.textContent = fmtDur(end - s);
  return { start: s, end };
}
function commitTimePop() {
  if (!tpop) return;
  const r = checkTimePop(); if (!r) return;
  const f = findTask(tpop.id); if (!f) return;
  const p = planOf(f.task);
  if (p && p.start === r.start && p.dur === r.end - r.start) return;
  tpop.dur = r.end - r.start;
  mutate(() => { f.task.plan = { date: f.task.date, start: r.start, dur: r.end - r.start }; });
}
function closeTimePop(save) {
  clearTimeout(tpopTimer);
  if (!tpop) return;
  if (save) commitTimePop();
  tpop = null; tpEl.style.display = 'none'; tpEl.innerHTML = '';
}
// after a re-render: drop the popover if its task left the view, otherwise refresh it (unless it's being typed in)
function syncTimePop() {
  if (!tpop) return;
  const f = findTask(tpop.id);
  if (!f || !ui.dayView || !dvDays().includes(f.task.date)) return closeTimePop(false);
  if (!tpEl.contains(document.activeElement)) fillTimePop();
}
$('#dayview').addEventListener('click', e => {
  if (e.detail !== 1 || Date.now() - dvNoClick < 300 || e.target.closest('input, button, .inl')) return;
  const el = e.target.closest('.dv-blk[data-id], .dv-item[data-id]'); if (!el) return;
  const id = el.dataset.id, x = e.clientX, y = e.clientY;
  clearTimeout(tpopTimer);
  // only the title can be double-clicked (to rename), so only a click there waits to see if a second one follows
  if (e.target.closest('.tt')) tpopTimer = setTimeout(() => openTimePop(id, x, y), 250);
  else openTimePop(id, x, y);
});
tpEl.addEventListener('input', () => checkTimePop());   // start and end are independent: neither moves the other
tpEl.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') return closeTimePop(false);
  if (e.key === 'Enter') { commitTimePop(); if (checkTimePop()) closeTimePop(false); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const inp = e.target.closest('input'); if (!inp) return;
    e.preventDefault();
    const isEnd = inp.classList.contains('tp-e'), f = findTask(tpop.id), p = planOf(f.task);
    const cur = parseTime(inp.value, p ? (isEnd ? p.start + p.dur : p.start) : 9 * 60, isEnd);
    const base = Number.isFinite(cur) ? cur : (isEnd ? (p ? p.start + p.dur : 10 * 60) : (p ? p.start : 9 * 60));
    const step = (e.shiftKey ? 60 : ui.snap) * (e.key === 'ArrowUp' ? 1 : -1);
    const v = isEnd ? clamp(base + step, ui.snap, 1440) : clamp(base + step, 0, 1440 - ui.snap);
    inp.value = isEnd ? fmtEnd(v) : fmtTime(v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
tpEl.addEventListener('change', () => commitTimePop());   // leaving a field saves it
tpEl.addEventListener('click', e => {
  if (e.target.closest('.tp-x')) return closeTimePop(true);
  if (e.target.closest('.tp-clear')) { const f = findTask(tpop.id); closeTimePop(false); if (f) mutate(() => { delete f.task.plan; }); }
});
// Clicking anywhere else closes it (saving what's typed), and that click does nothing else: it doesn't open
// another block's box, start a drag, tick a checkbox or press a button. Scrolling the timeline or list noticeably
// also closes it.
let tpSwallow = false, tpSwallowedAt = 0;   // tpSwallowedAt: when the last closing click was eaten (0 once a normal click follows)
document.addEventListener('pointerdown', e => {
  tpSwallow = false;
  if (!tpop || tpEl.contains(e.target)) return;
  closeTimePop(true); tpSwallow = true;
  e.stopPropagation(); e.preventDefault();
}, true);
document.addEventListener('click', e => {
  if (tpSwallow) { tpSwallow = false; tpSwallowedAt = Date.now(); e.stopPropagation(); e.preventDefault(); }
  else if (e.detail === 1) tpSwallowedAt = 0;
}, true);
document.addEventListener('contextmenu', e => {
  dvCancel();
  if (tpSwallow) { tpSwallow = false; e.preventDefault(); e.stopPropagation(); }   // it closed the time box: no menu
}, true);
document.addEventListener('dblclick', e => {
  // the closing click was the first half of a double-click: ignore the double-click too
  if (tpSwallowedAt && Date.now() - tpSwallowedAt < 600) { tpSwallowedAt = 0; e.stopPropagation(); e.preventDefault(); return; }
  if (!tpEl.contains(e.target)) closeTimePop(false);                                     // a double-click is a rename, not a time edit
}, true);
document.addEventListener('scroll', e => {
  if (!tpop || !e.target.classList) return;
  const i = e.target.classList.contains('dv-scroll') ? 0 : e.target.classList.contains('dv-list') ? 1 : -1;
  if (i >= 0 && Math.abs(e.target.scrollTop - tpop.scroll[i]) > 30) closeTimePop(true);
}, true);
// conflicts in day view: drag the strip's bars (move / stretch an end) or a tag in the list onto another day (move)
const dvDayAt = x => {   // the day column under x (counting on past the visible days, so you can drag beyond them)
  const cols = $$('#dayview .dv-col'); if (!cols.length) return null;
  const r = cols[0].getBoundingClientRect(), w = r.width || 1;
  return addDays(cols[0].dataset.date, Math.floor((x - r.left) / w));
};
const dvListDayAt = (x, y) => {   // a day's section in the list, or a day column, under the pointer
  const el = document.elementsFromPoint(x, y).find(n => n.dataset && n.dataset.date && (n.classList.contains('dv-day') || n.classList.contains('dv-col')));
  return el ? el.dataset.date : null;
};
$('#dayview').addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.ctrlKey || e.target.closest('.inl')) return;   // (Ctrl-click on a Mac = right-click)
  const b = e.target.closest('.dv-cfb'), t = e.target.closest('.dv-cfp');
  if (b) cfDragStart(e, b.dataset.cid, e.target.closest('.h.l') ? 'l' : e.target.closest('.h.r') ? 'r' : 'move', (x) => dvDayAt(x), () => renderDay());
  else if (t) cfDragStart(e, t.dataset.cid, 'move', dvListDayAt, () => renderDay(), t.dataset.day);
}, true);
// dragging: list item -> timeline (place) or to another spot in the list (reorder), block body (move),
// block edge (resize), block -> list (remove)
let dv = null, dvGhost = null;
$('#dayview').addEventListener('pointerdown', e => {
  if (dv) dvCancel();   // (a drag whose release never arrived)
  if (e.button !== 0 || e.ctrlKey) return;
  const seam = dvSeam(e);
  if (seam) { e.preventDefault(); hideInsline(); dvNoClick = Date.now(); dvAdd = seam.before ? { tid: seam.tid, beforeId: seam.id, day: seam.day } : { tid: seam.tid, afterId: seam.id, day: seam.day }; renderDay(); return; }
  if (e.target.closest('input, button, select')) return;
  hideTip();
  const blk = e.target.closest('.dv-blk[data-id]'), item = e.target.closest('.dv-item[data-id]');
  if (!blk && !item) return;
  const f = findTask((blk || item).dataset.id); if (!f) return;
  const p = planOf(f.task);
  const mode = blk ? (e.target.classList.contains('t') ? 'top' : e.target.classList.contains('b') ? 'bottom' : 'move') : 'place';
  dv = { id: f.task.id, date: f.task.date, title: f.task.title, color: colorOf(f.t), mode, el: blk || item, x0: e.clientX, y0: e.clientY, started: false, p0: p ? { ...p } : null, res: null };
  if (blk) dv.offY = e.clientY - blk.getBoundingClientRect().top;
  e.preventDefault();
  window.addEventListener('pointermove', dvMove);
  window.addEventListener('pointerup', dvUp, { once: true });
});
function dvCancel() { if (dv) dvUp(null, true); }
// pressing or letting go of Option mid-drag (without moving) updates what would move, and the gap for it
['keydown', 'keyup'].forEach(t => window.addEventListener(t, e => {
  if (e.key !== 'Alt' || !dv || !dv.started || !dvLastE) return;
  const p = dvLastE; dvMove({ clientX: p.clientX, clientY: p.clientY, target: p.target, altKey: e.type === 'keydown' });
}));
window.addEventListener('pointercancel', dvCancel);
// the day column a drag is aimed at: the one under the pointer (x given), otherwise the task's own day.
// Dropping a task in another visible day's column moves it to that day.
function dvCol(x) {
  let col = $(`#dayview .dv-col[data-date="${dv.date}"]`) || $('#dayview .dv-col');
  if (x !== undefined) {
    const cols = $$('#dayview .dv-col');
    col = cols.find(c => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; })
       || (x < cols[0].getBoundingClientRect().left ? cols[0] : cols[cols.length - 1]);
  }
  const r = col.getBoundingClientRect(), sr = $('#dayview .dv-scroll').getBoundingClientRect();
  return { r, sr, sH: +col.dataset.sh, eH: +col.dataset.eh, date: col.dataset.date };
}
function dvMove(e, rested) {   // rested: called by dvRest once the pointer has paused
  if (!dv) return;
  if (!dv.started) {
    if (Math.hypot(e.clientX - dv.x0, e.clientY - dv.y0) < 4) return;
    dv.started = true; dvtip.style.display = 'none';
    document.body.classList.add(dv.mode === 'top' || dv.mode === 'bottom' ? 'dv-resizing' : 'dv-dragging');
    if (dv.mode === 'place' || dv.mode === 'move') {
      dvGhost = document.createElement('div');
      dvGhost.className = 'dv-blk dv-ghost';
      dvGhost.style.setProperty('--c', dv.color);
      dvGhost.innerHTML = `<div class="bi"><span class="tt">${esc(dv.title)}</span></div><div class="tm"></div>`;
      document.body.appendChild(dvGhost);
    }
    if (dv.mode === 'place') dv.el.classList.add('dragsrc');
  }
  dvLastE = e; if (!dvAuto) dvAuto = requestAnimationFrame(dvAutoScroll);
  const resizing = dv.mode === 'top' || dv.mode === 'bottom';
  const c = dvCol(resizing ? undefined : e.clientX), lo = c.sH * 60, hi = c.eH * 60;
  const toMin = y => lo + (y - c.r.top) / PPM;
  if (resizing) {
    // the edge follows the pointer with a gentle pull toward each time step (softSnap); it lands on the nearest one
    const p = dv.p0, raw = toMin(e.clientY);
    const span = m => dv.mode === 'bottom'
      ? { start: p.start, dur: clamp(m, p.start + ui.snap, hi) - p.start }
      : (() => { const s = clamp(m, lo, p.start + p.dur - ui.snap); return { start: s, dur: p.start + p.dur - s }; })();
    dv.res = span(snapMin(raw)); const soft = span(softSnap(raw, ui.snap));
    dvAim(dv.el, { top: (soft.start - lo) * PPM, height: Math.max(14, soft.dur * PPM - 2) });
    dvRest(e, rested, dv.date, dv.res);
    const tm = dv.el.querySelector('.tm'); if (tm) tm.textContent = fmtSpan(dv.res.start, dv.res.dur);
    dv.el.title = fmtSpan(dv.res.start, dv.res.dur);
    return;
  }
  const dur = dv.p0 ? dv.p0.dur : DEFAULT_DUR;
  const side = $('#dayview .dv-side').getBoundingClientRect();
  const overSide = e.clientX < side.right;
  // a list item dragged within the list: reorder (a gap opens where it will go; over the gap, its target holds)
  if (!(dv.listTarget && dvGap.over(e))) dv.listTarget = dv.mode === 'place' && overSide ? dvListTarget(e) : null;
  else dv.listTarget.ids = movingIds(dv.id, splitHeld(e));   // (over its gap: Option may have changed what moves)
  dvListGap();
  const grid = $('#dayview .dv-grid').getBoundingClientRect();
  const overCol = !overSide && e.clientX >= grid.left && e.clientX <= grid.right + 20 && e.clientY >= c.sr.top && e.clientY <= c.sr.bottom;
  $('#dayview .dv-side').classList.toggle('rm', dv.mode === 'move' && overSide);
  dv.overSide = overSide;
  if (overCol) {
    // the ghost glides up and down with a pull toward each time step (softSnap) and lands on the nearest; it keeps its
    // lane across the column while it moves, and the day makes room for it only once the pointer pauses (dvRest)
    const topMin = toMin(e.clientY - (dv.mode === 'move' ? dv.offY : 12)), fit = m => clamp(m, lo, Math.max(lo, hi - dur));
    const start = fit(snapMin(topMin)), soft = fit(softSnap(topMin, ui.snap));
    dv.res = { start, dur }; dv.target = c.date;
    dvRest(e, rested, c.date, dv.res);
    const ln = dvLane(c), W = c.r.width;
    dvAim(dvGhost, { left: c.r.left + ln.fl * W + 3, width: ln.fw * W - 6, top: c.r.top + (soft - lo) * PPM, height: Math.max(14, dur * PPM - 2) });
    if (dv.mode === 'move') dv.el.style.opacity = '0';
    const other = c.date !== dv.date ? ` · moves${splitHeld(e) ? ' just this task' : ''} to ${DOW[parseD(c.date).getDay()]}` : '';
    dvGhost.querySelector('.tm').textContent = fmtSpan(start, dur) + other;
  } else {
    dv.res = null; dvRest(e, rested, null, null);
    if (dv.mode === 'move') dv.el.style.opacity = '.25';
    dvAim(dvGhost, { left: e.clientX - 16, width: 220, top: e.clientY - 12, height: Math.max(14, Math.min(dur, 60) * PPM - 2) });
    dvGhost.querySelector('.tm').textContent = dv.mode === 'move' && overSide ? 'Remove from timeline'
      : dv.listTarget ? (splitHeld(e) ? 'Move just this task here' : 'Move here') : '';
  }
}
/* Motion while dragging on the timeline, kept calm on a busy day: dvAim sets where the dragged ghost (or the block
   being resized) should be, in px; each frame it eases part of the way there (dvFrame), so it glides rather than
   jumps. While the pointer moves, only that happens: nothing else on the timeline moves, and the ghost keeps its lane
   across the column (dvLane: full width, or the block's own lane). Once the pointer has rested DV_REST ms, dvReflow
   lays the columns out as they'd be after the drop (the dragged block at res in column `date`; null: not on the
   timeline, a moved block back in its old place), the others ease into their lanes (css) and the ghost into its own. */
const DV_REST = 260;
function dvRest(e, rested, date, res) {
  if (rested) { const sl = dvReflow(date, res); if (date && dv.mode !== 'top' && dv.mode !== 'bottom') dv.lane = { date, fl: sl.col / sl.ncol, fw: 1 / sl.ncol }; return; }
  clearTimeout(dv.restT);
  dv.restT = setTimeout(() => { if (dv && dv.started) dvMove(dvLastE || e, true); }, DV_REST);
}
function dvLane(c) {
  if (!dv.lane || dv.lane.date !== c.date) {
    let fl = 0, fw = 1;
    if (dv.mode === 'move' && !dv.lane && c.date === dv.date) { const r = dv.el.getBoundingClientRect(); fl = (r.left - 3 - c.r.left) / c.r.width; fw = (r.width + 6) / c.r.width; }
    dv.lane = { date: c.date, fl, fw };
  }
  return dv.lane;
}
let dvRaf = null;
function dvAim(el, box) {
  if (!dv.goal || dv.goal.el !== el) dv.disp = null;
  dv.goal = { el, box };
  if (!dvRaf) dvRaf = requestAnimationFrame(dvFrame);
}
function dvFrame() {
  dvRaf = null; if (!dv || !dv.goal) return;
  const { el, box } = dv.goal, d = dv.disp || (dv.disp = { ...box }), m = MOTION();
  let more = false;
  for (const p in box) {   // (sideways more slowly than up and down: a change of lane is a calmer move)
    const t = box[p], v = d[p] ?? t, k = !m ? 1 : p === 'left' || p === 'width' ? .17 : .34;
    d[p] = Math.abs(t - v) < .3 ? t : v + (t - v) * k; if (d[p] !== t) more = true; el.style[p] = d[p].toFixed(1) + 'px';
  }
  if (more) dvRaf = requestAnimationFrame(dvFrame);
}
function dvReflow(date, res) {
  const key = date + '|' + (res ? res.start + '|' + res.dur : '');
  if (dv.flow && dv.flow.key === key) return dv.flow.slot;
  let slot = { col: 0, ncol: 1 };
  $$('#dayview .dv-col').forEach(col => {
    const bs = $$('.dv-blk[data-s]', col).filter(el => el !== dv.el || (!res && dv.mode === 'move')).map(el => ({ el, start: +el.dataset.s, end: +el.dataset.s + +el.dataset.d }));
    const me = res && col.dataset.date === date ? { el: dv.mode === 'top' || dv.mode === 'bottom' ? dv.el : null, start: res.start, end: res.start + res.dur } : null;
    if (me) bs.push(me);
    layoutBlocks(bs).forEach(b => {
      if (b === me) slot = { col: b.col, ncol: b.ncol };
      if (b.el) { b.el.style.left = `calc(${b.col} * 100% / ${b.ncol} + 3px)`; b.el.style.width = `calc(100% / ${b.ncol} - 6px)`; }
    });
  });
  dv.flow = { key, slot };
  return slot;
}
// the gap in the day list where a list item would land (dvListTarget)
const dvGap = makeGap();
function dvListGap() {
  const t = dv && dv.listTarget; if (!t || !MOTION()) { dvGap.hide(); if (t) showGuide(dropline, t.line.y, t.line.x, t.line.right); else dropline.style.display = 'none'; return; }
  dropline.style.display = 'none';
  const x = findThread(t.spot.tid), it = $(`#dayview .dv-item[data-id="${t.spot.refId}"]`); if (!x || !it) return dvGap.hide();
  dvGap.show(t.spot.tid + ':' + layoutIndex(layout(x.t), t.spot.refId, t.spot.side), el => it.insertAdjacentElement(t.spot.side === 'before' ? 'beforebegin' : 'afterend', el),
    gapH(t.ids.map(id => $(`#dayview .dv-item[data-id="${id}"]`)), dv.el.offsetHeight));
}
// Where a list item being dragged would land in the list: the nearest gap (before a task, or after the last task
// under a thread heading) among the tasks of its own day. Like the main sidebar, it snaps to the edges of a linked
// chain and moves the whole chain (just the one task with Option). Moving under another thread's heading moves it
// into that thread. Returns { spot, line } or null when it would land where it already is.
function dvListTarget(e) {
  const list = $('#dayview .dv-list'), lr = list.getBoundingClientRect();
  if (e.clientY < lr.top || e.clientY > lr.bottom) return null;
  const scope = $(`#dayview .dv-day[data-date="${dv.date}"]`) || list;
  if (!scope.contains(document.elementFromPoint(lr.left + 20, e.clientY)) && scope !== list) return null;   // other day
  const split = splitHeld(e);
  let best = null;
  for (const grp of $$('.dv-grp', scope)) {
    const items = $$('.dv-item[data-id]', grp); if (!items.length) continue;
    const gaps = items.map(it => ({ it, side: 'before', y: it.getBoundingClientRect().top - 2 }));
    gaps.push({ it: items[items.length - 1], side: 'after', y: items[items.length - 1].getBoundingClientRect().bottom + 2 });
    for (const g of gaps) { const d = Math.abs(e.clientY - g.y); if (!best || d < best.d) best = { ...g, d, tid: grp.dataset.tid }; }
  }
  if (!best) return null;
  const g = findTask(best.it.dataset.id); if (!g) return null;
  const [s, en] = runOf(g.t, g.i), anchor = g.t.tasks[best.side === 'before' ? s : en];
  if (movingIds(dv.id, split).includes(anchor.id)) return null;
  const spot = { tid: best.tid, refId: anchor.id, side: best.side };
  if (isNoopTasks(dv.id, split, spot)) return null;
  const r = best.it.getBoundingClientRect();
  return { spot, ids: movingIds(dv.id, split), line: { y: best.y, x: r.left, right: lr.right } };
}
// while dragging a block (or a task from the list) near the top or bottom edge of the timeline, scroll it,
// faster the closer the pointer is to the edge (and the same for the list while reordering in it)
let dvAuto = null, dvLastE = null;
function dvAutoScroll() {
  dvAuto = null;
  const e = dvLastE; if (!dv || !dv.started || !e) return;
  const list = $('#dayview .dv-list');
  const sc = dv.mode === 'place' && list && e.clientX < list.getBoundingClientRect().right ? list : $('#dayview .dv-scroll');
  if (!sc) return;
  const r = sc.getBoundingClientRect(), Z = 40;
  if (e.clientX < r.left || e.clientX > r.right) return;
  const v = e.clientY < r.top + Z ? -(r.top + Z - e.clientY) : e.clientY > r.bottom - Z ? e.clientY - (r.bottom - Z) : 0;
  if (!v) return;
  const before = sc.scrollTop;
  sc.scrollTop += Math.sign(v) * Math.min(18, Math.ceil(Math.abs(v) / 3));
  if (sc.scrollTop === before) return;                   // already at the very top / bottom
  dvAuto = requestAnimationFrame(dvAutoScroll);           // set first, so dvMove below doesn't start a second loop
  dvMove(e);
}
// cancel: the drag ends without changing anything (a right-click / context menu, or the pointer was lost)
// After a drop, the blocks and list items slide from where they were shown to where they land (flipTo): the dropped
// one from the ghost (or the gap in the list), the rest from where dvReflow had them.
const DV_BLKS = '#dayview .dv-blk[data-id], #dayview .dv-blk[data-fid], #dayview .dv-item[data-id], #dayview .dv-item[data-fid]';
const dvKey = el => (el.classList.contains('dv-blk') ? 'b:' : 'i:') + (el.dataset.id || 'f' + el.dataset.fid);
function dvUp(e, cancel) {
  if (dvAuto) { cancelAnimationFrame(dvAuto); dvAuto = null; } dvLastE = null;
  if (dvRaf) { cancelAnimationFrame(dvRaf); dvRaf = null; }
  window.removeEventListener('pointermove', dvMove); window.removeEventListener('pointerup', dvUp);
  const d = dv; dv = null; if (d) clearTimeout(d.restT);
  const before = d && d.started ? snapRects(DV_BLKS, dvKey) : null;
  if (before && dvGhost && d.res) before.set('b:' + d.id, dvGhost.getBoundingClientRect());
  const gr = dvGap.el && dvGap.el.getBoundingClientRect(); if (before && gr && d.listTarget) before.set('i:' + d.id, gr);
  document.body.classList.remove('dv-dragging', 'dv-resizing');
  if (dvGhost) { dvGhost.remove(); dvGhost = null; }
  dvGap.hide();
  const side = $('#dayview .dv-side'); if (side) side.classList.remove('rm');
  dropline.style.display = 'none';
  if (d && d.el) { d.el.style.opacity = ''; d.el.classList.remove('dragsrc'); }   // (a drop that changes nothing doesn't redraw)
  if (!d || !d.started) return;
  if (cancel) return render();
  dvNoClick = Date.now();   // the click that follows a drag isn't a click on the block
  dvtip.style.display = 'none';
  const f = findTask(d.id); if (!f) return render();
  const settle = () => flipTo(DV_BLKS, dvKey, before, { size: true, ms: 220 });
  if (d.mode === 'move' && d.overSide) { mutate(() => { delete f.task.plan; }); return settle(); }
  if (d.mode === 'place' && d.listTarget) { moveTasksTo(d.id, splitHeld(e), d.listTarget.spot); return settle(); }
  if (!d.res) { render(); return settle(); }
  const target = d.target || f.task.date;
  mutate(() => {
    // another day's column: move the task to that day, like dragging it on the calendar
    // (its linked chain and later tasks follow; with Option only this task moves, unlinked)
    if (target !== f.task.date) applyMove(f.t, f.i, target, splitHeld(e));
    f.task.plan = { date: target, start: d.res.start, dur: d.res.dur };
  });
  settle();
}
