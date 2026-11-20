'use strict';
/* Mobile mode (a phone-sized window: MOBILE_MQ). The same app with a different shell, layered on the desktop code:
   one column; a drawer from the left (the ☰ button, or a swipe in from the screen's left edge; swipe it back to close)
   holding the sidebar (calendar: its own tree, mTree, folded by tapping rows) or the Timeline's list of
   projects and threads; title-only chips on up to two lines, in weeks as tall as they need (mFit); full days show "…"
   instead of scrolling; a swipe up / down steps the calendar's weeks as the desktop's scroll does;
   day view shows one day, swipes sideways a day at a time, goes back to the calendar by a back button where ☰ was or
   a swipe in from the left edge (it has no drawer), and has
   its task list in a sheet along the bottom that's dragged up and down by its handle. No hover: a tap on a day opens it, a tap on a task anywhere opens its menu (which
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

/* ---------- pulling the header down: refresh ---------- */
/* A swipe down that starts on the header pulls a badge out from under it (#mPtr); past M_PTR px it's armed, and let go
   then, the page saves what's waiting and reloads with the latest plan (refreshPage, storage.js). Let go early: back. */
const M_PTR = 72;
document.body.insertAdjacentHTML('beforeend', `<div id="mPtr">${svg('<path d="M12 5v14M6 13l6 6 6-6"/>')}</div>`);
let mPt = null;
function mPtrAt(px, armed, settle) {
  const el = $('#mPtr'); el.classList.toggle('settle', !!settle); el.classList.toggle('armed', !!armed);
  el.style.transform = `translateY(${(px - 48).toFixed(1)}px)`; el.style.opacity = String(clamp(px / M_PTR, 0, 1));
}
$('header').addEventListener('touchstart', e => {
  if (!MOBILE || e.touches.length !== 1 || mPt || mEdge || $('#mPtr').classList.contains('spin') || $('#modal').style.display === 'grid') return;
  mPt = mTouch(e); mFollow(e, mPtMove, mPtEnd);
}, { passive: true });
function mPtMove(e) {
  const s = mPt; if (!s) return;
  const t = e.touches[0], dx = t.clientX - s.x0, dy = t.clientY - s.y0;
  if (!s.axis) { if (Math.hypot(dx, dy) < 8) return; s.axis = dy > Math.abs(dx) ? 'y' : 'n'; if (s.axis === 'n') { mPt = null; return; } closeMenu(); }
  if (e.cancelable) e.preventDefault();
  s.dx = Math.max(0, dy);
  mPtrAt(s.dx < M_PTR ? s.dx : M_PTR + (s.dx - M_PTR) * 0.3, s.dx >= M_PTR);   // (with resistance past the point)
}
async function mPtEnd(cancelled) {
  const s = mPt; mPt = null; if (!s || s.axis !== 'y') return;
  if (cancelled || s.dx < M_PTR) return mPtrAt(0, false, true);
  const el = $('#mPtr'); mPtrAt(M_PTR * 0.8, false, true); el.classList.add('spin');
  const why = await refreshPage();   // (nothing comes back if the page reloads)
  el.classList.remove('spin'); mPtrAt(0, false, true);
  if (why === 'offline') toast('Couldn’t reach your plan to refresh. Check your connection and try again.', 4000);
}

/* ---------- header and drawer ---------- */
$('header').insertAdjacentHTML('afterbegin', `<button class="ic" id="mBurger" aria-label="Menu">${svg('<path d="M4 6h16M4 12h16M4 18h16"/>')}</button>`
  + `<button class="ic" id="mBack" aria-label="Back to the calendar">${svg('<path d="m15 18-6-6 6-6"/>')}</button>`);
