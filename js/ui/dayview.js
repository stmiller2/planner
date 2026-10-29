'use strict';
/* Day view (click a date number): the list of the day's tasks on the left and an hour-by-hour timeline in the
   middle, for 1–5 days side by side; adding tasks to a day; and swiping sideways between days. Editing on the
   timeline (dragging blocks, typing times, tooltips) is in dayview-edit.js. (The scratch board on the right belongs
   to both the calendar and day view: scratch.js.) */
// a task's slot in the day is task.plan (see planOf in core/model.js); nothing here affects the calendar
let PPM = 64 / 60;            // pixels per minute; recomputed so the chosen hours fill the window
const MIN_PPM = 0.4;           // floor so blocks stay usable on a short window with many hours in view
const DEFAULT_DUR = 60;
const snapMin = m => Math.round(m / ui.snap) * ui.snap;   // ui.snap: minutes, chosen in Settings
// side-by-side columns for overlapping blocks (each cluster of overlaps is split evenly)
function layoutBlocks(bs) {
  bs.sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster = [], end = -1;
  const flush = () => {
    const cols = [];
    cluster.forEach(b => { let c = cols.findIndex(e => e <= b.start); if (c < 0) { c = cols.length; cols.push(b.end); } else cols[c] = b.end; b.col = c; });
    cluster.forEach(b => b.ncol = cols.length);
    cluster = [];
  };
  bs.forEach(b => { if (cluster.length && b.start >= end) flush(); cluster.push(b); end = cluster.length === 1 ? b.end : Math.max(end, b.end); });
  if (cluster.length) flush();
  return bs;
}
let dvScrollTo = null;
let dvAdd = null;   // open new-task box in the day list, right below a task: { tid, afterId, day }
function openDay(d) {
  const first = !ui.dayView;
  ui.dayView = d; if (first) scratchForView(); closeMenu(); hideInsline(); closeTimePop(false); dvAdd = null;
  // start scrolled to the earliest planned block in view; otherwise to about now (today) or 8am
  const starts = dvDays().flatMap(x => dayTasks(x)).map(it => planOf(it.k)).filter(Boolean).map(p => p.start);
  const n = new Date(), nowM = n.getHours() * 60 + n.getMinutes();
  dvScrollTo = Math.max(0, starts.length ? Math.min(...starts) - 45 : dvDays().includes(todayISO()) ? nowM - 60 : 8 * 60 - 15);
  if (first) inserting = addOpen = null;
  render();
}
function closeDay() { closeTimePop(false); ui.dayView = null; dvAdd = null; scratchForView(); render(); }

// add tasks dated to `day`, right after a listed task in its thread (joining its chain same-day if it's linked to
// the next one), or right before one (beforeId). Without either: after the thread's last task dated on or before
// that day.
function addDayTasks(tid, titles, afterId, day, beforeId) {
  const f = findThread(tid); day = day || ui.dayView; if (!f || !day) return;
  titles = titles.map(s => s.trim()).filter(Boolean); if (!titles.length) return;
  const news = titles.map(title => ({ id: uid(), title, date: day, done: false, linkToPrev: null }));
  if (beforeId) {
    // before task X: if X was linked to the task above it, the new tasks take X's place in that chain
    // (same link to the task above) and X follows them on the same day, so the chain stays whole
    mutate(() => {
      const t = f.t, x = t.tasks.find(k => k.id === beforeId); if (!x) return;
      if (x.linkToPrev) { news.forEach((n, i) => n.linkToPrev = i ? 'sameDay' : x.linkToPrev); x.linkToPrev = 'sameDay'; }
      const L = layout(t), at = L.findIndex(it => it.obj === x);
      L.splice(at, 0, ...news.map(o => ({ kind: 'task', obj: o })));
      writeLayout(t, L);
    });
    if (dvAdd) { dvAdd.afterId = news[news.length - 1].id; dvAdd.beforeId = null; }   // keep typing: next ones go after it
    renderDay();
    return;
  }
  mutate(() => {
    const t = f.t, ts = t.tasks;
    let ai = afterId ? ts.findIndex(k => k.id === afterId) : -1;
    if (!afterId) { ts.forEach((k, i) => { if (k.date && k.date <= day) ai = i; }); if (ai >= 0) ai = runOf(t, ai)[1]; }
    if (ai >= 0 && ts[ai + 1] && ts[ai + 1].linkToPrev) {
      if (ts[ai].date === day) news.forEach(n => n.linkToPrev = 'sameDay'); else ai = runOf(t, ai)[1];
    }
    const L = layout(t), at = ai >= 0 ? L.findIndex(x => x.obj === ts[ai]) + 1 : 0;
    L.splice(at, 0, ...news.map(o => ({ kind: 'task', obj: o })));
    writeLayout(t, L);
  });
  if (dvAdd) dvAdd.afterId = news[news.length - 1].id;
  renderDay();
}

