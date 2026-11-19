'use strict';
/* Mobile mode (a phone-sized window: MOBILE_MQ). The same app with a different shell, layered on the desktop code:
   one column; a drawer from the left (the ☰ button, or a swipe in from the screen's left edge; swipe it back to close)
   holding the sidebar (calendar, day view: its own tree, mTree, folded by tapping rows) or the Timeline's list of
   projects and threads; title-only chips, on one line or wrapped where a week has room (mFit); full days show "…"
   instead of scrolling; a swipe up / down steps the calendar's weeks as the desktop's scroll does;
   day view shows one day, swipes sideways a day at a time, and has its task list in a sheet along the bottom that's
   dragged up and down by its handle. No hover: a tap on a day opens it, a tap on a task anywhere opens its menu (which
   has Mark done, Open day, Reschedule…, Set a time…, Rename… here), with a little press to show it took (mTapFx);
   a long press lifts a task to drag it (calendar chips, day-view blocks and list items: mLift); changes made here can
   be undone from a bar at the top (mUndo), as a phone has no ⌘Z; in the Timeline the chart takes the full width and a tap on a dot or day
   opens its list at once. Styles: css/mobile.css, all under body.mobile.
   Hooks elsewhere check MOBILE: renderTree and openTaskMenu (sidebar.js), chip / failChip / archived chips, fitRows,
   buildNeighbours and weekShift (calendar.js),
   dayN and openDay (dayview.js), the day-view click / drag handlers (dayview-edit.js), setSbw and setRange (app.js),
   openTaskMenu (sidebar.js), the notes hover (notes.js), renderAdmire's widths, its hover handlers and the list's fold
   arrows (timeline.js). */
const MOBILE_MQ = matchMedia('(max-width: 700px), (pointer: coarse) and (max-height: 500px)');
let MOBILE = MOBILE_MQ.matches;
document.body.classList.toggle('mobile', MOBILE);
MOBILE_MQ.addEventListener('change', () => {
  MOBILE = MOBILE_MQ.matches; document.body.classList.toggle('mobile', MOBILE);
  mDrawer(false); setPull(0);
  if (weekAnim) weekAnim.finish();
  if (dayAnim) dayAnim.finish(); else if (dayStrip) exitStrip(null);
  setSbw(ui.sbw);
  if (MOBILE && ui.dayView) mSheetAuto(ui.dayView);
  if (dataLoaded) render();
});

/* ---------- touch helpers ---------- */
const M_TURN = 0.22, M_FLICK = 0.45;   // a swipe let go past this share of its distance carries on; a flick (px / ms) does too
const mTouch = e => { const t = e.touches[0]; return { x0: t.clientX, y0: t.clientY, axis: null, dx: 0, ts: performance.now(), dxs: 0, vx: 0 }; };
// velocity over the last few dozen ms of a swipe (s: the swipe's record; dx: where it is now, along its axis)
function mVel(s, dx) {
  const now = performance.now();
  if (now - s.ts > 30) { s.vx = (dx - s.dxs) / (now - s.ts); s.ts = now; s.dxs = dx; }
}
const mFlick = s => performance.now() - s.ts < 80 && Math.abs(s.vx) > M_FLICK;   // (a finger that stopped before letting go isn't a flick)
// which way a swipe that's let go goes on: 1 next, -1 previous, 0 back (a flick back the way it came cancels)
function mDir(s, W) {
  if (mFlick(s)) return Math.sign(s.vx) === Math.sign(s.dx) ? -Math.sign(s.dx) : 0;
  return Math.abs(s.dx) > W * M_TURN ? -Math.sign(s.dx) : 0;
}
// follow one touch: its move / end listeners go on the touched element itself, which keeps getting the touch's events
// even when a redraw takes it out of the page (they'd no longer bubble to its old ancestors)
function mFollow(e, move, end) {
  const tg = e.target;
  const fin = ev => { tg.removeEventListener('touchmove', move); tg.removeEventListener('touchend', fin); tg.removeEventListener('touchcancel', fin); end(ev.type === 'touchcancel'); };
  tg.addEventListener('touchmove', move, { passive: false });
  tg.addEventListener('touchend', fin); tg.addEventListener('touchcancel', fin);
}

/* ---------- header and drawer ---------- */
$('header').insertAdjacentHTML('afterbegin', `<button class="ic" id="mBurger" aria-label="Menu">${svg('<path d="M4 6h16M4 12h16M4 18h16"/>')}</button>`);
$('#app').insertAdjacentHTML('beforeend', '<div id="mScrim"></div>');
// the drawer: the sidebar, or in the Timeline its own list (css/mobile.css)
const mDrawerEl = () => admOpen ? $('#admire .adm-side') : $('aside');
const mIsOpen = () => $('#app').classList.contains('mdrawer');
function mDrawer(open) { $('#app').classList.toggle('mdrawer', !!open); if (open) { mFloatGone(); mBarSync(); } }
// what floats over the page (the Timeline's list for a dot, a menu) would sit above the drawer: it goes when the drawer comes
function mFloatGone() { admHideTip(true); closeMenu(); hideNotesTip(); }
$('#mBurger').onclick = () => mDrawer(!mIsOpen());
$('#mScrim').onclick = () => mDrawer(false);
// going to another view or day closes it
document.addEventListener('click', e => { if (MOBILE && e.target.closest && e.target.closest('.views button, [data-act="openday"]')) mDrawer(false); }, true);
// the sidebar drawer's bar at the top stands in for the header's right side: save status, style, Settings, Help,
// account (online), weeks shown. Its buttons click the header's own (data-m), so those stay the only code for them.
$('aside').insertAdjacentHTML('afterbegin', `<div class="m-bar">
  <div class="m-row"><button class="m-status" data-m="status"></button><span class="m-sp"></span>
  <button class="ic" data-m="themeBtn" aria-label="Style"></button><button class="ic" data-m="setBtn" aria-label="Settings"></button>
  <button class="btn" data-m="helpBtn" aria-label="Help">?</button><button class="m-acct" data-act="acct" aria-label="Account" hidden></button></div>
  <div class="m-row"><span class="m-wkl">Weeks shown</span><div class="seg m-wk">${[1, 2, 3, 4, 5].map(n => `<button data-n="${n}">${n}</button>`).join('')}</div></div></div>`);