// day view has no drawer: in ☰'s place, a way back to the calendar (css shows one or the other)
$('#mBack').onclick = () => { closeMenu(); closeDay(); };
$('#app').insertAdjacentHTML('beforeend', '<div id="mScrim"></div>');
// the drawer: the sidebar, or in the Timeline its own list (css/mobile.css); none in day view (its list is the sheet)
const mDrawerEl = () => admOpen ? $('#admire .adm-side') : ui.dayView ? null : $('aside');
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
// and at its foot, the one button for adding a task (mAddTask)
$('#tree').insertAdjacentHTML('afterend', `<div class="m-foot"><button class="btn primary m-addk">${svg('<path d="M12 5v14M5 12h14"/>')}Add task</button></div>`);
$('aside .m-addk').onclick = () => mAddTask();
$('aside .m-bar').addEventListener('click', e => {
  const w = e.target.closest('.m-wk button');
  if (w) { setPull(0); mFocus = null; setWeekCount(+w.dataset.n); mBarSync(); return; }
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
  const el = mDrawerEl();
  if (!el) {   // day view (no drawer): in from the edge goes back to the calendar instead
    if (ui.dayView && !admOpen && !dayAnim && !dv && e.touches[0].clientX <= M_EDGE) { mEdge = mTouch(e); mEdge.W = innerWidth; mFollow(e, mBackMove, mBackEnd); }
    return;
  }
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
/* Back from day view by swiping in from the left edge: day view slides right with the finger, the calendar showing under
   it (drawn now: it isn't kept up to date while day view covers it), as an iPhone's back swipe does. Let go past about
   a third of the way, or with a flick, and it carries on and day view closes; otherwise it slides back. (While it's
   out, #dayview has a z-index, so the calendar's bars and weekday row stay under it: css #app.m-backing.) */
function mBackMove(e) {
  const s = mEdge; if (!s) return;
  const t = e.touches[0], dx = t.clientX - s.x0, dy = t.clientY - s.y0;
  if (!s.axis) {
    if (Math.hypot(dx, dy) < 8) return;
    s.axis = dx > Math.abs(dy) ? 'x' : 'y'; if (s.axis === 'y') { mEdge = null; return; }
    closeMenu(); closeTimePop(true); renderCal(); $('#app').classList.add('m-backing');
  }
  if (e.cancelable) e.preventDefault();
  s.dx = clamp(dx, 0, s.W); mVel(s, dx);
  dvBox.style.transition = 'none'; dvBox.style.transform = `translateX(${s.dx}px)`;
}
function mBackEnd(cancelled) {
  const s = mEdge; mEdge = null; if (!s || s.axis !== 'x') return;
  const back = !cancelled && (mFlick(s) ? s.vx > 0 : s.dx > s.W * 0.35);
  dvBox.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)'; dvBox.style.transform = back ? `translateX(${s.W}px)` : '';
  setTimeout(() => {
    if (back) closeDay();
    dvBox.style.transition = dvBox.style.transform = ''; $('#app').classList.remove('m-backing');
  }, 230);
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

/* ---------- calendar: week heights, and "…" for days that are full ---------- */
/* In each day under root (the weeks built ahead too), the chips that don't fit whole are hidden, one by one (a same-day
   group can lose its last ones), and a "…" goes below the last one shown. At least one always shows: if there isn't
   room for it and the "…" too, the "…" sits over its corner instead (.on). */
/* When a day already on screen changes what it shows (its row eased to another height, a resize), the change fades:
   chips coming back fade in, chips going and a "…" that moves or goes fade out where they were (a copy, .m-fade, laid
   over the day, as the chip itself is already display: none), and a new "…" fades in. mUnclip notes what was hidden
   (mWas) before showing it all; mClip compares with that. A day drawn afresh (renderCal) just shows its state. */
const M_MORE = 13, M_FADE = 200;   // px kept for the "…"; ms a fade takes
const mWas = new WeakMap(), mSeen = new WeakSet();   // mWas: items → { hid, more } as shown before mUnclip; mSeen: items clipped before
// el's box in day's own coordinates (what an absolutely placed copy needs)
const mBox = (el, day) => { const r = el.getBoundingClientRect(), d = day.getBoundingClientRect(); return { l: r.left - d.left - day.clientLeft, t: r.top - d.top - day.clientTop, w: r.width, h: r.height }; };
function mNote(it) {
  if (mWas.has(it)) return;
  const more = it.querySelector(':scope > .m-more');
  mWas.set(it, { hid: new Set(it.querySelectorAll('.m-hid')), more: more && mSeen.has(it) ? { el: more, box: mBox(more, it.parentElement) } : null });
}
const mUnclip = it => { mNote(it); for (const c of it.querySelectorAll('.m-hid')) c.classList.remove('m-hid'); const m = it.querySelector(':scope > .m-more'); if (m) m.remove(); };
function mFadeOut(day, el, box) {
  const g = el.cloneNode(true); g.classList.remove('m-hid'); g.classList.add('m-fade');
  for (const x of [g, ...g.querySelectorAll('[data-id], [data-fid], [data-kid]')]) { delete x.dataset.id; delete x.dataset.fid; delete x.dataset.kid; }   // (nothing finds it as a task)
  Object.assign(g.style, { left: box.l + 'px', top: box.t + 'px', width: box.w + 'px', height: box.h + 'px' });
  day.appendChild(g);
  g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: M_FADE, easing: 'ease-out' }).onfinish = () => g.remove();
}
const mFadeIn = el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: M_FADE, easing: 'ease-out' });
// el has an ancestor (inside it) in set: the ancestor's fade covers it
const mInSet = (el, set, it) => { for (let x = el.parentElement; x && x !== it; x = x.parentElement) if (set.has(x)) return true; return false; };
function mClip(root) {
  $$('.day .items', root).forEach(it => {
    mUnclip(it);
    const was = mWas.get(it), day = it.parentElement, fade = MOTION() && mSeen.has(it) && !!it.animate;
    mWas.delete(it); mSeen.add(it);
    let hide = new Set(), more = null;
    const chips = it.scrollHeight > it.clientHeight + 1 ? $$('.chip', it) : [];
    if (chips.length) {
      const bottom = it.getBoundingClientRect().bottom;
      let n = chips.findIndex(c => c.getBoundingClientRect().bottom > bottom - M_MORE);
      if (n >= 0) {
        n = Math.max(1, n);
        hide = new Set(chips.slice(n));
        for (const w of it.children) if (!w.classList.contains('chip') && ![...w.querySelectorAll('.chip')].some(c => !hide.has(c))) hide.add(w);   // (groups left empty)
        more = { over: chips[n - 1].getBoundingClientRect().bottom > bottom - M_MORE };
      }
    }
    // what goes fades out where it is now (measured before it's hidden; a copy below the day's edge is just clipped)
    if (fade) for (const el of hide) if (!was.hid.has(el) && !mInSet(el, hide, it)) mFadeOut(day, el, mBox(el, day));
    hide.forEach(el => el.classList.add('m-hid'));
    let mEl = null;
    if (more) { it.insertAdjacentHTML('beforeend', `<div class="m-more${more.over ? ' on' : ''}">…</div>`); mEl = it.lastElementChild; }
    if (!fade) return;
    const back = new Set([...was.hid].filter(el => !hide.has(el) && it.contains(el)));
    back.forEach(el => { if (!mInSet(el, back, it)) mFadeIn(el); });
    const old = was.more, nb = mEl && mBox(mEl, day);
    if (old && nb && Math.abs(old.box.t - nb.t) < 2 && Math.abs(old.box.l - nb.l) < 2) return;   // ("…" where it was)
    if (old) mFadeOut(day, old.el, old.box);
    if (mEl) mFadeIn(mEl);
  });
}
/* Week heights: what each week needs (weekNeeds, measured with every chip shown), shared out as on desktop (fitSizes):
   busy weeks take room the quiet ones don't need; if that's still not enough, rows are capped and full days end in
   "…" (mClip, after). days: 7 a week, in order. mNeed: the needs of the weeks just fitted (the view's), for mNbFit. */
let mNeed = [];
function mFit(days, H) {
  const its = days.map(d => d.querySelector('.items'));
  its.forEach(mNote); its.forEach(mUnclip);   // (all read, then all changed: one layout, not one per day)
  mNeed = weekNeeds(days);
  const n = mNeed.length, f = mFocus ? days.findIndex(d => d.dataset.date === mFocus) : -1;
  if (mFocus && f < 0) mFocus = null;
  days.forEach((d, i) => d.classList.toggle('m-foc', f >= 0 && Math.floor(i / 7) === Math.floor(f / 7)));   // (room kept at its foot for "Show less")
  let px;
  if (f < 0 || n < 2) px = fitSizes(mNeed, H).px;
  else {   // a week opened up (mFocusSet): all it needs (and room for its "Show less"), the others crushed to share the rest
    const w = Math.floor(f / 7), fh = Math.max(0, Math.min(mNeed[w] + M_BAR, H - M_CRUSH * (n - 1)));
    const rest = fitSizes(mNeed.filter((_, i) => i !== w), H - fh).px;
    px = [...rest.slice(0, w), fh, ...rest.slice(w)];
  }
  return { px, tpl: px.map(h => h.toFixed(1) + 'px').join(' ') };   // (px, not fr: rows can then ease from one size to another)
}
/* Opening up a week: a tap on a "…" makes its week as tall as all its tasks need, the other weeks crushed down to their
   day numbers and a chip or so (M_CRUSH), with a "Show less" at its foot to put things back. Changing weeks (or how
   many are shown) puts them back too. The rows ease to their new sizes (.m-anim). The "…" are worked out for where
   the rows end up before they move (laid out there for a moment, then put back to ease over), so a week too full to
   show everything opens only as far as it will go, its "…" already in place, and nothing is hidden again at the end. */
