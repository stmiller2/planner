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

const calDayAt = (x, y) => { const el = document.elementsFromPoint(x, y).find(n => n.classList && n.classList.contains('day') && n.closest('#grid')); return el ? el.dataset.date : null; };
// desktop: pressing a conflict's bar (calendar, day view's strip) or its tag in day view's list. Its ends stretch it;
// anywhere else moves it, once the pointer has moved a little (a click, or the first half of a double-click to rename,
// isn't a drag). (Mobile: a long press on a calendar bar, mobile.js.)
function cfPress(e, where, el, mode) {
  const c = confs().find(x => x.id === el.dataset.cid); if (!c || !c.start) return;
  e.preventDefault(); e.stopPropagation();
  if (mode === 'move') cfPend = { where, el, x0: e.clientX, y0: e.clientY };
  else cfLift(where, el, e.clientX, e.clientY, mode);
}
grid.addEventListener('pointerdown', e => {
  const b = e.target.closest('.cfb'); if (!b || MOBILE || e.button !== 0 || e.ctrlKey || e.target.closest('.inl')) return;
  cfPress(e, CF_CAL, b, e.target.closest('.h.l') ? 'l' : e.target.closest('.h.r') ? 'r' : 'move');
});
document.addEventListener('pointermove', e => {
  if (cfPend && !cfMove && Math.hypot(e.clientX - cfPend.x0, e.clientY - cfPend.y0) > 4) { const p = cfPend; cfPend = null; cfLift(p.where, p.el, p.x0, p.y0, 'move'); }
  if (cfMove) cfAim(e.clientX, e.clientY);
});
document.addEventListener('pointerup', () => { cfPend = null; if (cfMove && !MOBILE) cfLand(); });
document.addEventListener('keydown', e => { if (cfMove && e.key === 'Escape') { e.stopPropagation(); cfLand(true); } }, true);
// a right-click (context menu) mid-drag: its release may never arrive, so it goes back
document.addEventListener('contextmenu', () => { cfPend = null; if (cfMove && !MOBILE) cfLand(true); }, true);

/* Moving or stretching a conflict works as moving a task does, on the calendar and in day view alike.
   Moving: it lifts. A copy of what was pressed (a bar, or day view's tag) follows the pointer (.cf-ghost) and its bars
   stay where they are, dimmed (.dragsrc). Stretching: the end follows the pointer smoothly, not day by day.
   Either way, where it would land shows as it goes: an outline where its bar would be (.cf-slot, in the first line free
   of the other conflicts' bars there) and room opening in the days it would newly cover, their tasks easing down to
   make it (.cf-room, as a dragged task opens a gap). Let go: the change is made (one undoable step) and its bar slides
   from the copy, or from the stretched end, into its place while everything around it eases to its new place (flipTo).
   Let go where it started, off the days, or with Esc, and it goes back.
   Where it happens is an object with: dayAt(x, y) (the day under the pointer), row(el) (the left and right ends of the
   row a bar is in: how far a stretched end can go), place(span) → { slots, rooms } (the outline(s) and the room for a
   span), and snap() / after(m, from) (where things are before the change, and the easing into place after it). */