function mBarSync() {
  const f = $('aside .m-bar');
  $$('.m-wk button', f).forEach(b => b.classList.toggle('on', +b.dataset.n === ui.weeks));
  ['themeBtn', 'setBtn'].forEach(id => { $(`[data-m="${id}"]`, f).innerHTML = $('#' + id).innerHTML; });
  $('[data-m="status"]', f).textContent = $('#status').textContent;
  const acct = $('#acctBtn'), a = $('.m-acct', f); a.hidden = acct.hidden; a.textContent = acct.textContent;
}
$('aside .m-bar').addEventListener('click', e => {
  const w = e.target.closest('.m-wk button');
  if (w) { setPull(0); setWeekCount(+w.dataset.n); mBarSync(); return; }
  const b = e.target.closest('[data-m]'); if (!b) return;
  $('#' + b.dataset.m).click(); mBarSync();
});
/* Swiping the drawer: in from the screen's left edge (a touch starting within M_EDGE px of it) to open, or back to the
   left on the drawer or the dimmed page beside it to close. It follows the finger (mDrawerAt); let go past
   about a third of its width, or with a flick, and it goes the rest of the way, otherwise back. These touches are
   claimed first (capture), so the calendar / day view under them don't also take them (they check mEdge / mClose). */
const M_EDGE = 20;
let mEdge = null, mClose = null;
function mDrawerAt(x, W) {   // the drawer at x (−W shut … 0 open), the page beside it dimmed to match
  const el = mDrawerEl(), sc = $('#mScrim');
  if (!mIsOpen()) mFloatGone();
  el.style.transition = sc.style.transition = 'none';
  el.style.transform = `translateX(${x}px)`; el.style.boxShadow = '0 0 30px rgba(0,0,0,.25)';
  sc.style.opacity = String(clamp(1 + x / W, 0, 1));
}
function mDrawerLet(open) {   // let go: back to the stylesheet, which animates on from where the finger left it
  const el = mDrawerEl(), sc = $('#mScrim');
  if (el) { el.style.transition = ''; el.style.transform = ''; el.style.boxShadow = ''; }
  sc.style.transition = ''; sc.style.opacity = '';
  mDrawer(open);
}
window.addEventListener('touchstart', e => {
  mEdge = mClose = null;
  if (!MOBILE || e.touches.length !== 1 || $('#modal').style.display === 'grid' || menu.style.display === 'block') return;
  const el = mDrawerEl(); if (!el) return;
  if (!mIsOpen()) {
    if (e.touches[0].clientX > M_EDGE) return;
    mEdge = mTouch(e); mEdge.W = el.offsetWidth; mFollow(e, mEdgeMove, mEdgeEnd);
  } else if (el.contains(e.target) || e.target.id === 'mScrim') {
    mClose = mTouch(e); mClose.W = el.offsetWidth; mFollow(e, mCloseMove, mCloseEnd);
  }
}, { capture: true, passive: true });
function mEdgeMove(e) {
  const s = mEdge; if (!s) return;
  const t = e.touches[0], dx = t.clientX - s.x0, dy = t.clientY - s.y0;
  if (!s.axis) { if (Math.hypot(dx, dy) < 8) return; s.axis = dx > Math.abs(dy) ? 'x' : 'y'; if (s.axis === 'y') { mEdge = null; return; } }
  if (e.cancelable) e.preventDefault();
  s.dx = clamp(dx, 0, s.W); mVel(s, dx); mDrawerAt(s.dx - s.W, s.W);
}
function mEdgeEnd(cancelled) {
  const s = mEdge; mEdge = null; if (!s || s.axis !== 'x') return;
  mDrawerLet(!cancelled && (mFlick(s) ? s.vx > 0 : s.dx > s.W * 0.35));
}
function mCloseMove(e) {
  const s = mClose; if (!s) return;
  const t = e.touches[0], dx = t.clientX - s.x0, dy = t.clientY - s.y0;
  if (!s.axis) { if (Math.hypot(dx, dy) < 8) return; s.axis = -dx > Math.abs(dy) ? 'x' : 'y'; if (s.axis === 'y') { mClose = null; return; } }   // (up / down: the list scrolls)
  if (e.cancelable) e.preventDefault();
  s.dx = clamp(dx, -s.W, 0); mVel(s, dx); mDrawerAt(s.dx, s.W);
}
function mCloseEnd(cancelled) {
  const s = mClose; mClose = null; if (!s || s.axis !== 'x') return;
  mDrawerLet(cancelled || !(mFlick(s) ? s.vx < 0 : -s.dx > s.W * 0.3));
}