const M_CRUSH = 52, M_BAR = 30;   // M_BAR: .day.m-foc's extra padding (mobile.css)
let mFocus = null, mAnimT = 0;   // mFocus: the first day of the week opened up
function mFocusSet(ws) {
  mFocus = ws; const g = $('#grid');
  clearTimeout(mAnimT);
  const from = g.style.gridTemplateRows;
  g.classList.remove('m-anim');
  fitRows();   // (the rows where they end up, and their "…")
  if (!MOTION()) return;
  const to = g.style.gridTemplateRows;
  g.style.gridTemplateRows = from; void g.offsetHeight;   // back where they were, then ease over
  g.classList.add('m-anim'); g.style.gridTemplateRows = to;
  mAnimT = setTimeout(() => { g.classList.remove('m-anim'); mClip(g); }, 320);   // (mClip: only if a resize came mid-way)
}
// the "Show less" under the week opened up (a grid item along the bottom of its row)
function mFocusBar(g) {
  const old = g.querySelector(':scope > .m-less'); if (old) old.remove();
  if (!mFocus) return;
  const d = g.querySelector(`:scope > .day:not(.nb)[data-date="${mFocus}"]`); if (!d) return;
  g.insertAdjacentHTML('beforeend', `<button class="m-less" style="grid-row:${d.style.gridRowStart}">${svg('<path d="m6 15 6-6 6 6"/>')}Show less</button>`);
}
// the weeks built ahead (buildNeighbours): each as tall as it will be once a step brings it into view (fitted with the
// weeks it joins), so the step doesn't resize it as it lands
function mNbFit(g) {
  const H = g.clientHeight; if (!H || !mNeed.length) return;
  for (const side of ['above', 'below']) {
    const els = $$(`:scope > .nb.${side}`, g), days = els.filter(x => x.classList.contains('day')).sort((a, b) => a.dataset.date < b.dataset.date ? -1 : 1);
    if (days.length !== 7) continue;
    const nb = weekNeeds(days)[0], px = side === 'below' ? fitSizes(mNeed.slice(1).concat(nb), H).px.slice(-1)[0] : fitSizes([nb].concat(mNeed.slice(0, -1)), H).px[0];
    days.forEach(d => { d.style.height = px + 'px'; });
    if (side === 'above') els.forEach(x => { x.style.top = -px + 'px'; });
  }
}
// a tap on a task opens its menu (a failed attempt: the attempt's menu); anywhere else in a day opens the day in day
// view (its number does too, through its data-act). (stopPropagation: the document's click handler would close the menu)
let mSwipedAt = 0;
$('#grid').addEventListener('click', e => {
  if (!MOBILE || Date.now() - mSwipedAt < 400) return;
  if (e.target.closest('.m-less')) { mFocusSet(null); return; }
  const more = e.target.closest('.m-more');
  // ("…" in a week already opened up: some day still holds more than fits, so that day in day view)
  if (more) { const day = more.closest('.day'); if (day) { if (day.classList.contains('m-foc')) openDay(day.dataset.date); else mFocusSet(weekStartOf(day.dataset.date)); } return; }
  if (e.target.closest('[data-act], input, button')) return;
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
   (weekShift, from where the pull got to): one week, however fast the flick. Otherwise it springs back. */
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
    // (a week opened up stays so, "Show less" pulled along with it (setPull), unless the swipe steps on: weekShift)
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
  const dir = cancelled ? 0 : mDir(s, s.R);
  if (dir) weekShift(dir); else setPull(0, true);   // (one week, however hard the flick)
}

/* ---------- day view ---------- */
// sideways swipes over the timeline or the sheet's list: the day before and after follow the finger (enterStrip /
// setStripX, dayview.js: the list's days move sideways too); let go far enough (or with a flick) and it slides on
// (daySlide), otherwise back. Up / down: the hours or the list scroll as usual
let mDs = null;
const dvBox = $('#dayview');
dvBox.addEventListener('touchstart', e => {
  if (!MOBILE || !ui.dayView || admOpen || dayAnim || dv || mDs || mEdge || e.touches.length !== 1 || !e.target.closest('.dv-main, .dv-list')) return;
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
  if (!MOBILE) return;
  if (e.target.closest('.dv-madd')) { mAddTask(null, ui.dayView); return; }
  if (e.target.closest('input, button, .inl, [data-act]')) return;
  const el = e.target.closest('.dv-blk, .dv-item');
  // a tap on the timeline's blank space puts the sheet away (all the way down)
  if (!el) { if (e.target.closest('.dv-main') && !e.target.closest('.dv-conf') && mSheetH > M_PEEK + 2) mSheetSet(M_PEEK); return; }
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
const M_PEEK = 76;   // px: the handle and heading, and clear room below them for the phone's own swipes (the timeline keeps this much room below it: css .dv-main)
let mSheetH = M_PEEK, mSh = null;
// (all the way up stops short of the header, at about 70% of the screen, so its handle stays in a thumb's reach)
const mSheetMax = () => Math.max(M_PEEK, Math.min(innerHeight - $('header').offsetHeight - 10, Math.round(innerHeight * 0.7)));
function mSheetSet(h) {
  mSheetH = clamp(h, M_PEEK, mSheetMax()); dvBox.style.setProperty('--sheet-h', Math.round(mSheetH) + 'px');
  dvBox.classList.toggle('m-sheetmin', mSheetH <= M_PEEK + 2);   // (all the way down: just the heading, no half-shown list)
}
function mSheetAuto(d) {
  const ks = dayTasks(d), timed = ks.filter(it => planOf(it.k)).length;
  mSheetSet(ks.length && timed === ks.length ? M_PEEK : timed ? innerHeight * 0.45 : Infinity);
}
window.addEventListener('resize', () => { if (MOBILE) mSheetSet(mSheetH >= mSheetMax() - 1 ? Infinity : mSheetH); });
dvBox.addEventListener('pointerdown', e => {
  if (!MOBILE || mSh || !e.target.closest('.m-grab, .dv-side .sb-head') || e.target.closest('button')) return;   // (its Add task button: just a tap)
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
// opening the Timeline: today's week in the middle of the screen (openAdmire), not the start of all time
function mAdmToday() {
  const el = $('#admire'), td = $('#admire .adm-day.today'), row = td && td.closest('.adm-row'); if (!row) return;
  el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - (el.clientHeight - row.offsetHeight) / 2;
}
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
const M_CHEV = svg('<path d="m9 6 6 6-6 6"/>'), M_PLUS = svg('<path d="M12 5v14M5 12h14"/>');
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
  // (where the thread ends: a lifted task can be dropped there, mTreeAim; an empty thread says so)
  body += ks.length || t.threads.length ? `<div class="mt-end" data-tid="${t.id}"></div>` : `<div class="mt-empty mt-end" data-tid="${t.id}">No tasks yet</div>`;
  return mNode(t.id, 'mt-t', `<span class="mt-dot"></span><span class="mt-nm">${esc(t.name)}</span><span class="mt-cnt">${ks.length ? `${done}/${ks.length}` : ''}</span>`,
    body, `style="--c:${esc(colorOf(t))}"`);
}
// a task's row. Linked tasks as on desktop (renderTaskRow), less its bar down the chain's left: a box round its numbers
// that runs through same-day links and starts afresh at a next-day one, a short line joining the boxes
function mTask(t, k, loose) {
  const i = t.tasks.indexOf(k), nx = t.tasks[i + 1], chain = !!(k.linkToPrev || (nx && nx.linkToPrev));
  const cls = ['mt-task', k.done && 'done', chain && 'g', chain && !k.linkToPrev && 'gs', chain && !(nx && nx.linkToPrev) && 'ge'].filter(Boolean).join(' ');
  const num = ['mt-n', loose && 'nn', chain && 'nb', chain && k.linkToPrev !== 'sameDay' && 'nbs', chain && !(nx && nx.linkToPrev === 'sameDay') && 'nbe',
    k.linkToPrev === 'nextDay' && 'cin', nx && nx.linkToPrev === 'nextDay' && 'cout'].filter(Boolean).join(' ');
  return `<div class="${cls}" data-id="${k.id}"><span class="mt-ck">${k.done ? ICON.check : ''}</span>${loose && !chain ? '' : `<span class="${num}">${loose ? '' : i + 1}</span>`}<span class="mt-tt">${esc(k.title)}${noteMark(k)}</span><span class="mt-d">${k.done ? '' : k.date ? fmtRelative(k.date) : 'no date'}</span></div>`;
}
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

/* ---------- the warning bar: kept short ---------- */
// each warning is cut to two lines and the bar to about two warnings (css #warn); a tap on them shows them all (still
// capped, scrolling). New warnings start short again; m-over marks a bar with more than shows (faded at its foot).
{
  const w = $('#warn'), msg = $('#warn .msg');
  new MutationObserver(() => { w.classList.remove('m-open'); requestAnimationFrame(() => w.classList.toggle('m-over', msg.scrollHeight > msg.clientHeight + 2)); }).observe(msg, { childList: true });
  msg.addEventListener('click', () => { if (MOBILE && (w.classList.contains('m-over') || w.classList.contains('m-open'))) { w.classList.toggle('m-open'); armWarn(); } });
}

/* ---------- typing a date or a name: a box at the top (clear of the keyboard) ---------- */
// o: { title, sub, value, placeholder, read(text) → { ok, hint, value }, chips: [{ label, value }], ok, done(value),
//      cancel() (closed without saving), menuFor (a task id: opened from its menu, which stays open under it: mMenuBack),
//      toggle: { label, note } (a switch, off to start; done gets whether it's on as a second argument) }
const M_PENCIL = svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>');
document.body.insertAdjacentHTML('beforeend', '<div id="mAsk"><div class="ma-card"></div></div>');
function mAsk(o) {
  const box = $('#mAsk'), card = $('.ma-card', box);
  card.innerHTML = `<div class="ma-h">${esc(o.title)}</div>${o.sub ? `<div class="ma-sub">${esc(o.sub)}</div>` : ''}
    <input class="ma-in" spellcheck="false" autocomplete="off" enterkeyhint="done"><div class="ma-hint"></div>
    ${o.chips ? `<div class="ma-chips">${o.chips.map((c, i) => `<button data-i="${i}">${esc(c.label)}</button>`).join('')}</div>` : ''}
    ${o.toggle ? `<label class="switch ma-sw"><input type="checkbox"><span class="track"></span><span class="ma-sw-t"><b>${esc(o.toggle.label)}</b><span>${esc(o.toggle.note)}</span></span></label>` : ''}
    <div class="ma-btns"><button class="btn ma-no">Cancel</button><button class="btn primary ma-ok">${esc(o.ok || 'Save')}</button></div>`;
  const inp = $('.ma-in', card), hint = $('.ma-hint', card), okb = $('.ma-ok', card);
  inp.value = o.value || ''; inp.placeholder = o.placeholder || '';
  const check = () => { const r = o.read(inp.value); hint.textContent = r.hint || ''; hint.classList.toggle('bad', !r.ok); okb.disabled = !r.ok; return r; };
  const close = () => { box.classList.remove('on'); inp.blur(); if (o.menuFor) mMenuBack(o.menuFor); };
  const cancel = () => { close(); if (o.cancel) o.cancel(); };
  const sw = $('.ma-sw input', card), on = () => !!(sw && sw.checked);
  const ok = () => { const r = check(); if (r.ok) { close(); o.done(r.value, on()); } };
  inp.oninput = check;
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } else if (e.key === 'Escape') cancel(); };
  card.onclick = e => {
    const c = e.target.closest('.ma-chips button'); if (c) { close(); o.done(o.chips[+c.dataset.i].value, on()); return; }
    if (e.target.closest('.ma-no')) cancel(); else if (e.target.closest('.ma-ok')) ok();
  };
  box.onclick = e => { if (e.target === box) cancel(); };
  if (!o.menuFor) closeMenu();
  box.classList.remove('m-low'); mAskFit(); box.classList.add('on'); check();
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}
// Reschedule…: typed as on desktop ("fri", "11/26", "+3", "tm", "none"), or one tap on a common choice
function mReschedule(id) {
  const f = findTask(id); if (!f) return;
  const cur = f.task.date || null, t = todayISO();
  const chips = [{ label: 'Today', value: t }, { label: 'Tomorrow', value: addDays(t, 1) }];
  if (cur) chips.push({ label: '+1 day', value: addDays(cur, 1) }, { label: '+1 week', value: addDays(cur, 7) }, { label: 'No date', value: null });
  else chips.push({ label: 'Next week', value: addDays(t, 7) });
  mAsk({ title: 'Reschedule', menuFor: id, sub: f.task.title + (cur ? ` · now ${fmtShort(cur)}` : ' · not scheduled'), value: cur ? fmtShort(cur) : '', placeholder: 'e.g. fri, Nov 26, +3', chips,
    read: s => { const v = parseDateText(s); return v === null ? { ok: false, hint: 'try Nov 26, 11/26, fri, td, tm, +3, none' } : v === '' ? { ok: true, hint: 'no date (unscheduled)', value: null } : { ok: true, hint: dayLabel(v), value: v }; },
    // (as Option on desktop: just this task, its links cut, the rest of its thread left where it is; where that differs)
    toggle: mSplitMatters(f) ? { label: 'Only this task', note: 'Unlinks it and leaves the rest of its thread where it is' } : null,
    done: (v, only) => {
      if (v === cur || !findTask(id)) return;
      moveTask(id, v, only);
      mUndo(v ? `Moved to ${fmtShort(v)}` : 'Unscheduled');
    } });
}
// Rename…: a task ('k'), thread ('t') or project ('p'); also what naming a new thread or project opens (startRename:
// fresh), where Cancel takes the new one away again (mDropNew)
function mRenameAny(kind, id, fresh) {
  const gen = stateGen;
  let cur, set, what;
  if (kind === 'p') { const p = state.projects.find(x => x.id === id); if (!p) return; cur = p.name; what = 'Project name'; set = v => mutate(() => { p.name = v; }); }
  else if (kind === 't') { const f = findThread(id); if (!f) return; cur = f.t.name; what = 'Thread name'; set = v => mutate(() => { f.t.name = v; }); }
  else { const f = findTask(id); if (!f) return; cur = f.task.title; what = 'Task name'; set = v => mutate(() => { f.task.title = v; }); }
  mAsk({ title: fresh ? (kind === 'p' ? 'New project' : 'New thread') : 'Rename', value: cur, placeholder: what, menuFor: kind === 'k' ? id : null,
    cancel: fresh && kind !== 'k' ? () => mDropNew(kind, id, gen) : null,
    read: t => ({ ok: !!t.trim(), value: t.trim() }), done: v => { if (v !== cur) { set(v); if (!fresh) mUndo('Renamed'); } } });
}
// a new project or thread whose naming was cancelled: gone again. Nothing else changed since it was added: undone, as
// if it never was (and not left to redo); otherwise deleted (it's empty, so nothing asks first)
function mDropNew(kind, id, gen) {
  if (kind === 'p' ? !state.projects.some(x => x.id === id) : !findThread(id)) return;
  if (stateGen === gen && undoStack.length) { undo(); redoStack.pop(); return; }
  if (kind === 'p') delProject(id); else delThread(id);
}
const mRename = id => mRenameAny('k', id);
/* Adding tasks: the drawer's one "Add task" button (at its foot), day view's (in its sheet's heading: that day filled
   in), or a thread's menu. The box opens on the name, the keyboard up, the box just above it (m-low, mAskFit), with
   the thread it most likely goes in (mGuessThread; from a thread's menu, that thread) shown above. A tap there lists
   every project's threads and sub-threads as the drawer shows them (color dots, indented; mThreadRows) to pick
   another. A date is optional (typed as anywhere else). Undated, it goes at the end of the thread (addTasks); dated,
   where that date falls among the thread's tasks (addDayTasks). Add keeps the box open for the next one; Done closes it. */
/* Which thread a new task most likely goes in: the one last added to on this device, if that was in the last few
   hours (a run of adds); for a day (day view's button), the thread with the most unfinished tasks around it (a week
   either way, nearer ones counting more); otherwise the thread whose next unfinished task comes soonest (what's under
   way now); otherwise the first. */
const M_RECENT = 6 * 3600e3, M_LASTADD = 'planner.mLastAdd';
function mGuessThread(day) {
  let last = null; try { last = JSON.parse(localStorage.getItem(M_LASTADD)); } catch (e) {}
  if (last && Date.now() - last.at < M_RECENT && findThread(last.tid)) return last.tid;
  const best = score => { let id = null, top = 0; score.forEach((v, k) => { if (v > top) { top = v; id = k; } }); return id; };
  const open = allThreads().flatMap(({ t }) => t.tasks.filter(k => !k.done && k.date).map(k => [t.id, k.date]));
  if (day) {
    const near = new Map();
    open.forEach(([tid, d]) => { const n = Math.abs(diffDays(d, day)); if (n <= 7) near.set(tid, (near.get(tid) || 0) + 1 / (1 + n)); });
    const id = best(near); if (id) return id;
  }
  const today = todayISO(), soon = new Map();
  open.forEach(([tid, d]) => { if (d >= today) soon.set(tid, Math.max(soon.get(tid) || 0, 1 / (1 + diffDays(d, today)))); });
  return best(soon) || allThreads()[0].t.id;
}
// every thread and sub-thread, in the drawer's order (sub-threads where they sit among their parent's tasks)
function mThreadRows(p) {
  const out = [], rec = (t, depth) => { out.push({ t, depth }); layout(t).forEach(x => { if (x.kind !== 'task') rec(x.obj, depth + 1); }); };
  p.threads.forEach(t => rec(t, 0));
  return out;
}
function mAddTask(tid, day) {
  if (!allThreads().length) { toast('Add a project and a thread first.'); return; }
  if (!(tid && findThread(tid))) tid = mGuessThread(day);
  const box = $('#mAsk'), card = $('.ma-card', box);
  card.innerHTML = `<div class="ma-h">New task</div>
    <div class="ma-pick"><div class="ma-sub">Which thread?</div><div class="mp-list">${state.projects.map(p => {
      const rows = mThreadRows(p);
      return `<div class="mp-p">${esc(p.name)}</div>` + (rows.map(({ t, depth }) => `<button class="mp-t" data-tid="${t.id}" style="--c:${esc(colorOf(t))};--d:${depth}"><span class="mt-dot"></span><span class="mt-nm">${esc(t.name)}</span></button>`).join('')
        || '<div class="mp-none">No threads yet</div>');
    }).join('')}</div><div class="ma-btns"><button class="btn ma-no">Cancel</button></div></div>
    <div class="ma-form"><button class="ma-thr"><span class="mt-dot"></span><span class="ma-thr-t"><b></b><span></span></span><span class="ma-chg">Change</span></button>
    <input class="ma-in ma-name" placeholder="Task name" spellcheck="true" enterkeyhint="done">
    <input class="ma-in ma-when" placeholder="Date (optional): fri, 11/26, +3" spellcheck="false" autocomplete="off" enterkeyhint="done">
    <div class="ma-hint"></div>
    <div class="ma-btns"><button class="btn ma-no">Done</button><button class="btn primary ma-ok">Add</button></div></div>`;
  const name = $('.ma-name', card), when = $('.ma-when', card), hint = $('.ma-hint', card), list = $('.mp-list', card);
  if (day) when.value = fmtShort(day);
  let added = null;
  const date = () => parseDateText(when.value);   // '' = none, null = can't read it
  const check = () => { const d = date(); hint.classList.toggle('bad', d === null); hint.textContent = d === null ? 'try Nov 26, 11/26, fri, td, tm, +3' : added ? `Added “${added}”` : d ? dayLabel(d) : 'No date: at the end of the thread'; return d; };
  // the thread: picked (the form, its name typed into straight away) or being picked (the list, the current one marked)
  const pick = id => {
    const f = findThread(id); if (!f) return;
    tid = id; card.classList.remove('picking');
    const b = $('.ma-thr', card); b.style.setProperty('--c', colorOf(f.t));
    $('b', b).textContent = f.t.name; $('.ma-thr-t span', b).textContent = [f.p.name, ...f.path.slice(0, -1)].join(' › ');
    name.focus();   // (in the tap's own handler, so the phone's keyboard comes up)
  };
  const picking = () => {
    name.blur(); when.blur(); card.classList.add('picking');
    $$('.mp-t', list).forEach(b => b.classList.toggle('on', b.dataset.tid === tid));
    const on = $('.mp-t.on', list); if (on) on.scrollIntoView({ block: 'center' });
  };
  const add = () => {
    const d = check(), v = name.value.trim(); if (d === null || !v) { if (!v) name.focus(); return; }
    const f = findThread(tid); if (!f) return;
    try { localStorage.setItem(M_LASTADD, JSON.stringify({ tid, at: Date.now() })); } catch (e) {}
    ui.collapsed[tid] = false; ui.collapsed[f.p.id] = false; saveUI();
    if (d) addDayTasks(tid, [v], null, d); else { addTasks(tid, [v], null); addOpen = focusAdd = null; }
    added = v; name.value = ''; check(); name.focus();
  };
  const close = () => { box.classList.remove('on'); name.blur(); when.blur(); if (added) mUndo(`Added “${added}”`); };
  when.oninput = () => { added = null; check(); };
  name.onkeydown = when.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } else if (e.key === 'Escape') close(); };
  card.onclick = e => {
    const t = e.target.closest('.mp-t'); if (t) { pick(t.dataset.tid); return; }
    if (e.target.closest('.ma-thr')) picking(); else if (e.target.closest('.ma-ok')) add(); else if (e.target.closest('.ma-no')) close();
  };
  box.onclick = e => { if (e.target === box) close(); };
  closeMenu(); box.classList.add('on', 'm-low'); mAskFit(); check();
  pick(tid);   // (now, in the tap that opened it, so the phone's keyboard comes up)
}
// the new task box sits at the bottom of what's visible: just above the keyboard while it's up (the visual viewport
// shrinks to what the keyboard leaves; iOS may also scroll it)
function mAskFit() {
  const box = $('#mAsk'), vv = window.visualViewport, low = box.classList.contains('m-low') && box.classList.contains('on');
  box.style.top = low && vv ? vv.offsetTop + 'px' : ''; box.style.height = low && vv ? vv.height + 'px' : '';
  box.classList.toggle('m-kb', !!(low && vv && vv.height < innerHeight - 120));   // (keyboard up: no room kept for the home bar)
}
if (window.visualViewport) { visualViewport.addEventListener('resize', mAskFit); visualViewport.addEventListener('scroll', mAskFit); }
// day view's: in the sheet's heading (renderDay puts it there)
const mDayAddBtn = () => `<button class="dv-madd" aria-label="Add task to this day">${M_PLUS}<span>Add task</span></button>`;

