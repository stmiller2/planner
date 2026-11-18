'use strict';
/* Mobile mode (a phone-sized window: MOBILE_MQ). The same app with a different shell, layered on the desktop code:
   one column; the sidebar (calendar), day view's task list (day view) or the Timeline's list of projects and threads
   (Timeline) slides in as a drawer from the ☰ button; one-line title-only chips; full days show "…" instead of scrolling; the calendar pages sideways ui.weeks at a
   time; day view shows one day and swipes sideways a day at a time. No drag and drop or hover: a tap on a day opens it,
   a tap on a task in day view opens its menu (which has Mark done here); in the
   Timeline the chart takes the full width and a tap on a dot or day opens its list at once. Styles: css/mobile.css, all under body.mobile.
   Hooks elsewhere check MOBILE: chip / failChip / archived chips and fitRows (calendar.js), buildNeighbours and the
   calendar wheel (calendar.js), dayN (dayview.js), the day-view click / drag handlers (dayview-edit.js), setSbw and
   navStep / navToday (app.js), openTaskMenu (sidebar.js), the notes hover (notes.js), renderAdmire's widths and the
   list's fold arrows (timeline.js). */
const MOBILE_MQ = matchMedia('(max-width: 700px), (pointer: coarse) and (max-height: 500px)');
let MOBILE = MOBILE_MQ.matches;
document.body.classList.toggle('mobile', MOBILE);
MOBILE_MQ.addEventListener('change', () => {
  MOBILE = MOBILE_MQ.matches; document.body.classList.toggle('mobile', MOBILE);
  mDrawer(false); mPagerDrop();
  if (weekAnim) weekAnim.finish();
  if (dayAnim) dayAnim.finish(); else if (dayStrip) exitStrip(null);
  setSbw(ui.sbw);
  if (dataLoaded) render();
});

/* ---------- header and drawers ---------- */
$('header').insertAdjacentHTML('afterbegin', `<button class="ic" id="mBurger" aria-label="Menu">${svg('<path d="M4 6h16M4 12h16M4 18h16"/>')}</button>`);
$('#app').insertAdjacentHTML('beforeend', '<div id="mScrim"></div>');
// the drawer is the sidebar in the calendar, day view's task list in day view, the Timeline's list in the Timeline
// (css/mobile.css)
function mDrawer(open) { $('#app').classList.toggle('mdrawer', !!open); if (open) mFootSync(); }
$('#mBurger').onclick = () => mDrawer(!$('#app').classList.contains('mdrawer'));
$('#mScrim').onclick = () => mDrawer(false);
// going to another view or day closes it
document.addEventListener('click', e => { if (MOBILE && e.target.closest && e.target.closest('.views button, [data-act="openday"]')) mDrawer(false); }, true);
// the sidebar drawer's footer stands in for the header's right side: weeks shown, save status, style, Settings, Help,
// account (online). Its buttons click the header's own (data-m), so those stay the only code for them.
$('aside').insertAdjacentHTML('beforeend', `<div class="m-foot">
  <div class="m-row"><span class="m-wkl">Weeks shown</span><div class="seg m-wk">${[1, 2, 3, 4, 5].map(n => `<button data-n="${n}">${n}</button>`).join('')}</div></div>
  <div class="m-row"><button class="m-status" data-m="status"></button><span class="m-sp"></span>
  <button class="ic" data-m="themeBtn" aria-label="Style"></button><button class="ic" data-m="setBtn" aria-label="Settings"></button>
  <button class="btn" data-m="helpBtn" aria-label="Help">?</button><button class="m-acct" data-act="acct" aria-label="Account" hidden></button></div>`);
function mFootSync() {
  const f = $('aside .m-foot');
  $$('.m-wk button', f).forEach(b => b.classList.toggle('on', +b.dataset.n === ui.weeks));
  ['themeBtn', 'setBtn'].forEach(id => { $(`[data-m="${id}"]`, f).innerHTML = $('#' + id).innerHTML; });
  $('[data-m="status"]', f).textContent = $('#status').textContent;
  const acct = $('#acctBtn'), a = $('.m-acct', f); a.hidden = acct.hidden; a.textContent = acct.textContent;
}
$('aside .m-foot').addEventListener('click', e => {
  const w = e.target.closest('.m-wk button');
  if (w) { mPagerDrop(); setWeekCount(+w.dataset.n); mFootSync(); return; }
  const b = e.target.closest('[data-m]'); if (!b) return;
  $('#' + b.dataset.m).click(); mFootSync();
});

/* ---------- calendar: "…" for days that are full ---------- */
// in each day under root, the chips (or same-day groups) that don't fit whole are hidden and a "…" takes their place
const M_MORE = 13;   // px kept for the "…"
function mClip(root) {
  $$('.day:not(.nb) .items', root).forEach(it => {
    for (const c of it.querySelectorAll(':scope > .m-hid')) c.classList.remove('m-hid');
    const old = it.querySelector(':scope > .m-more'); if (old) old.remove();
    if (it.scrollHeight <= it.clientHeight + 1) return;
    const lim = it.getBoundingClientRect().bottom - M_MORE;
    let cut = false;
    for (const c of it.children) { if (!cut && c.getBoundingClientRect().bottom > lim) cut = true; if (cut) c.classList.add('m-hid'); }
    it.insertAdjacentHTML('beforeend', '<div class="m-more">…</div>');
  });
}
// a tap on a day opens it in day view (the day's number does too, through its data-act)
let mSwipedAt = 0;
$('#grid').addEventListener('click', e => {
  if (!MOBILE || Date.now() - mSwipedAt < 400 || e.target.closest('[data-act], input, button')) return;
  const d = e.target.closest('.day'); if (d && !d.classList.contains('nb')) openDay(d.dataset.date);
});