function renderDay() {
  const app = $('#app'), box = $('#dayview');
  app.classList.toggle('dayon', !!ui.dayView);
  if (!ui.dayView) { box.innerHTML = ''; return; }
  if (!box.querySelector('.dv-side')) buildDaySkeleton(box);
  const ds = dvDays();
  setRange();
  const lbl = ds.length > 1 ? `Tasks these ${ds.length} days` : 'Tasks this day';
  box.querySelector('.dv-side .sb-head h2').textContent = lbl; box.querySelector('.dv-side .sb-tab span').textContent = lbl;
  $$('#dvcount button').forEach(b => b.classList.toggle('on', +b.dataset.n === ui.dayCount));
  renderDayList(box);
  renderDayTimeline(box);
  syncTimePop();
}
function buildDaySkeleton(box) {
  box.innerHTML = `
    <section class="dv-side">
      ${sbTab('Tasks this day')}
      <div class="sb-head"><h2>Tasks this day</h2></div>
      <div class="dv-list"></div>
    </section>
    <section class="dv-main">
      <div class="dv-scroll"></div>
    </section>`;
  // day swipes: over the timeline the listener may stop the hours scrolling while you swipe; over the list it only
  // listens (passive), so scrolling the list never has to wait for this code to run
  box.querySelector('.dv-main').addEventListener('wheel', dayWheel, { passive: false });
  box.querySelector('.dv-side').addEventListener('wheel', e => dayWheel(e, false), { passive: true });
}
function renderDayList(box, only, cur = ui.dayView) {
  const days = only || dvDays(), multi = ui.dayCount > 1, solo = !!only && !multi, today = todayISO(), listEl = box.querySelector('.dv-list');
  const keepEl = box.querySelector('.dvadd'), keep = keepEl ? keepEl.value : '', keepTop = listEl.scrollTop;
  const addBox = tid => `<input class="add dvadd" data-tid="${tid}" placeholder="New task (Enter to add, Esc to stop)">`;
  let html = '';
  days.forEach(day => {
    const items = dayTasks(day);
    let sec = '', lastT = null;
    items.forEach(it => {
      if (it.t !== lastT) {
        if (lastT) sec += '</div>';
        lastT = it.t;
        sec += `<div class="dv-grp" data-tid="${it.t.id}"><div class="dv-th" style="--c:${esc(colorOf(it.t))}"><span class="dot"></span><span class="nm">${esc(it.path[it.path.length - 1])}</span></div>`;
      }
      const p = planOf(it.k);
      if (dvAdd && dvAdd.beforeId === it.k.id) sec += addBox(it.t.id);
      sec += `<div class="dv-item ${p ? 'placed' : ''} ${it.k.done ? 'done' : ''}" data-id="${it.k.id}" style="--c:${esc(colorOf(it.t))}">
        <input type="checkbox" data-act="done" data-id="${it.k.id}" ${it.k.done ? 'checked' : ''}>
        <div class="bd"><div class="tt">${esc(it.k.title)}</div>${p ? `<div class="tm">${fmtSpan(p.start, p.dur)}</div>` : ''}</div></div>`;
      if (dvAdd && dvAdd.afterId === it.k.id) sec += addBox(it.t.id);
    });
    if (lastT) sec += '</div>';
    const cfp = confsOn(day).map(c => `<div class="dv-cfp" data-cid="${c.id}" data-day="${day}" title="${cfTip(c)}"><span data-act="rename-c" data-id="${c.id}">${esc(c.title)}</span></div>`).join('');
    if (solo) { html += `<section class="dv-day solo" data-date="${day}">${cfp}${sec || '<div class="dv-empty">Nothing scheduled on this day yet.</div>'}</section>`; return; }
    if (!multi) { html = cfp + (sec || '<div class="dv-empty">Nothing scheduled on this day yet.</div>'); return; }
    const dd = parseD(day), n = items.length;
    html += `<section class="dv-day ${day === cur ? 'cur' : ''}" data-date="${day}">
      <div class="dv-dh"><b>${DOW[dd.getDay()]} ${dd.getDate()}</b><span>${MON[dd.getMonth()]}${day === today ? ' · today' : ''}</span><span class="cnt">${n ? plural(n, 'task') : ''}</span></div>
      ${cfp}${sec || '<div class="dv-empty small">Nothing scheduled.</div>'}</section>`;
  });
  listEl.innerHTML = html;
  listEl.scrollTop = keepTop;
  const inp = box.querySelector('.dvadd');
  if (inp) { inp.value = keep; if (!rendering || dvAdd) inp.focus(); }
}
const dvTitle = first => { const nm = d => { const x = parseD(d); return `${DOW[x.getDay()]}, ${MON[x.getMonth()]} ${x.getDate()}`; }; return ui.dayCount > 1 ? `${nm(first)} – ${nm(addDays(first, ui.dayCount - 1))}` : nm(first); };
// the visible days: the open day plus the next one or two (1-, 2- or 3-day view)
const dvDays = () => Array.from({ length: ui.dayCount }, (_, i) => addDays(ui.dayView, i));
// the timeline always covers the whole day; ui.dayHours of it fit in the window and the rest scrolls
function renderDayTimeline(box) {
  const days = dayStrip ? dayStrip.days : dvDays(), sH = 0, eH = 24, sc = box.querySelector('.dv-scroll');
  const oldPPM = PPM, keepMin = sc.firstElementChild ? sc.scrollTop / oldPPM : null, today = todayISO();   // keep the same time at the top
  // day headers (2- and 3-day views) sit above the scrolling hours
  const tmpl = dayStrip ? `58px repeat(${days.length}, ${dayStrip.W}px)` : `58px repeat(${days.length}, minmax(0,1fr))`;
  const heads = ui.dayCount > 1 ? `<div class="dv-heads" style="grid-template-columns:${tmpl}"><div></div>${days.map(d => {
      const dd = parseD(d);
      return `<div class="${d === ui.dayView ? 'cur' : ''} ${d === today ? 'today' : ''}">${DOW[dd.getDay()]} <b>${dd.getDate()}</b></div>`; }).join('')}</div>` : '';
  const headEl = box.querySelector('.dv-heads');
  if (headEl) headEl.remove();
  if (heads) sc.insertAdjacentHTML('beforebegin', heads);
  // conflicts on the days in view: always visible above the hours; no strip at all when there are none
  const oldCf = box.querySelector('.dv-conf'); if (oldCf) oldCf.remove();
  const dc = confs().filter(c => c.start && c.start <= days[days.length - 1] && c.end >= days[0]).sort((a, b) => a.start < b.start ? -1 : 1);
  // conflicts that don't overlap share a line
  const { line: cfRow, count: cfLines } = packLines(dc);
  // the strip sits in the same section as the dates (no line between them)
  const headNow = box.querySelector('.dv-heads'); if (headNow) headNow.classList.toggle('hascf', !!dc.length);
  if (dc.length) sc.insertAdjacentHTML('beforebegin', `<div class="dv-conf ${headNow ? '' : 'solo'}" style="grid-template-columns:${tmpl}"><div class="dv-cfg" style="grid-row:1 / ${cfLines + 1}"></div>${dc.map(c => {
    const a = Math.max(0, diffDays(c.start, days[0])), b = Math.min(days.length - 1, diffDays(c.end, days[0])), st = c.start >= days[0], en = c.end <= days[days.length - 1];
    return `<div class="dv-cfb ${st ? 's' : ''} ${en ? 'e' : ''}" data-cid="${c.id}" style="grid-row:${cfRow.get(c.id) + 1};grid-column:${a + 2} / ${b + 3}"
      title="${cfTip(c)}"><span data-act="rename-c" data-id="${c.id}">${esc(c.title)}</span>${st ? '<i class="h l"></i>' : ''}${en ? '<i class="h r"></i>' : ''}</div>`; }).join('')}</div>`);
  if (!dayStrip) PPM = Math.max(MIN_PPM, (sc.clientHeight - GRID_PAD) / (ui.dayHours * 60));   // (held steady mid-swipe)
  const H = (eH - sH) * 60 * PPM, lo = sH * 60;
  let hours = '', lines = '';
  for (let h = sH; h <= eH; h++) {
    const y = (h - sH) * 60 * PPM;
    hours += `<div style="top:${y}px">${fmtH(h)}</div>`;
    lines += `<div class="dv-line" style="top:${y}px"></div>`;
    if (h < eH) lines += `<div class="dv-line half" style="top:${y + 30 * PPM}px"></div>`;
  }
  const col = d => {
    const placed = dayTasks(d).filter(it => planOf(it.k)).map(it => { const p = planOf(it.k); return { it, start: p.start, end: p.start + p.dur, dur: p.dur }; });
    const blk = layoutBlocks(placed).map(b => {
      const top = (b.start - lo) * PPM, h = Math.max(12, b.dur * PPM - 2), k = b.it.k, short = h < 38, tiny = h < 22;
      return `<div class="dv-blk ${k.done ? 'done' : ''} ${short ? 'short' : ''} ${tiny ? 'tiny' : ''}" data-id="${k.id}"
          style="--c:${esc(colorOf(b.it.t))};top:${top}px;height:${h}px;left:calc(${b.col} * 100% / ${b.ncol} + 3px);width:calc(100% / ${b.ncol} - 6px)">
        <div class="h t"></div>
        <div class="bi"><input type="checkbox" data-act="done" data-id="${k.id}" ${k.done ? 'checked' : ''}><span class="tt">${esc(k.title)}</span><span class="tmi">${fmtTime(b.start)}</span></div>
        <div class="tm">${fmtSpan(b.start, b.dur)} · ${esc(b.it.t.name)}</div>
        <button class="ic x" data-act="unplan" data-id="${k.id}" title="Unschedule">${ICON.x}</button>
        <div class="h b"></div></div>`;
    }).join('');
    let now = '';
    if (d === today) { const n = new Date(), m = n.getHours() * 60 + n.getMinutes(); now = `<div class="dv-now" style="top:${(m - lo) * PPM}px"></div>`; }
    return `<div class="dv-col ${d !== ui.dayView ? 'other' : ''}" data-date="${d}" data-sh="${sH}" data-eh="${eH}" style="height:${H}px">${lines}${blk}${now}</div>`;
  };
  sc.innerHTML = `<div class="dv-grid" style="grid-template-columns:${tmpl}">
      <div class="dv-hours" style="height:${H}px">${hours}</div>
      ${days.map(col).join('')}
    </div>`;
  if (dvScrollTo !== null) { sc.scrollTop = Math.max(0, (dvScrollTo - lo) * PPM); dvScrollTo = null; }
  else if (keepMin !== null) sc.scrollTop = keepMin * PPM;
  // renaming a long conflict in the strip: the box takes one day's width
  const cf = box.querySelector('.dv-conf'), c0 = sc.querySelector('.dv-col'); if (cf && c0) cf.style.setProperty('--colw', c0.getBoundingClientRect().width + 'px');
}
// keep the now-line moving: once a minute, move it (a full redraw only when the day has changed, e.g. after midnight)
setInterval(() => {
  if (!ui.dayView || !dvDays().includes(todayISO()) || dv || document.querySelector('.inl')) return;
  const line = $(`#dayview .dv-col[data-date="${todayISO()}"] .dv-now`); if (!line) return renderDay();
  const n = new Date(); line.style.top = (n.getHours() * 60 + n.getMinutes()) * PPM + 'px';
}, 60000);
const GRID_PAD = 26;   // dv-grid top + bottom margin
let dvResizeT; window.addEventListener('resize', () => { clearTimeout(dvResizeT); dvResizeT = setTimeout(() => { if (ui.dayView && !dv) renderDay(); }, 60); });