/* ---------- long press: lift a task and drag it ---------- */
/* Hold a task still for M_HOLD ms and it lifts (a little buzz where the phone can): calendar chips go to another day
   (the day under the finger opens a gap as on desktop; held near the top or bottom edge, the weeks step on; over the
   header, it unschedules: calDropOn / moveTask); day-view blocks move in time or to another day, or into the sheet to
   come off the timeline; list items in the sheet go onto the timeline or elsewhere in the list (the desktop's own day
   view drag: dv, dvMove / dvUp, dayview-edit.js, fed from these touches). Let go without moving: its menu instead.
   A finger that moves before then is a swipe or a scroll, and nothing lifts. The browser's own long-press menu, and
   the click after a long press, are swallowed. What lifts is what moves: a same-day linked group lifts whole.
   Held still for M_PEEL ms more once lifted, the task peels off on its own (mPeel: a second buzz, the copy under the
   finger just that task, outlined dashed), as Option does on desktop (s.split: movingIds / calLanding / calDropOn /
   moveTasksTo / dv's altKey): its links are cut and the rest of its thread stays put. Only where that would make a
   difference (mSplitMatters); moving first is an ordinary drag. */
const M_PEEL = 550;
const M_HOLD = 380, M_LIFTABLE = '#grid .day:not(.nb) .chip[data-id], #grid .day:not(.nb) .chip[data-fid], #dayview .dv-blk[data-id], #dayview .dv-item[data-id], #tree .mt-task[data-id], #tree .mt-row[data-mtog]';
let mLp = null, mLpAt = 0, mLpEat = null;   // mLpEat: the click a held-and-let-go task may still get, to swallow
document.body.insertAdjacentHTML('beforeend', `<div id="mDropOff">${ICON.nodate}<span>Drop here to unschedule</span></div>`);
window.addEventListener('touchstart', e => {
  if (mLp) mLpEnd(true);
  if (!MOBILE || e.touches.length !== 1 || mEdge || !e.target.closest) return;   // (mClose may be set: a touch on the open drawer)
  const el = e.target.closest(M_LIFTABLE); if (!el || e.target.closest('input, button, .inl')) return;
  if (el.dataset.fid && !el.matches('[draggable="true"]')) return;   // a failed attempt whose task is on a day again (failChip)
  const t = e.touches[0];
  mLp = { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, el, split: false, on: false, timer: setTimeout(mLift, M_HOLD) };
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
  if (s.el.closest('#tree')) mClose = null;   // (the drawer stays put)
  if (s.el.matches('.mt-row')) {   // a project or thread in the drawer: its menu
    s.row = true; const id = s.el.dataset.mtog;
    if (s.el.parentElement.classList.contains('mt-p')) openProjectMenu(id, s.el); else openThreadMenu(id, s.el);
  } else if (s.el.closest('#tree')) mTreeLift(s);
  else if (s.el.closest('#grid')) mCalLift(s); else mDvLift(s);
  const f = !s.row && mLp === s && s.el.dataset.id && findTask(s.el.dataset.id);
  if (f && mSplitMatters(f)) s.peelT = setTimeout(() => mPeel(s), M_PEEL);
}
/* Would moving just this task (Option) differ from an ordinary move? Yes when it's linked (the rest of its chain would
   come with it), or when an ordinary move would shift what comes later in its thread (Settings' shiftLater, an ordered
   thread, a dated task, something dated and unfinished after it). */
function mSplitMatters(f) {
  const [a, b] = runOf(f.t, f.i); if (b > a) return true;
  if (!f.task.date || !ui.shiftLater || isLoose(f.p, f.t)) return false;
  const L = layout(f.t), at = L.findIndex(x => x.obj === f.task);
  return L.slice(at + 1).some(x => x.kind !== 'task' || (x.obj.date && !x.obj.done));
}
// held still a moment longer: just this task (the copy under the finger and what's dimmed show it)
function mPeel(s) {
  if (mLp !== s || s.moved || s.split) return;
  s.split = true;
  if (navigator.vibrate) navigator.vibrate([8, 50, 8]);
  if (s.tree) { s.src.forEach(x => x.classList.remove('dragsrc')); s.ghost.remove(); mTreeGhost(s); mTreeAim(s); }
  else if (s.cal) { dragSrc.forEach(x => x.classList.remove('dragsrc')); s.ghost.remove(); mCalGhost(s); calGap.hide(); }
  else s.el.classList.add('m-split');
}
function mLpMove(e) {
  const s = mLp; if (!s) return;
  const t = e.touches[0]; s.x = t.clientX; s.y = t.clientY;
  if (!s.on) { if (Math.hypot(s.x - s.x0, s.y - s.y0) > 6) { clearTimeout(s.timer); mLp = null; } return; }
  if (s.row) return;
  if (e.cancelable) e.preventDefault();   // (nothing scrolls under a lifted task)
  if (!s.moved && Math.hypot(s.x - s.x0, s.y - s.y0) > 6) { s.moved = true; clearTimeout(s.peelT); }   // (a drag: no peeling off now)
  if (s.tree) mTreeDrag(s); else if (s.cal) mCalDrag(s); else mDvDrag(s);
}
function mLpEnd(cancelled) {
  const s = mLp; mLp = null; if (!s) return;
  clearTimeout(s.timer);
  clearTimeout(s.peelT);
  if (!s.on) return;
  mLpAt = Date.now();
  if (s.row) { mLpEat = { el: s.el, until: Date.now() + 450 }; return; }   // (its menu is open; the click would fold it)
  if (s.tree) mTreeDrop(s, cancelled); else if (s.cal) mCalDrop(s, cancelled); else mDvDrop(s, cancelled);
  if (!cancelled && !s.moved) {   // held and let go in place: its menu (and not the click that may follow)
    mLpEat = { el: s.el, until: Date.now() + 450 };
    const at = { x: s.x, y: s.y }, el = s.el;
    if (el.dataset.fid) openFailMenu(el.dataset.fid, at); else if (findTask(el.dataset.id)) openTaskMenu(el.dataset.id, null, at, el.isConnected ? el : null);
  }
}
// the drawer's tree: a task lifted moves up and down (to another place in its thread, or another thread); a line shows
// where it would go, snapping to the ends of a linked chain, which moves whole (moveTasksTo, as dropping it in the
// desktop's sidebar); near the top or bottom, the list scrolls
document.body.insertAdjacentHTML('beforeend', '<div id="mTreeLine"></div>');
function mTreeLift(s) {
  s.tree = true; mTreeGhost(s);
  document.body.classList.add('m-lifting');
}
// what moves (its chain; peeled off, just it), dimmed where it is, and a copy of it following the finger, rows one under the other
function mTreeGhost(s) {
  const el = s.el;
  s.ids = movingIds(el.dataset.id, s.split);
  s.src = s.ids.map(k => $(`#tree .mt-task[data-id="${k}"]`)).filter(Boolean);
  const rows = s.src.length ? s.src : [el], r0 = rows[0].getBoundingClientRect(), r1 = rows[rows.length - 1].getBoundingClientRect();
  s.dy = s.y - r0.top;
  s.ghost = document.createElement('div'); s.ghost.className = 'm-ghost mt-ghost' + (s.split ? ' m-split' : '');
  rows.forEach(x => { const c = x.cloneNode(true); c.style.setProperty('--c', getComputedStyle(x).getPropertyValue('--c')); s.ghost.appendChild(c); });
  Object.assign(s.ghost.style, { left: r0.left + 'px', top: r0.top + 'px', width: r0.width + 'px', height: (r1.bottom - r0.top) + 'px' });
  document.body.appendChild(s.ghost);
  s.src.forEach(x => x.classList.add('dragsrc'));
}
function mTreeDrag(s) {
  s.ghost.style.top = (s.y - s.dy) + 'px';
  const tree = $('#tree'), tr = tree.getBoundingClientRect(), Z = 48;
  s.scrollV = s.y < tr.top + Z ? -(tr.top + Z - s.y) : s.y > tr.bottom - Z ? s.y - (tr.bottom - Z) : 0;
  if (s.scrollV && !s.scrollRaf) {
    const step = () => { s.scrollRaf = 0; if (mLp !== s || !s.scrollV) return; tree.scrollTop += Math.sign(s.scrollV) * Math.min(14, Math.ceil(Math.abs(s.scrollV) / 3)); mTreeAim(s); s.scrollRaf = requestAnimationFrame(step); };
    s.scrollRaf = requestAnimationFrame(step);
  }
  mTreeAim(s);
}
function mTreeAim(s) {
  const shown = el => !el.closest('.mt-node.closed > .mt-body');
  let best = null;
  for (const row of $$('#tree .mt-task[data-id]')) {
    if (s.ids.includes(row.dataset.id) || !shown(row)) continue;
    const r = row.getBoundingClientRect(); if (!r.height) continue;
    for (const [side, y] of [['before', r.top], ['after', r.bottom]]) { const d = Math.abs(s.y - y); if (!best || d < best.d) best = { d, side, row }; }
  }
  for (const add of $$('#tree .mt-end[data-tid]')) {   // the end of a thread (an empty one too)
    if (!shown(add)) continue; const r = add.getBoundingClientRect(); if (!r.height) continue;
    const d = Math.abs(s.y - (r.top + r.height / 2)); if (!best || d < best.d) best = { d, add };
  }
  let spot = null, at = null;
  if (best && best.d < 60) {
    if (best.add) { spot = { tid: best.add.dataset.tid, refId: null, side: 'after' }; const r = best.add.getBoundingClientRect(); at = { y: r.top, left: r.left, width: r.width }; }
    else {
      const g = findTask(best.row.dataset.id);
      if (g) {
        const [a, b] = runOf(g.t, g.i), anchor = g.t.tasks[best.side === 'before' ? a : b], el = $(`#tree .mt-task[data-id="${anchor.id}"]`) || best.row, r = el.getBoundingClientRect();
        spot = { tid: g.t.id, refId: anchor.id, side: best.side }; at = { y: best.side === 'before' ? r.top : r.bottom, left: r.left, width: r.width };
      }
    }
    if (spot && ((spot.refId && s.ids.includes(spot.refId)) || isNoopTasks(s.el.dataset.id, s.split, spot))) spot = null;
  }
  s.spot = spot;
  const line = $('#mTreeLine');
  if (spot) Object.assign(line.style, { display: 'block', top: (at.y - 1) + 'px', left: at.left + 'px', width: at.width + 'px' }); else line.style.display = 'none';
}
function mTreeDrop(s, cancelled) {
  cancelAnimationFrame(s.scrollRaf); s.scrollV = 0;
  s.ghost.remove(); s.src.forEach(x => x.classList.remove('dragsrc')); document.body.classList.remove('m-lifting'); $('#mTreeLine').style.display = 'none';
  if (cancelled || !s.moved || !s.spot) return;
  const g0 = stateGen; moveTasksTo(s.el.dataset.id, s.split, s.spot);
  if (stateGen !== g0) { if (navigator.vibrate) navigator.vibrate(8); mUndo('Task moved'); }
}
// calendar: a copy of the chip follows the finger; the chips of what moves with it dim where they are
function mCalLift(s) {
  const el = s.el, id = el.dataset.id || el.dataset.kid;
  drag = el.dataset.fid ? { kind: 'task', id, from: 'fail', fid: el.dataset.fid } : { kind: 'task', id, from: 'cal' };
  drag.ch = el.offsetHeight;
  s.cal = true; mCalGhost(s);
  document.body.classList.add('m-lifting', drag.from === 'fail' ? 'm-nodropoff' : 'm-dropoff');
}
// a copy of what's lifted following the finger (a chip in a same-day linked group: the group, which lands together,
// calLanding; peeled off, just the chip), and the chips of what moves with it dimmed
function mCalGhost(s) {
  const el = s.el, up = (!s.split && el.dataset.id && el.closest('.grp')) || el, r = up.getBoundingClientRect();
  s.dx = s.x - r.left; s.dy = s.y - r.top;
  s.ghost = up.cloneNode(true); s.ghost.classList.add('m-ghost'); if (s.split) s.ghost.classList.add('m-split');
  Object.assign(s.ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });   // (the size it had)
  document.body.appendChild(s.ghost);
  dragSrc = drag.from === 'fail' ? [el] : movingIds(drag.id, s.split).flatMap(k => $$(`#grid .chip[data-id="${k}"]`));
  dragSrc.forEach(x => x.classList.add('dragsrc'));
}
function mCalDrag(s) {
  s.ghost.style.left = (s.x - s.dx) + 'px'; s.ghost.style.top = (s.y - s.dy) + 'px';
  const under = document.elementFromPoint(s.x, s.y), head = s.y < $('header').getBoundingClientRect().bottom;
  s.off = head && drag.from !== 'fail';
  $('#mDropOff').classList.toggle('over', s.off);
  let day = !head && under && under.closest('#grid .day:not(.nb)');
  if (day && drag.from === 'fail' && under.closest(`.chip.failed[data-fid="${drag.fid}"]`)) day = null;   // back on its own chip: calls it off (failBail)
  if (day !== s.day) { $$('#grid .day.over').forEach(x => x.classList.remove('over')); if (day) day.classList.add('over'); else calGap.hide(); s.day = day || null; }
  if (day) calGapAt(day, !!s.split);
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
  if (s.off) { drag = null; calGap.hide(); moveTask(id, null, !!s.split); mUndo('Unscheduled'); return; }
  if (!s.day) { drag = null; calGap.hide(); return; }
  const was = (findTask(id) || { task: {} }).task.date, date = s.day.dataset.date;
  calDropOn(s.day, !!s.split);
  if (was !== date) { if (navigator.vibrate) navigator.vibrate(8); mUndo(`Moved to ${fmtShort(date)}`); }
}
// day view: the desktop's drag (dv), started here and fed these touches as pointer positions
const mDvE = s => ({ clientX: s.x, clientY: s.y, target: document.elementFromPoint(s.x, s.y) || document.body, altKey: !!s.split });   // (peeled off: as Option)
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
  s.el.classList.remove('m-lifted', 'm-split');
  if (dv) dvUp(mDvE(s), cancelled || !s.moved);
  if (s.sheetWas) mSheetSet(s.sheetWas);
  if (!cancelled && s.moved && stateGen !== s.gen) mUndo('Task moved');
}