/* ---------- calendar: paging sideways ---------- */
/* A sideways swipe turns the page: the previous / next ui.weeks weeks, built as .mpage grids either side of #grid,
   follow the finger; let go past M_TURN of the width (or with a flick) and it carries on to that page, otherwise it
   springs back. Landing redraws #grid on the new weeks (the same markup as the page that slid in) and drops the pages.
   ‹ › and the arrow keys (navStep) turn it the same way. */
const M_TURN = 0.22, M_FLICK = 0.45;   // share of the width; px / ms
let mPg = null, mAnim = null;          // the swipe or turn in progress: { W, els, dx, … }; its tween
function mPages() {
  const g = $('#grid'), main = $('main'), W = g.clientWidth, n = 7 * ui.weeks;
  const mk = (start, side) => {
    const el = document.createElement('div'); el.className = 'mpage';
    el.style.cssText = `top:${g.offsetTop}px;height:${g.clientHeight}px;left:${side * W}px;width:${W}px;grid-template-columns:${g.style.gridTemplateColumns};grid-template-rows:${g.style.gridTemplateRows}`;
    const { days, bars } = calWeeksHTML(start, ui.weeks, 0); el.innerHTML = days + bars;
    main.appendChild(el); mClip(el); return el;
  };
  return { W, dx: 0, els: [mk(addDays(ui.viewStart, -n), -1), mk(addDays(ui.viewStart, n), 1)] };
}
function mSetX(x) {
  const t = x ? `translateX(${x}px)` : '';
  $('#grid').style.transform = t;
  if (mPg && mPg.els) mPg.els.forEach(el => { el.style.transform = t; });
}
function mPagerDrop() {
  if (mAnim) { mAnim.cancel(); mAnim = null; }
  if (mPg && mPg.els) mPg.els.forEach(el => el.remove());
  mPg = null; mSetX(0);
}
// carry on to the next page (dir 1), the previous (-1), or back to this one (0), from wherever the swipe left it
function mTurn(dir) {
  const p = mPg, x0 = p.dx, x1 = -dir * p.W;
  mAnim = tween(Math.max(140, 300 * Math.abs(x1 - x0) / p.W), k => mSetX(x0 + (x1 - x0) * k), () => {
    mAnim = null;
    if (dir) { ui.viewStart = addDays(ui.viewStart, 7 * ui.weeks * dir); renderWeeks(); }
    mPagerDrop();
  });
}
function mPage(dir) { if (mAnim || mPg || !$('#grid').clientWidth) return; mPg = mPages(); mTurn(dir); }
// velocity over the last few dozen ms of a swipe (s: the swipe's record; dx: where it is now)
function mVel(s, dx) {
  const now = performance.now();
  if (now - s.ts > 30) { s.vx = (dx - s.dxs) / (now - s.ts); s.ts = now; s.dxs = dx; }
}
const mTouch = e => { const t = e.touches[0]; return { x0: t.clientX, y0: t.clientY, axis: null, dx: 0, ts: performance.now(), dxs: 0, vx: 0 }; };
// which way a swipe that's let go goes on: 1 next, -1 previous, 0 back
// (a flick back the way it came cancels; a finger that stopped before letting go isn't a flick)
function mDir(s, W) {
  const flick = performance.now() - s.ts < 80 && Math.abs(s.vx) > M_FLICK;
  if (flick) return Math.sign(s.vx) === Math.sign(s.dx) ? -Math.sign(s.dx) : 0;
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
let mSw = null;   // a touch on the calendar that may become a swipe
$('main').addEventListener('touchstart', e => {
  if (!MOBILE || ui.dayView || admOpen || mAnim || mPg || mSw || e.touches.length !== 1) return;
  mSw = mTouch(e); mFollow(e, mCalMove, mCalEnd);
}, { passive: true });
function mCalMove(e) {
  if (!mSw) return;
  if (e.touches.length !== 1) { const s = mSw; mSw = null; if (s.axis === 'x' && mPg && !mAnim) mTurn(0); return; }
  const t = e.touches[0], dx = t.clientX - mSw.x0, dy = t.clientY - mSw.y0;
  if (!mSw.axis) {
    if (Math.hypot(dx, dy) < 8) return;
    mSw.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (mSw.axis === 'x') mPg = mPages();
  }
  if (mSw.axis !== 'x' || !mPg) return;
  if (e.cancelable) e.preventDefault();
  mSw.dx = mPg.dx = dx; mVel(mSw, dx); mSetX(dx);
}
function mCalEnd(cancelled) {
  const s = mSw; mSw = null;
  if (!s || s.axis !== 'x' || !mPg || mAnim) return;
  mSwipedAt = Date.now();
  mTurn(cancelled ? 0 : mDir(s, mPg.W));
}

/* ---------- day view ---------- */
// sideways swipes over the timeline: the day before and after follow the finger (enterStrip / setStripX, dayview.js);
// let go far enough (or with a flick) and it slides on (daySlide), otherwise back
let mDs = null;
const dvBox = $('#dayview');
dvBox.addEventListener('touchstart', e => {
  if (!MOBILE || !ui.dayView || admOpen || dayAnim || dv || mDs || e.touches.length !== 1 || !e.target.closest('.dv-main')) return;
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