/* Day view: a sideways swipe steps a day at a time, with the calendar's feel. While you swipe, the timeline holds the
   day before and the day after as well and scrolls sideways under the fixed hours: it follows your fingers a little
   (with resistance), and past DAY_PULL it carries on and glides all the way to the next / previous day; let go early
   and it springs back. One swipe = one step. Only the timeline moves sideways; the list beside it scrolls up or down
   to the new day. Up / down still scrolls the hours and the list. */
const DAY_PULL = 70;
let dayStrip = null;   // { days, W } while the timeline holds the neighbouring days too
let dayAnim = null;    // { cancel, finish } while it glides
// slide the days by x: the timeline, header and conflict strip move left; their hour / gutter column moves back by the same
// amount, so it stays put
const setStripX = x => {
  if (dayStrip) dayStrip.x = x;
  $$('#dayview .dv-grid, #dayview .dv-heads, #dayview .dv-conf').forEach(el => { el.style.transform = x ? `translateX(${-x}px)` : ''; });
  $$('#dayview .dv-hours, #dayview .dv-heads>div:first-child, #dayview .dv-cfg').forEach(el => { el.style.transform = x ? `translateX(${x}px)` : ''; });
};
// the timeline also holds `before` days before the view and `after` days after it (one each for a swipe; more for T)
function enterStrip(before = 1, after = 1) {
  if (dayStrip) return;
  closeTimePop(false); hideTip();
  const col = $('#dayview .dv-col'), W = col ? col.getBoundingClientRect().width : 300;
  dayStrip = { W, days: Array.from({ length: before + ui.dayCount + after }, (_, i) => addDays(ui.dayView, i - before)) };
  renderDayTimeline($('#dayview')); setStripX(W * before);
}
function exitStrip(newDay) {
  if (dayAnim) { dayAnim.cancel(); dayAnim = null; }
  dayStrip = null;
  const l0 = $('#dayview .dv-list'); if (l0) l0.classList.remove('gliding');
  if (newDay) { ui.dayView = newDay; dvAdd = null; if (l0) l0.scrollTop = 0; }
  renderDay(); setStripX(0);
}
// glide the timeline sideways from where it is to x, and the list from its scroll s0 to s1 (if given), then land
function glide(x1, ms, land, list) {
  const x0 = dayStrip ? dayStrip.x || 0 : 0, L = list && $('#dayview .dv-list');
  const done = () => { dayAnim = null; land(); };
  const tw = tween(ms, k => {
    setStripX(x0 + (x1 - x0) * k);
    if (L) L.scrollTop = list[0] + (list[1] - list[0]) * k;
  }, done);
  dayAnim = { cancel: tw.cancel, finish: () => { tw.cancel(); done(); } };   // finish: jump to the end and land
}
// slide one day later (dir 1) or earlier (-1): a swipe, ‹ / › or ← / →; or m days at once (T: jump to today).
// A step during a slide lands that one first.
function daySlide(dir, m = 1) {
  if (dayAnim) dayAnim.finish();
  if (m > 1 && dayStrip) exitStrip(null);   // (a swipe's strip only reaches one day either side)
  enterStrip(dir < 0 ? m : 1, dir > 0 ? m : 1);
  const box = $('#dayview'), oldDays = dvDays(), newFirst = addDays(ui.dayView, dir * m), listEl = $('.dv-list', box), s0 = listEl.scrollTop;
  // the list holds the old days and the arriving ones while it scrolls to the new first day
  const lo = dir > 0 ? oldDays[0] : newFirst, union = Array.from({ length: ui.dayCount + m }, (_, i) => addDays(lo, i));
  renderDayList(box, union, newFirst);
  const adj = ui.dayCount > 1 ? 2 : 0;   // 2: a later section's top border
  const top = d => { const el = listEl.querySelector(`.dv-day[data-date="${d}"]`); return el ? el.getBoundingClientRect().top - listEl.getBoundingClientRect().top + listEl.scrollTop + adj : 0; };
  listEl.scrollTop = 0;
  const from = dir > 0 ? s0 : top(oldDays[0]) + s0, to = dir > 0 ? top(newFirst) : 0;
  // when the days below are short, the list can't scroll far enough to bring the arriving day to the top: the slide
  // would stall partway (or not move at all) and then jump when it lands. A spacer at the bottom makes room; it goes
  // away when the list is redrawn for the new day.
  const far = Math.max(from, to);
  if (far > listEl.scrollHeight - listEl.clientHeight) listEl.insertAdjacentHTML('beforeend', `<div style="height:${Math.ceil(far + listEl.clientHeight)}px"></div>`);
  listEl.scrollTop = from; listEl.classList.add('gliding');
  setRange(newFirst);
  const x0 = dayStrip.W * (dir < 0 ? m : 1);
  glide(x0 + dir * m * dayStrip.W, (WEEK_SLIDE_MS + 50 * (m - 1)) * 1.15, () => exitStrip(newFirst), [from, to]);
}
const dayWheel = wheelSteps({
  pull: DAY_PULL,
  skip: e => !ui.dayView || e.ctrlKey || dv || cfDrag,
  axis: e => [wheelPx(e, e.deltaX), wheelPx(e, e.deltaY)],
  claim: (e, dx, dy) => Math.abs(dx) > Math.abs(dy),                     // an up / down scroll: hours or list scroll as usual
  busy: () => !!dayAnim, waitWhileBusy: true,
  step: daySlide,
  follow: acc => { enterStrip(); setStripX(dayStrip.W + clamp(acc * 0.35, -dayStrip.W, dayStrip.W)); },   // with resistance
  back: () => { if (!dayStrip || dayAnim) return; dayWheel.reset(); glide(dayStrip.W, 180, () => exitStrip(null)); },
});