/* ---------- the task menu ---------- */
// its title bar: which task (and where it sits); it's also where the menu is swiped down from
function mMenuHead(f) { return mMenuHeadOf(f.task.title, [f.t.name, f.task.date ? fmtShort(f.task.date) : 'no date'].join(' · '), colorOf(f.t)); }
// the same for a thread or project (no color: no dot)
const mMenuHeadOf = (title, sub, color) => `<div class="m-mh" ${color ? `style="--c:${esc(color)}"` : ''}>${color ? '<span class="m-mh-d"></span>' : ''}<div class="m-mh-t"><b>${esc(title)}</b><span>${esc(sub)}</span></div></div>`;
/* While a menu is open, a tap anywhere outside it only closes it: nothing under the tap reacts. A tap on another task
   (chip, block, list item, the drawer's tree) still goes to it, so its menu takes this one's place. A swipe that
   starts outside closes it too, and lets the swipe through. */
const M_TASKS = '#grid .chip[data-id], #grid .chip[data-fid], #dayview .dv-blk[data-id], #dayview .dv-blk[data-fid], #dayview .dv-item[data-id], #dayview .dv-item[data-fid], .mt-task';
let mMenuEat = null;
window.addEventListener('pointerdown', e => {
  mMenuEat = null;
  if (!MOBILE || menu.style.display !== 'block' || !e.target.closest || menu.contains(e.target) || e.target.closest(M_TASKS) || mPopOpen()) return;
  mMenuEat = { at: Date.now(), x: e.clientX, y: e.clientY };
  e.stopImmediatePropagation();
}, true);
window.addEventListener('touchmove', e => {
  const k = mMenuEat; if (!k) return;
  const t = e.touches[0]; if (Math.hypot(t.clientX - k.x, t.clientY - k.y) > 10) { mMenuEat = null; closeMenu(); }
}, { capture: true, passive: true });
window.addEventListener('click', e => {
  const k = mMenuEat; mMenuEat = null;
  if (!k || Date.now() - k.at > 1500) return;
  e.preventDefault(); e.stopImmediatePropagation(); closeMenu();
}, true);
/* The task menu's Reschedule…, Rename…, View/edit notes and Set a time… open their box over it (#mAsk, #tpop) and the
   menu stays open under it: taps there are the box's own (mMenuEat, the document's click handler and the page scrolling
   as the keyboard opens all leave the menu be: mPopOpen), and once the box closes the menu is drawn again for the task
   as it now is (mMenuBack; menu.dataset.kid: the task it's open for, set by openTaskMenu). */