/* ---------- calendar: "…" for days that are full ---------- */
// in each day under root (the weeks built ahead too), the chips (or same-day groups) that don't fit whole are hidden
// and a "…" takes their place
const M_MORE = 13;   // px kept for the "…"
function mClip(root) {
  $$('.day .items', root).forEach(it => {
    for (const c of it.querySelectorAll(':scope > .m-hid')) c.classList.remove('m-hid');
    const old = it.querySelector(':scope > .m-more'); if (old) old.remove();
    if (it.scrollHeight <= it.clientHeight + 1) return;
    const lim = it.getBoundingClientRect().bottom - M_MORE;
    let cut = false;
    for (const c of it.children) { if (!cut && c.getBoundingClientRect().bottom > lim) cut = true; if (cut) c.classList.add('m-hid'); }
    it.insertAdjacentHTML('beforeend', '<div class="m-more">…</div>');
  });
}
const mUnclip = it => { for (const c of it.querySelectorAll(':scope > .m-hid')) c.classList.remove('m-hid'); const m = it.querySelector(':scope > .m-more'); if (m) m.remove(); };
/* Week heights: what each week needs (weekNeeds), shared out as on desktop (fitSizes). Titles wrap (.day.wrap) in every
   week if that still fits; otherwise in as many weeks as fit (those that grow least first), the rest on one line; and
   if even one line doesn't fit, rows are capped and full days end in "…" (mClip, after). days: 7 a week, in order. */
function mFit(days, H) {
  const n = Math.floor(days.length / 7), sum = a => a.reduce((x, y) => x + y, 0);
  days.forEach(d => { mUnclip(d.querySelector('.items')); d.classList.remove('wrap'); });
  const one = weekNeeds(days);
  days.forEach(d => d.classList.add('wrap'));
  const wrapped = weekNeeds(days);
  let wrap = Array(n).fill(true);
  if (sum(wrapped) > H) {
    wrap = Array(n).fill(false);
    let tot = sum(one);
    [...Array(n).keys()].sort((a, b) => (wrapped[a] - one[a]) - (wrapped[b] - one[b])).forEach(w => {
      if (tot - one[w] + wrapped[w] <= H) { wrap[w] = true; tot += wrapped[w] - one[w]; }
    });
  }
  days.forEach((d, i) => d.classList.toggle('wrap', wrap[Math.floor(i / 7)]));
  return fitSizes(wrap.map((x, w) => x ? wrapped[w] : one[w]), H);
}
// a tap on a task opens its menu (a failed attempt: the attempt's menu); anywhere else in a day opens the day in day
// view (its number does too, through its data-act). (stopPropagation: the document's click handler would close the menu)
let mSwipedAt = 0;
$('#grid').addEventListener('click', e => {
  if (!MOBILE || Date.now() - mSwipedAt < 400 || e.target.closest('[data-act], input, button')) return;
  const c = e.target.closest('.chip[data-id], .chip[data-fid]');
  if (c) {
    const at = { x: e.clientX, y: e.clientY };
    if (c.dataset.fid) openFailMenu(c.dataset.fid, at); else openTaskMenu(c.dataset.id, null, at, c);
    e.stopPropagation(); return;
  }
  const d = e.target.closest('.day'); if (d && !d.classList.contains('nb')) openDay(d.dataset.date);
});

/* ---------- calendar: swiping up / down ---------- */
/* The desktop's scroll, by touch: the days (and the week built ahead beyond them, buildNeighbours) follow the finger
   (setPull), with resistance past one week; let go past M_TURN of a week, or with a flick, and the calendar steps on
   (weekShift, from where the pull got to): one week, or two or three for a fast flick. Otherwise it springs back. */
let mSw = null;   // a touch on the calendar that may become a swipe
$('main').addEventListener('touchstart', e => {
  if (!MOBILE || ui.dayView || admOpen || weekAnim || mSw || mEdge || e.touches.length !== 1) return;
  mSw = mTouch(e); mFollow(e, mCalMove, mCalEnd);
}, { passive: true });
function mCalMove(e) {
  const s = mSw; if (!s) return;
  if (e.touches.length !== 1) { mSw = null; if (s.axis === 'y') setPull(0, true); return; }
  const t = e.touches[0], dx = t.clientX - s.x0, dy = t.clientY - s.y0;
  if (!s.axis) {
    if (Math.hypot(dx, dy) < 8) return;
    s.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
    if (s.axis === 'y') { clearTimeout(nbTimer); buildNeighbours(); s.R = rowHeights()[0] || 100; }
  }
  if (s.axis !== 'y') return;
  if (e.cancelable) e.preventDefault();
  s.dx = dy; mVel(s, dy);   // (dx: the distance along the swipe; up = negative = later weeks)
  const a = Math.abs(dy);
  setPull(-Math.sign(dy) * (a <= s.R ? a : s.R + (a - s.R) * 0.35));
}
function mCalEnd(cancelled) {
  const s = mSw; mSw = null;
  if (!s || s.axis !== 'y') return;
  mSwipedAt = Date.now();
  const dir = cancelled ? 0 : mDir(s, s.R), v = mFlick(s) ? Math.abs(s.vx) : 0;
  if (dir) weekShift(dir, v > 1.8 ? 3 : v > 1.1 ? 2 : 1); else setPull(0, true);
}