let cfPend = null, cfMove = null;
function cfLift(where, el, x, y, mode) {
  const c = confs().find(z => z.id === el.dataset.cid); if (!c || !c.start) return false;
  closeMenu(); hideLinkLine(); hideTip();
  const r = el.getBoundingClientRect();
  const m = cfMove = { where, mode, id: c.id, d0: el.dataset.day || where.dayAt(x, y) || c.start, s0: c.start, e0: c.end, k: 0, ok: true, el, from: r, x0: x, y0: y, dx: x - r.left, dy: y - r.top, rooms: new Map(), slots: new Map() };
  if (mode === 'move') {
    const g = el.cloneNode(true);
    delete g.dataset.cid; delete g.dataset.day; g.classList.remove('hl', 'nb', 'dragsrc'); g.classList.add('cf-ghost');
    g.removeAttribute('title'); g.querySelectorAll('[data-act]').forEach(n => n.removeAttribute('data-act'));
    Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', gridRow: '', gridColumn: '' });
    document.body.appendChild(g); m.ghost = g;
  } else { m.lim = where.row(el); el.classList.add('cf-stretch'); }
  document.body.classList.add(mode === 'move' ? 'cf-moving' : 'cf-sizing');
  cfAim(x, y);
  return true;
}
// the pointer at x, y: the copy (or the stretched end) follows; the days the conflict would cover from here get ready for it
function cfAim(x, y) {
  const m = cfMove; if (!m) return;
  if (m.ghost) { m.ghost.style.left = (x - m.dx) + 'px'; m.ghost.style.top = (y - m.dy) + 'px'; m.where.bars(m.id).forEach(b => b.classList.add('dragsrc')); }   // (dimmed again after a redraw: a week step)
  else if (m.el.isConnected) {   // the end it's stretched by, where the pointer is (no shorter than a stub, no further than its row)
    const r = m.from, s = m.el.style, MIN = 24;
    if (m.mode === 'r') { const R = clamp(x + (r.right - m.x0), r.left + MIN, m.lim[1]); Object.assign(s, { justifySelf: 'start', width: (R - r.left) + 'px' }); }
    else { const L = clamp(x - (m.x0 - r.left), m.lim[0], r.right - MIN); Object.assign(s, { justifySelf: 'end', width: (r.right - L) + 'px' }); }
  }
  const d = m.where.dayAt(x, y);
  m.ok = !!d; if (d) m.k = diffDays(d, m.d0);
  const span = cfSpanOf(m);
  cfPreview(span && (span[0] !== m.s0 || span[1] !== m.e0) ? span : null);
}
// the dates it would have if let go now: [start, end], or null (nowhere)
function cfSpanOf(m) {
  if (!m.ok) return null;
  const a = addDays(m.s0, m.k), b = addDays(m.e0, m.k);
  return m.mode === 'move' ? [a, b] : m.mode === 'l' ? [a > m.e0 ? m.e0 : a, m.e0] : [m.s0, b < m.s0 ? m.s0 : b];
}
// show where it would land (span: [first, last day]), or nothing (null)
function cfPreview(span) {
  const m = cfMove; if (!m) return;
  const { slots, rooms } = span ? m.where.place(span, m) : { slots: new Map(), rooms: new Map() };
  const quick = MOTION() ? 180 : 0;
  // the outline(s): kept where they're the same, faded out / in where they change
  m.slots.forEach((el, k) => {
    if (slots.has(k) && el.isConnected) return;
    m.slots.delete(k); if (!el.isConnected) return;
    if (quick) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: quick * 0.7 }).onfinish = () => el.remove(); else el.remove();
  });
  slots.forEach((o, k) => {
    if (m.slots.has(k)) return;
    o.parent.insertAdjacentHTML('beforeend', o.html);
    const el = o.parent.lastElementChild; m.slots.set(k, el);
    if (o.grow && quick) { el.style.height = '0px'; void el.offsetHeight; el.style.height = ''; }   // (a new line in day view's strip: it opens)
    if (quick) el.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: quick, easing: EASE_OUT });
  });
  // the room in each day: eases open / shut (css .cf-room, the gap's motion)
  m.rooms.forEach((el, k) => {
    const want = rooms.get(k);
    if (want && el.isConnected && el.parentElement === want.parent) { if (el.style.height !== want.h + 'px') el.style.height = want.h + 'px'; return; }
    m.rooms.delete(k); if (!el.isConnected) return;
    el.classList.add('closing'); el.style.height = '0px'; setTimeout(() => el.remove(), quick);
  });
  rooms.forEach(({ parent, before, h }, k) => {
    if (m.rooms.has(k)) return;
    const el = document.createElement('div'); el.className = 'dgap cf-room'; el.style.height = '0px';
    parent.insertBefore(el, before); void el.offsetHeight; el.style.height = h + 'px';
    m.rooms.set(k, el);
  });
}
// let go (cancel: Esc, or the move called off): the change made, or back as it was. Returns whether it changed.
function cfLand(cancel) {
  const m = cfMove; if (!m) return false;
  const c = confs().find(x => x.id === m.id), span = c && cfSpanOf(m);
  const go = !!(c && !cancel && span && (span[0] !== m.s0 || span[1] !== m.e0) && c.start === m.s0 && c.end === m.e0);
  // where it was let go: the copy, or the stretched bar
  const from = m.ghost ? m.ghost.getBoundingClientRect() : m.el.isConnected ? m.el.getBoundingClientRect() : null;
  const after = go && m.where.snap();   // (where things are now: tasks pushed down by the room opened, the other bars)
  m.slots.forEach(el => el.remove()); m.rooms.forEach(el => el.remove());
  m.where.bars(m.id).forEach(x => x.classList.remove('dragsrc'));
  if (m.el.isConnected) { m.el.classList.remove('cf-stretch'); m.el.style.justifySelf = m.el.style.width = ''; }
  document.body.classList.remove('cf-moving', 'cf-sizing'); cfMove = null;
  if (!go) {
    if (m.ghost) {   // back: the copy returns to what it was lifted from, which then shows again
      const g = m.ghost, src = m.el.isConnected ? m.el : null, to = src ? src.getBoundingClientRect() : m.from;
      if (!MOTION() || !g.animate) { g.remove(); return false; }
      if (src) src.style.opacity = '0';
      g.animate([{ transform: getComputedStyle(g).transform }, { transform: `translate(${(to.left - from.left).toFixed(1)}px,${(to.top - from.top).toFixed(1)}px)` }], { duration: 200, easing: EASE_OUT, fill: 'forwards' })
        .onfinish = () => { g.remove(); if (src) src.style.opacity = ''; };
    } else if (from && m.el.isConnected) cfEaseFrom(m.el, from);   // a stretched end eases back
    return false;
  }
  if (m.ghost) m.ghost.remove();
  mutate(() => { c.start = span[0]; c.end = span[1]; });
  if (MOTION() && after) after(m, from);
  return true;
}
// el (a bar) eases from rect r0 (its place and width then) to where it is now
function cfEaseFrom(el, r0, lifted) {
  const r = el.getBoundingClientRect(), dx = r0.left - r.left, dy = r0.top - r.top;
  if (Math.abs(dx) < .5 && Math.abs(dy) < .5 && Math.abs(r0.width - r.width) < .5) return;
  const a = { transform: `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`, width: r0.width + 'px' }, b = { transform: 'none', width: r.width + 'px' };
  if (lifted) { a.boxShadow = '0 10px 24px rgba(0,0,0,.28)'; b.boxShadow = '0 0 0 rgba(0,0,0,0)'; }
  el.style.justifySelf = 'start';   // (so the width it's given holds, and it eases from its left edge)
  el.animate([a, b], { duration: 260, easing: EASE_OUT }).onfinish = () => { el.style.justifySelf = ''; };
}
// after the change: each bar eases from where it was (the conflict's own, the one in the row it was let go in, from the
// copy or stretched bar; its others fade in) and the rest (sel) ease to their new places
function cfSettle(m, from, BAR, barKey, before, rowOf, landRow) {
  $$(BAR).forEach(el => {
    if (el.dataset.cid !== m.id) { const r0 = before.get(barKey(el)); if (r0) cfEaseFrom(el, r0); return; }
    if (from && rowOf(el) === landRow) cfEaseFrom(el, from, !!m.ghost);
    else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE_OUT });
  });
}
// the line for a bar over columns ca..cb: the first one free of the other conflicts' bars there (as they are now: they stay put)
function cfFreeLine(bars, m, ca, cb, colOf, lineOf) {
  const used = new Set(bars.filter(x => x.dataset.cid !== m.id).filter(x => { const [a, b] = colOf(x); return a <= cb && b >= ca; }).map(lineOf));
  let L = 0; while (used.has(L)) L++;
  return L;
}
const cfSlotCls = (cls, s, e) => [cls, s && 's', e && 'e'].filter(Boolean).join(' ');