const mPopOpen = () => $('#mAsk').classList.contains('on') || $('#tpop').style.display === 'block';
function mMenuBack(id) {
  setTimeout(() => {   // (after the change the box made, and its redraw)
    if (!MOBILE || menu.style.display !== 'block' || menu.dataset.kid !== id || mPopOpen()) return;
    if (findTask(id)) openTaskMenu(id, null, { x: 0, y: 0 }, menuTask && menuTask.isConnected ? menuTask : null); else closeMenu();
  }, 0);
}
// swiping it down (from its title bar, or anywhere on it when it isn't scrolled) closes it; let go early, it springs back
let mMs = null;
menu.addEventListener('touchstart', e => {
  if (!MOBILE || e.touches.length !== 1) return;
  mMs = mTouch(e); mFollow(e, mMenuMove, mMenuEnd);
}, { passive: true });
function mMenuMove(e) {
  const s = mMs; if (!s) return;
  const t = e.touches[0], dx = t.clientX - s.x0, dy = t.clientY - s.y0;
  if (!s.axis) { if (Math.hypot(dx, dy) < 6) return; s.axis = dy > Math.abs(dx) && (menu.scrollTop <= 0 || e.target.closest('.m-mh')) ? 'y' : 'n'; }
  if (s.axis !== 'y') return;
  if (e.cancelable) e.preventDefault();
  s.dx = Math.max(0, dy); mVel(s, dy);
  menu.style.transition = 'none'; menu.style.transform = `translateY(${s.dx}px)`;
}
function mMenuEnd(cancelled) {
  const s = mMs; mMs = null; if (!s || s.axis !== 'y') return;
  const h = menu.offsetHeight, shut = !cancelled && ((mFlick(s) && s.vx > 0) || s.dx > h * 0.3);
  menu.style.transition = 'transform .2s ease-out';
  menu.style.transform = shut ? `translateY(${h + 30}px)` : '';
  setTimeout(() => { if (shut) closeMenu(); menu.style.transform = menu.style.transition = ''; }, 200);
}