/* ---------- day view ---------- */
// sideways swipes over the timeline: the day before and after follow the finger (enterStrip / setStripX, dayview.js);
// let go far enough (or with a flick) and it slides on (daySlide), otherwise back
let mDs = null;
const dvBox = $('#dayview');
dvBox.addEventListener('touchstart', e => {
  if (!MOBILE || !ui.dayView || admOpen || dayAnim || dv || mDs || mEdge || e.touches.length !== 1 || !e.target.closest('.dv-main')) return;
  mDs = mTouch(e); mFollow(e, mDayMove, mDayEnd);
}, { passive: true });
function mDayMove(e) {
  if (!mDs || mDs.axis === 'y') return;   // (an up / down drag: the hours scroll as usual)
  const t = e.touches[0], dx = t.clientX - mDs.x0, dy = t.clientY - mDs.y0;
  if (!mDs.axis) {
    if (Math.hypot(dx, dy) < 8) return;
    mDs.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (mDs.axis === 'y') return;
    enterStrip();
  }
  if (!dayStrip) return;
  if (e.cancelable) e.preventDefault();
  mDs.dx = clamp(dx, -dayStrip.W, dayStrip.W); mVel(mDs, dx);
  setStripX(dayStrip.W - mDs.dx);
}
function mDayEnd(cancelled) {
  const s = mDs; mDs = null;
  if (!s || s.axis !== 'x' || !dayStrip || dayAnim) return;
  const dir = cancelled ? 0 : mDir(s, dayStrip.W);
  if (dir) daySlide(dir); else glide(dayStrip.W, 180, () => exitStrip(null));
}
// a tap on a task (timeline block or list item) opens its menu; on a failed attempt, the attempt's menu.
// (stopPropagation: the document's click handler would close the menu straight away)
dvBox.addEventListener('click', e => {
  if (!MOBILE || e.target.closest('input, button, .inl, [data-act]')) return;
  const el = e.target.closest('.dv-blk, .dv-item'); if (!el) return;
  const at = { x: e.clientX, y: e.clientY };
  if (el.dataset.fid) openFailMenu(el.dataset.fid, at);
  else if (el.dataset.id) openTaskMenu(el.dataset.id, null, at, el);
  else return;
  e.stopPropagation();
});

/* Day view's task list is a sheet along the bottom, dragged up and down by its handle or heading (a tap there
   opens a minimized sheet halfway, or minimizes it). Entering day view (from the calendar or the view switcher, not a
   swipe to another day) sets it for that day: down to just its heading when every task has a time (the timeline shows
   them all), all the way up when none does (or there are none), halfway when some do. Its height: --sheet-h. */
const M_PEEK = 52;   // px: just the handle and heading (the timeline keeps this much room below it: css .dv-main)
let mSheetH = M_PEEK, mSh = null;
const mSheetMax = () => Math.max(M_PEEK, innerHeight - $('header').offsetHeight - 10);
function mSheetSet(h) { mSheetH = clamp(h, M_PEEK, mSheetMax()); dvBox.style.setProperty('--sheet-h', Math.round(mSheetH) + 'px'); }
function mSheetAuto(d) {
  const ks = dayTasks(d), timed = ks.filter(it => planOf(it.k)).length;
  mSheetSet(ks.length && timed === ks.length ? M_PEEK : timed ? innerHeight * 0.45 : Infinity);
}
window.addEventListener('resize', () => { if (MOBILE) mSheetSet(mSheetH >= mSheetMax() - 1 ? Infinity : mSheetH); });
dvBox.addEventListener('pointerdown', e => {
  if (!MOBILE || mSh || !e.target.closest('.m-grab, .dv-side .sb-head')) return;
  const side = e.target.closest('.dv-side');
  mSh = { y0: e.clientY, h0: mSheetH, moved: false, ts: performance.now(), dxs: 0, vx: 0, side };
  side.classList.add('m-dragging'); side.setPointerCapture(e.pointerId);
  const move = ev => { const dy = ev.clientY - mSh.y0; if (Math.abs(dy) > 4) mSh.moved = true; mVel(mSh, dy); if (mSh.moved) mSheetSet(mSh.h0 - dy); };
  const up = ev => {
    side.removeEventListener('pointermove', move); side.removeEventListener('pointerup', up); side.removeEventListener('pointercancel', up);
    side.classList.remove('m-dragging');
    const s = mSh; mSh = null; if (ev.type === 'pointercancel') return;
    if (!s.moved) mSheetSet(mSheetH <= M_PEEK + 8 ? innerHeight * 0.55 : M_PEEK);   // a tap
    else if (mFlick(s)) mSheetSet(s.vx < 0 ? Infinity : M_PEEK);                    // a flick: all the way
  };
  side.addEventListener('pointermove', move); side.addEventListener('pointerup', up); side.addEventListener('pointercancel', up);
});
mSheetSet(M_PEEK);