// on the calendar: a bar's lines are rows of #grid (one per week), its days the grid's columns
const CF_CAL = {
  dayAt: calDayAt,
  bars: id => $$(`#grid .cfb[data-cid="${id}"]:not(.nb)`),
  row: () => { const g = $('#grid').getBoundingClientRect(); return [g.left + 4, g.right - 4]; },
  place([a, b], m) {
    const g = $('#grid'), days = viewDays(g), slots = new Map(), rooms = new Map();
    const bars = $$(':scope > .cfb:not(.nb)', g);
    for (let w = 0; w * 7 < days.length; w++) {
      const ws = days[w * 7].dataset.date, we = days[w * 7 + 6].dataset.date; if (b < ws || a > we) continue;
      const A = a > ws ? a : ws, B = b < we ? b : we, ca = diffDays(A, ws), cb = diffDays(B, ws), row = days[w * 7].style.gridRowStart;
      const L = cfFreeLine(bars.filter(x => x.style.gridRowStart === row), m, ca, cb,
        x => [parseInt(x.style.gridColumnStart, 10) - 1, parseInt(x.style.gridColumnEnd, 10) - 2], x => Math.round((parseFloat(x.style.marginTop) - CF_TOP) / CF_PITCH));
      slots.set(`${row}:${ca}:${cb}:${L}:${A === a}:${B === b}`, { parent: g, html: `<div class="${cfSlotCls('cf-slot', A === a, B === b)}" style="grid-row:${row};grid-column:${ca + 1} / ${cb + 2};margin-top:${CF_TOP + L * CF_PITCH}px"></div>` });
      for (let i = ca; i <= cb; i++) {   // room for it in each day, beyond what it already keeps under bars
        const day = days[w * 7 + i], gap = day.querySelector(':scope > .cf-gap'), need = (L + 1) * CF_PITCH + 4 - (gap ? gap.offsetHeight : 0);
        if (need > 0) rooms.set(day.dataset.date, { parent: day, before: day.querySelector(':scope > .items'), h: need });
      }
    }
    return { slots, rooms };
  },
  snap() {
    const BAR = '#grid .cfb[data-cid]:not(.nb)', barKey = el => el.dataset.cid + '@' + el.dataset.d0;
    const chips = snapRects(CAL_CHIPS, chipKey), bars = snapRects(BAR, barKey);
    return (m, from) => {
      flipTo(CAL_CHIPS, chipKey, chips);
      // (the row it was let go in: the week of the day under the pointer then)
      const at = from && calDayAt(m.ghost ? from.left + m.dx : m.mode === 'r' ? from.right - 2 : from.left + 2, from.top + from.height / 2), ld = at && $(`#grid .day:not(.nb)[data-date="${at}"]`);
      cfSettle(m, from, BAR, barKey, bars, el => el.style.gridRowStart, ld ? ld.style.gridRowStart : null);
    };
  },
};
// in day view: its bars in the strip above the hours (a line each, a column per day shown), and its tags in the list
const dvDayAt = x => {   // the day column under x (counting on past the visible days, so you can drag beyond them)
  const cols = $$('#dayview .dv-col'); if (!cols.length) return null;
  const r = cols[0].getBoundingClientRect(), w = r.width || 1;
  return addDays(cols[0].dataset.date, Math.floor((x - r.left) / w));
};
const dvListDayAt = (x, y) => {   // a day's section in the list, or a day column, under the pointer
  const el = document.elementsFromPoint(x, y).find(n => n.dataset && n.dataset.date && (n.classList.contains('dv-day') || n.classList.contains('dv-col')));
  return el ? el.dataset.date : null;
};
const CF_DV = {
  dayAt: (x, y) => cfMove && cfMove.el.classList.contains('dv-cfp') ? dvListDayAt(x, y) : dvDayAt(x),
  bars: id => $$(`#dayview .dv-cfb[data-cid="${id}"], #dayview .dv-cfp[data-cid="${id}"]`),
  row: () => { const cols = $$('#dayview .dv-col'); return cols.length ? [cols[0].getBoundingClientRect().left + 4, cols[cols.length - 1].getBoundingClientRect().right - 4] : [0, innerWidth]; },
  place([a, b], m) {
    const slots = new Map(), rooms = new Map(), days = dvDays(), strip = $('#dayview .dv-conf');
    const A = a > days[0] ? a : days[0], B = b < days[days.length - 1] ? b : days[days.length - 1]; if (A > B) return { slots, rooms };
    const ca = diffDays(A, days[0]), cb = diffDays(B, days[0]);
    if (strip) {
      const bars = $$(':scope > .dv-cfb', strip), lines = bars.reduce((n, x) => Math.max(n, parseInt(x.style.gridRowStart, 10)), 0);
      const L = cfFreeLine(bars, m, ca, cb, x => [parseInt(x.style.gridColumnStart, 10) - 2, parseInt(x.style.gridColumnEnd, 10) - 3], x => parseInt(x.style.gridRowStart, 10) - 1);
      slots.set(`${ca}:${cb}:${L}:${A === a}:${B === b}`, { parent: strip, grow: L >= lines, html: `<div class="${cfSlotCls('cf-slot dv-slot', A === a, B === b)}" style="grid-row:${L + 1};grid-column:${ca + 2} / ${cb + 3}"></div>` });
    }
    // its tag in each day's section of the list (2 or more days shown) that doesn't have it yet
    for (let d = A; d <= B; d = addDays(d, 1)) {
      const sec = $(`#dayview .dv-list .dv-day[data-date="${d}"]`); if (!sec || sec.querySelector(`.dv-cfp[data-cid="${m.id}"]`)) continue;
      const cfps = $$(':scope > .dv-cfp', sec), before = cfps.length ? cfps[cfps.length - 1].nextSibling : (sec.querySelector(':scope > .dv-dh') || {}).nextSibling || sec.firstChild;
      rooms.set(d, { parent: sec, before, h: 28 });
    }
    return { slots, rooms };
  },
  snap() {
    const BAR = '#dayview .dv-cfb[data-cid]', TAG = '#dayview .dv-cfp[data-cid]', ITEM = '#dayview .dv-item[data-id]';
    const barKey = el => el.dataset.cid, tagKey = el => el.dataset.cid + '@' + el.dataset.day, itemKey = el => el.dataset.id;
    const bars = snapRects(BAR, barKey), tags = snapRects(TAG, tagKey), items = snapRects(ITEM, itemKey), hours = snapRects('#dayview .dv-scroll', () => 'h');
    return (m, from) => {
      flipTo(ITEM, itemKey, items); flipTo('#dayview .dv-scroll', () => 'h', hours);
      // tags: the conflict's own from the copy, when one was dragged (the one in the section it was let go in), else fading in
      const tagDay = m.ghost && m.el.classList.contains('dv-cfp') && from && dvListDayAt(from.left + m.dx, from.top + m.dy);
      $$(TAG).forEach(el => {
        if (el.dataset.cid === m.id && tagDay && el.dataset.day === tagDay) { const r = el.getBoundingClientRect(); el.animate([{ transform: `translate(${(from.left - r.left).toFixed(1)}px,${(from.top - r.top).toFixed(1)}px)`, boxShadow: '0 10px 24px rgba(0,0,0,.28)' }, { transform: 'none', boxShadow: '0 0 0 rgba(0,0,0,0)' }], { duration: 260, easing: EASE_OUT }); }
        else { const r0 = tags.get(tagKey(el)); if (r0) cfEaseFrom(el, r0); else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE_OUT }); }
      });
      // the strip's bars: the conflict's own from the copy or the stretched end (a tag dragged: it fades in)
      cfSettle(m, tagDay ? null : from, BAR, barKey, bars, () => 1, tagDay ? null : 1);
    };
  },
};
// hovering a conflict on the calendar or in the sidebar picks it out in both
let cfLit = false;   // some conflict is picked out (so the common case, nothing to undo, costs nothing)
document.addEventListener('mouseover', e => {
  const h = e.target.closest && e.target.closest('.cfb, .cfrow'), id = h && (h.dataset.cid);
  if (!id && !cfLit) return;
  $$('.cfb.hl, .cfrow.hl').forEach(x => { if (x.dataset.cid !== id) x.classList.remove('hl'); });
  if (id && !cfMove) { $$(`.cfb[data-cid="${id}"], .cfrow[data-cid="${id}"]`).forEach(x => x.classList.add('hl')); cfLit = true; }
  else if (!id) cfLit = false;
});