/* ---------- notes ---------- */
/* View/edit notes (or Add notes): a card at the top, its text readable (links work); a tap on the text edits it, in a
   box big enough not to make the phone zoom. Saving it empty removes the notes. Opened from the task menu, which stays
   open under it. (The desktop's note, opened beside the
   task, closes as soon as the page scrolls, which the phone's keyboard does as it opens.) */
function mNotes(id, editing) {
  const f = findTask(id); if (!f) return;
  const box = $('#mAsk'), card = $('.ma-card', box), notes = f.task.notes || '';
  const head = `<div class="m-mh" style="--c:${esc(colorOf(f.t))}"><span class="m-mh-d"></span><div class="m-mh-t"><b>${esc(f.task.title)}</b><span>Notes</span></div></div>`;
  const close = () => { box.classList.remove('on'); const ta = card.querySelector('textarea'); if (ta) ta.blur(); mMenuBack(id); };
  box.onclick = e => { if (e.target === box) close(); };
  if (!editing && notes) {
    card.innerHTML = `${head}<div class="mn-b">${linkifyNotes(notes)}</div><div class="mn-k">Tap the notes to edit</div>
      <div class="ma-btns"><button class="btn ma-no">Close</button><button class="btn primary mn-ed">Edit</button></div>`;
    card.onclick = e => {
      if (e.target.closest('a')) return;   // (a link: just opens it)
      if (e.target.closest('.mn-b, .mn-ed')) mNotes(id, true); else if (e.target.closest('.ma-no')) close();
    };
  } else {
    card.innerHTML = `${head}<textarea class="mn-ta" spellcheck="true" placeholder="Anything to remember for this task"></textarea>
      <div class="ma-btns">${notes ? '<button class="btn mn-del">Delete</button><span class="m-sp"></span>' : ''}<button class="btn ma-no">Cancel</button><button class="btn primary ma-ok">Save</button></div>`;
    const ta = card.querySelector('textarea'); ta.value = notes;
    const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, innerHeight * 0.45) + 'px'; };
    ta.oninput = fit;
    card.onclick = e => {
      if (e.target.closest('.ma-ok')) { const v = ta.value.trim(); close(); if (v !== notes.trim()) setTaskNotes(id, v); }
      else if (e.target.closest('.mn-del')) { close(); setTaskNotes(id, ''); mUndo('Notes deleted'); }
      else if (e.target.closest('.ma-no')) { if (notes) mNotes(id, false); else close(); }
    };
    setTimeout(() => { fit(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
  }
  box.classList.remove('m-low'); mAskFit(); box.classList.add('on');   // (the task menu stays open under it: mMenuBack)
}