/* ---------- Timeline ---------- */
// a tap on a dot, a day in the wave or the "without a date" line opens its list straight away (on desktop it waits for
// the pointer to rest); a tap anywhere else closes it. A tap on a name in the drawer's list closes the drawer and
// brings that thread or project into view, picked out as hovering it would (its arrow still folds it: timeline.js)
$('#admire').addEventListener('click', e => {
  if (!MOBILE) return;
  const li = e.target.closest('.adm-side .adm-li');
  if (li) { if (!e.target.closest('.tw')) { mDrawer(false); mAdmSpot(li.dataset.lk, li.classList.contains('pj')); } return; }
  const a = e.target.closest('[data-tip]');
  if (a) { clearTimeout(admTipTimer); admTipWant = null; admPlaceTip(a); }
  else admHideTip(true);
  // and picks out the thread under the tap (a dot, bar or name), or nothing
  const t = e.target.closest('.adm-dot, .adm-bar, .adm-tag'), host = t && (t.dataset.lk ? t : t.closest('[data-lk]'));
  mAdmSpot(host ? host.dataset.lk : null, false, false);
});
// pick out thread / project k (null: nothing), as hovering it does on desktop; scroll: bring its first lane into view
function mAdmSpot(k, proj, scroll = true) {
  const tl = $('#admire .adm-tl'); if (!tl) return;
  $$('.hl, .hl2', tl).forEach(x => x.classList.remove('hl', 'hl2'));
  tl.dataset.spot = k || ''; if (!k) return;
  const q = `[data-lk="${CSS.escape(k)}"]`;
  $$(q, tl).forEach(x => x.classList.add('hl'));
  if (proj) $$(`[data-pk="${CSS.escape(k)}"]:not(.hl)`, tl).forEach(x => x.classList.add('hl2'));
  const first = $('.adm-main ' + q, tl) || (proj && $(`.adm-main [data-pk="${CSS.escape(k)}"]`, tl));
  if (first && scroll) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ---------- the sidebar's tree ---------- */
/* Projects › threads (› sub-threads) › tasks, read-only for now. A tap anywhere on a project's or thread's row folds or
   unfolds it (ui.collapsed, as on desktop) in place, without a redraw: every body is drawn, and a folded one shrinks to
   nothing (css .mt-body, grid rows 1fr → 0fr) while its chevron turns. A tap on a task opens its menu. Runs of done
   tasks fold into "+ N completed" as on desktop (Settings), opened through the same dr-toggle. */
const M_CHEV = svg('<path d="m9 6 6 6-6 6"/>');
const mNode = (id, cls, head, body, style = '') => `<div class="mt-node ${cls} ${ui.collapsed[id] ? 'closed' : ''}" data-mt="${id}" ${style}>
  <div class="mt-row" data-mtog="${id}"><span class="mt-chev">${M_CHEV}</span>${head}</div><div class="mt-body"><div class="mt-in">${body}</div></div></div>`;
function mTree() {
  const tree = $('#tree');
  if (!state.projects.length) { tree.innerHTML = `<div class="empty">No projects yet.</div>` + renderConflicts(); return; }
  tree.innerHTML = `<div class="mt">${state.projects.map(p => {
    const ks = p.threads.flatMap(subtreeTasks), open = ks.filter(k => !k.done).length;
    return mNode(p.id, 'mt-p', `<span class="mt-nm">${esc(p.name)}</span><span class="mt-cnt">${open ? open + ' open' : ks.length ? 'all done' : ''}</span>`,
      p.threads.map(t => mThread(p, t)).join('') || '<div class="mt-empty">No threads yet</div>');
  }).join('')}</div>` + renderConflicts();
}
function mThread(p, t) {
  const ks = subtreeTasks(t), done = ks.filter(k => k.done).length, loose = isLoose(p, t), L = layout(t);
  let body = '';
  for (let i = 0; i < L.length;) {
    if (L[i].kind !== 'task') { body += mThread(p, L[i].obj); i++; continue; }
    let b = i; while (b < L.length && L[b].kind === 'task' && L[b].obj.done) b++;
    if (ui.collapseDone && done < ks.length && b - i >= 2) {   // a run of done tasks
      const run = L.slice(i, b).map(x => x.obj), op = run.some(k => drOpen.has(k.id));
      body += `<div class="mt-run" data-act="dr-toggle" data-has="${run.map(k => k.id).join(' ')}">${op ? 'Hide' : '+'} ${run.length} completed</div>`;
      if (op) run.forEach(k => { body += mTask(t, k, loose); });
      i = b; continue;
    }
    body += mTask(t, L[i].obj, loose); i++;
  }
  return mNode(t.id, 'mt-t', `<span class="mt-dot"></span><span class="mt-nm">${esc(t.name)}</span><span class="mt-cnt">${ks.length ? `${done}/${ks.length}` : ''}</span>`,
    body || '<div class="mt-empty">No tasks yet</div>', `style="--c:${esc(colorOf(t))}"`);
}
const mTask = (t, k, loose) => `<div class="mt-task ${k.done ? 'done' : ''}" data-id="${k.id}"><span class="mt-ck">${k.done ? ICON.check : ''}</span>${loose ? '' : `<span class="mt-n">${t.tasks.indexOf(k) + 1}</span>`}<span class="mt-tt">${esc(k.title)}${noteMark(k)}</span><span class="mt-d">${k.done ? '' : k.date ? fmtRelative(k.date) : 'no date'}</span></div>`;
$('#tree').addEventListener('click', e => {
  if (!MOBILE) return;
  const r = e.target.closest('[data-mtog]');
  if (r) { const id = r.dataset.mtog, n = r.parentElement, shut = !n.classList.contains('closed'); n.classList.toggle('closed', shut); ui.collapsed[id] = shut; saveUI(); return; }
  const k = e.target.closest('.mt-task[data-id]');
  if (k) { openTaskMenu(k.dataset.id, null, { x: e.clientX, y: e.clientY }, k); e.stopPropagation(); }
});

/* ---------- a tap on a task shows it took ---------- */
// a quick press (scale) and a ring in the task's color just inside its edge (outside, a day's list would clip it),
// fading. Web Animations, so a view's own CSS animations (a Timeline dot's pop) aren't disturbed.
function mTapFx(el) {
  if (!el.animate || !MOTION()) return;
  const c = (getComputedStyle(el).getPropertyValue('--c') || '').trim(), ring = /^#[0-9a-f]{6}$/i.test(c) ? c : '#2f6fed';
  el.animate([
    { scale: 1, outline: `2px solid ${ring}00`, outlineOffset: '-2px', filter: 'brightness(1)' },
    { scale: .95, outline: `2px solid ${ring}cc`, outlineOffset: '-2px', filter: 'brightness(1.05)', offset: .3 },
    { scale: 1, outline: `2px solid ${ring}00`, outlineOffset: '-2px', filter: 'brightness(1)' },
  ], { duration: 420, easing: 'ease-out' });
}
document.addEventListener('click', e => {
  if (!MOBILE || !e.target.closest) return;
  const el = e.target.closest('#grid .chip, .dv-blk, .dv-item, .mt-task, .adm-dot'); if (el) mTapFx(el);
}, true);

/* ---------- undo, for phones ---------- */
// after a change made by touch, a bar with Undo for a few seconds (the toast's place); not when the warning bar is up,
// which has its own Undo
function mUndo(msg) {
  const t = $('#toast');
  if ($('#warn').style.display === 'flex') { if (t.querySelector('.mu-b')) t.style.display = 'none'; return; }   // (an older bar would now undo this change under its old label)
  t.innerHTML = `<span class="mu-t">${esc(msg)}</span><button class="mu-b">Undo</button>`; t.style.display = 'flex';
  t.querySelector('.mu-b').onclick = () => { undo(); t.style.display = 'none'; };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 5000);
}
// the task menu's Mark done / Unschedule get it too
document.addEventListener('click', e => {
  const b = MOBILE && e.target.closest && e.target.closest('#menu [data-act="k-done"], #menu [data-act="k-unsched"]'); if (!b) return;
  const msg = b.dataset.act === 'k-unsched' ? 'Unscheduled' : b.textContent.trim() === 'Mark done' ? 'Marked done' : 'Marked not done';
  setTimeout(() => mUndo(msg), 0);
}, true);

/* ---------- typing a date or a name: a box at the top (clear of the keyboard) ---------- */
// o: { title, sub, value, placeholder, read(text) → { ok, hint, value }, chips: [{ label, value }], ok, done(value) }
const M_PENCIL = svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>');
document.body.insertAdjacentHTML('beforeend', '<div id="mAsk"><div class="ma-card"></div></div>');
function mAsk(o) {
  const box = $('#mAsk'), card = $('.ma-card', box);
  card.innerHTML = `<div class="ma-h">${esc(o.title)}</div>${o.sub ? `<div class="ma-sub">${esc(o.sub)}</div>` : ''}
    <input class="ma-in" spellcheck="false" autocomplete="off" enterkeyhint="done"><div class="ma-hint"></div>
    ${o.chips ? `<div class="ma-chips">${o.chips.map((c, i) => `<button data-i="${i}">${esc(c.label)}</button>`).join('')}</div>` : ''}
    <div class="ma-btns"><button class="btn ma-no">Cancel</button><button class="btn primary ma-ok">${esc(o.ok || 'Save')}</button></div>`;
  const inp = $('.ma-in', card), hint = $('.ma-hint', card), okb = $('.ma-ok', card);
  inp.value = o.value || ''; inp.placeholder = o.placeholder || '';
  const check = () => { const r = o.read(inp.value); hint.textContent = r.hint || ''; hint.classList.toggle('bad', !r.ok); okb.disabled = !r.ok; return r; };
  const close = () => { box.classList.remove('on'); inp.blur(); };
  const ok = () => { const r = check(); if (r.ok) { close(); o.done(r.value); } };
  inp.oninput = check;
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } else if (e.key === 'Escape') close(); };
  card.onclick = e => {
    const c = e.target.closest('.ma-chips button'); if (c) { close(); o.done(o.chips[+c.dataset.i].value); return; }
    if (e.target.closest('.ma-no')) close(); else if (e.target.closest('.ma-ok')) ok();
  };
  box.onclick = e => { if (e.target === box) close(); };
  closeMenu(); box.classList.add('on'); check();
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}
// Reschedule…: typed as on desktop ("fri", "11/26", "+3", "tm", "none"), or one tap on a common choice
function mReschedule(id) {
  const f = findTask(id); if (!f) return;
  const cur = f.task.date || null, t = todayISO();
  const chips = [{ label: 'Today', value: t }, { label: 'Tomorrow', value: addDays(t, 1) }];
  if (cur) chips.push({ label: '+1 day', value: addDays(cur, 1) }, { label: '+1 week', value: addDays(cur, 7) }, { label: 'No date', value: null });
  else chips.push({ label: 'Next week', value: addDays(t, 7) });
  mAsk({ title: 'Reschedule', sub: f.task.title + (cur ? ` · now ${fmtShort(cur)}` : ' · not scheduled'), value: cur ? fmtShort(cur) : '', placeholder: 'e.g. fri, Nov 26, +3', chips,
    read: s => { const v = parseDateText(s); return v === null ? { ok: false, hint: 'try Nov 26, 11/26, fri, td, tm, +3, none' } : v === '' ? { ok: true, hint: 'no date (unscheduled)', value: null } : { ok: true, hint: dayLabel(v), value: v }; },
    done: v => {
      if (v === cur || !findTask(id)) return;
      moveTask(id, v);
      mUndo(v ? `Moved to ${fmtShort(v)}` : 'Unscheduled');
    } });
}
function mRename(id) {
  const f = findTask(id); if (!f) return;
  const cur = f.task.title;
  mAsk({ title: 'Rename', value: cur, placeholder: 'Task name', read: s => ({ ok: !!s.trim(), value: s.trim() }),
    done: v => { const g = findTask(id); if (g && v !== cur) { mutate(() => { g.task.title = v; }); mUndo('Renamed'); } } });
}

/* ---------- long press: lift a task and drag it ---------- */
/* Hold a task still for M_HOLD ms and it lifts (a little buzz where the phone can): calendar chips go to another day
   (the day under the finger opens a gap as on desktop; held near the top or bottom edge, the weeks step on; over the
   header, it unschedules: calDropOn / moveTask); day-view blocks move in time or to another day, or into the sheet to
   come off the timeline; list items in the sheet go onto the timeline or elsewhere in the list (the desktop's own day
   view drag: dv, dvMove / dvUp, dayview-edit.js, fed from these touches). Let go without moving: its menu instead.
   A finger that moves before then is a swipe or a scroll, and nothing lifts. The browser's own long-press menu, and
   the click after a long press, are swallowed. */
const M_HOLD = 380, M_LIFTABLE = '#grid .day:not(.nb) .chip[data-id], #grid .day:not(.nb) .chip[data-fid], #dayview .dv-blk[data-id], #dayview .dv-item[data-id]';
let mLp = null, mLpAt = 0, mLpEat = null;   // mLpEat: the click a held-and-let-go task may still get, to swallow
document.body.insertAdjacentHTML('beforeend', `<div id="mDropOff">${ICON.nodate}<span>Drop here to unschedule</span></div>`);
window.addEventListener('touchstart', e => {
  if (mLp) mLpEnd(true);
  if (!MOBILE || e.touches.length !== 1 || mEdge || mClose || !e.target.closest) return;
  const el = e.target.closest(M_LIFTABLE); if (!el || e.target.closest('input, button, .inl')) return;
  if (el.dataset.fid && !el.matches('[draggable="true"]')) return;   // a failed attempt whose task is on a day again (failChip)
  const t = e.touches[0];
  mLp = { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, el, on: false, timer: setTimeout(mLift, M_HOLD) };
  mFollow(e, mLpMove, cancelled => mLpEnd(cancelled));
}, { capture: true, passive: true });
window.addEventListener('contextmenu', e => { if (MOBILE && (mLp || Date.now() - mLpAt < 800)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
// (and while a task is lifted, the browser calling its touch off as a gesture of its own mustn't drop the day-view drag:
// dayview-edit.js cancels it on pointercancel)
window.addEventListener('pointercancel', e => { if (MOBILE && mLp && mLp.on) e.stopImmediatePropagation(); }, true);
window.addEventListener('click', e => {
  const k = mLpEat; mLpEat = null;
  if (MOBILE && k && Date.now() < k.until && (k.el.contains(e.target) || !k.el.isConnected)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
function mLift() {
  const s = mLp; if (!s) return;
  s.on = true; mSw = null; mDs = null;   // (not a swipe after all)
  if (navigator.vibrate) navigator.vibrate(12);
  closeMenu(); admHideTip(true);
  if (s.el.closest('#grid')) mCalLift(s); else mDvLift(s);
}
function mLpMove(e) {
  const s = mLp; if (!s) return;
  const t = e.touches[0]; s.x = t.clientX; s.y = t.clientY;
  if (!s.on) { if (Math.hypot(s.x - s.x0, s.y - s.y0) > 6) { clearTimeout(s.timer); mLp = null; } return; }
  if (e.cancelable) e.preventDefault();   // (nothing scrolls under a lifted task)
  s.moved = s.moved || Math.hypot(s.x - s.x0, s.y - s.y0) > 6;
  if (s.cal) mCalDrag(s); else mDvDrag(s);
}
function mLpEnd(cancelled) {
  const s = mLp; mLp = null; if (!s) return;
  clearTimeout(s.timer);
  if (!s.on) return;
  mLpAt = Date.now();
  if (s.cal) mCalDrop(s, cancelled); else mDvDrop(s, cancelled);
  if (!cancelled && !s.moved) {   // held and let go in place: its menu (and not the click that may follow)
    mLpEat = { el: s.el, until: Date.now() + 450 };
    const at = { x: s.x, y: s.y }, el = s.el;
    if (el.dataset.fid) openFailMenu(el.dataset.fid, at); else if (findTask(el.dataset.id)) openTaskMenu(el.dataset.id, null, at, el.isConnected ? el : null);
  }
}
// calendar: a copy of the chip follows the finger; the chips of what moves with it dim where they are
function mCalLift(s) {
  const el = s.el, id = el.dataset.id || el.dataset.kid, r = el.getBoundingClientRect();
  drag = el.dataset.fid ? { kind: 'task', id, from: 'fail', fid: el.dataset.fid } : { kind: 'task', id, from: 'cal' };
  drag.ch = el.offsetHeight;
  s.cal = true; s.dx = s.x0 - r.left; s.dy = s.y0 - r.top;
  s.ghost = el.cloneNode(true); s.ghost.classList.add('m-ghost');
  Object.assign(s.ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
  document.body.appendChild(s.ghost);
  dragSrc = drag.from === 'fail' ? [el] : movingIds(id, false).flatMap(k => $$(`#grid .chip[data-id="${k}"]`));
  dragSrc.forEach(x => x.classList.add('dragsrc'));
  document.body.classList.add('m-lifting', drag.from === 'fail' ? 'm-nodropoff' : 'm-dropoff');
}
function mCalDrag(s) {
  s.ghost.style.left = (s.x - s.dx) + 'px'; s.ghost.style.top = (s.y - s.dy) + 'px';
  const under = document.elementFromPoint(s.x, s.y), head = s.y < $('header').getBoundingClientRect().bottom;
  s.off = head && drag.from !== 'fail';
  $('#mDropOff').classList.toggle('over', s.off);
  let day = !head && under && under.closest('#grid .day:not(.nb)');
  if (day && drag.from === 'fail' && under.closest(`.chip.failed[data-fid="${drag.fid}"]`)) day = null;   // back on its own chip: calls it off (failBail)
  if (day !== s.day) { $$('#grid .day.over').forEach(x => x.classList.remove('over')); if (day) day.classList.add('over'); else calGap.hide(); s.day = day || null; }
  if (day) calGapAt(day, false);
  // held near the top or bottom of the calendar: a week on, and another every so often while it stays there
  const g = $('#grid').getBoundingClientRect(), Z = 34;
  const dir = !head && s.y < g.top + Z ? -1 : s.y > g.bottom - Z ? 1 : 0;
  if (dir !== s.edge) {
    clearTimeout(s.edgeT); s.edge = dir;
    const step = () => { if (mLp !== s) return; calGap.hide(); $$('#grid .day.over').forEach(x => x.classList.remove('over')); s.day = null; weekShift(dir); s.edgeT = setTimeout(step, 800); };
    if (dir) s.edgeT = setTimeout(step, 550);
  }
}
function mCalDrop(s, cancelled) {
  clearTimeout(s.edgeT);
  s.ghost.remove(); dragSrc.forEach(x => x.classList.remove('dragsrc')); dragSrc = [];
  document.body.classList.remove('m-lifting', 'm-dropoff', 'm-nodropoff'); $('#mDropOff').classList.remove('over');
  $$('#grid .day.over').forEach(x => x.classList.remove('over'));
  const id = drag && drag.id;
  if (cancelled || !s.moved || !drag) { drag = null; calGap.hide(); return; }
  if (s.off) { drag = null; calGap.hide(); moveTask(id, null); mUndo('Unscheduled'); return; }
  if (!s.day) { drag = null; calGap.hide(); return; }
  const was = (findTask(id) || { task: {} }).task.date, date = s.day.dataset.date;
  calDropOn(s.day, false);
  if (was !== date) { if (navigator.vibrate) navigator.vibrate(8); mUndo(`Moved to ${fmtShort(date)}`); }
}
// day view: the desktop's drag (dv), started here and fed these touches as pointer positions
const mDvE = s => ({ clientX: s.x, clientY: s.y, target: document.elementFromPoint(s.x, s.y) || document.body, altKey: false });
function mDvLift(s) {
  const el = s.el, blk = el.classList.contains('dv-blk'), f = findTask(el.dataset.id); if (!f) { mLp = null; return; }
  closeTimePop(true);
  const p = planOf(f.task);
  dv = { id: f.task.id, date: f.task.date, title: f.task.title, color: colorOf(f.t), mode: blk ? 'move' : 'place', el, x0: s.x0, y0: s.y0, started: false, p0: p ? { ...p } : null, res: null };
  if (blk) dv.offY = s.y0 - el.getBoundingClientRect().top;
  el.classList.add('m-lifted');
  s.gen = stateGen;
  // from a tall sheet: it lowers, so there's timeline to drop on (and comes back after)
  if (!blk && mSheetH > innerHeight * 0.42) { s.sheetWas = mSheetH; mSheetSet(innerHeight * 0.34); }
}
function mDvDrag(s) { if (dv) { if (s.moved) s.el.classList.remove('m-lifted'); dvMove(mDvE(s)); } }
function mDvDrop(s, cancelled) {
  s.el.classList.remove('m-lifted');
  if (dv) dvUp(mDvE(s), cancelled || !s.moved);
  if (s.sheetWas) mSheetSet(s.sheetWas);
  if (!cancelled && s.moved && stateGen !== s.gen) mUndo('Task moved');
}
