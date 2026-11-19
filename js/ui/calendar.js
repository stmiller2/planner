'use strict';
/* The calendar (main view): weeks of days with task chips, conflict bars across the days, row heights that fit
   the window, week-by-week scrolling, and dropping chips / sidebar tasks onto days. */
function colTemplate() {
  return Array.from({ length: 7 }, (_, i) => { const wd = (ui.weekStart + i) % 7; return (ui.narrowWe && (wd === 0 || wd === 6)) ? 'minmax(0,.6fr)' : 'minmax(0,1fr)'; }).join(' ');
}
const CF_TOP = 28, CF_PITCH = 21;   // a conflict bar's offset from the top of a day, and the room each line of them takes
// archived tasks keep their place on the calendar (they just leave the sidebar): date -> [{ k, color, name, path }]
const archivedByDate = memo(() => {
  const archOn = {};
  (state.archive || []).forEach(e => {
    const fr = e.from || {}, add = (k, color, name, path) => {
      if (k.date) (archOn[k.date] = archOn[k.date] || []).push({ k, color, name, path });
      (k.fails || []).forEach((fl, a) => (archOn[fl.date] = archOn[fl.date] || []).push({ k, color, name, path, fl, a }));   // its failed attempts too
    };
    if (e.kind === 'task') { const live = fr.tid && findThread(fr.tid); add(e.item, live ? colorOf(live.t) : fr.color || PALETTE[0], (fr.path || []).slice(-1)[0] || '', (fr.path || []).join(' › ')); return; }
    const cm = new Map(), threads = e.kind === 'project' ? (e.item.threads || []) : [e.item];
    if (e.kind === 'thread') { const c0 = e.item.color || fr.color || PALETTE[0]; cm.set(e.item.id, c0); colorTree(e.item.threads, c0, cm); } else colorTree(threads, null, cm);
    const rec = (t, path) => { (t.tasks || []).forEach(k => add(k, cm.get(t.id) || PALETTE[0], t.name, path.concat(t.name).join(' › '))); (t.threads || []).forEach(c => rec(c, path.concat(t.name))); };
    threads.forEach(t => rec(t, e.kind === 'project' ? [e.item.name] : (fr.path || [])));
  });
  return archOn;
});
function renderCal() {
  if (weekAnim) { weekAnim.stale = true; return; }      // mid-slide: the slide redraws everything when it lands
  hideLinkLine();
  const cols = colTemplate();
  const dow = $('#dow'); dow.style.gridTemplateColumns = cols;
  dow.innerHTML = Array.from({ length: 7 }, (_, i) => `<div>${DOW[(ui.weekStart + i) % 7]}</div>`).join('');
  const grid = $('#grid');
  grid.style.gridTemplateColumns = cols;
  const { days, bars } = calWeeksHTML(ui.viewStart, ui.weeks, 0);
  // days scrolled down to tasks further down their list stay where they were
  const keepScroll = new Map(); $$('.day .items', grid).forEach(it => { if (it.scrollTop) keepScroll.set(it.parentElement.dataset.date, it.scrollTop); });
  // no scrollbar while it's laid out and measured: the new days can overflow for a moment (the old rows still apply),
  // and a scrollbar would narrow the days and make fitRows size the weeks for narrower columns than they end up with
  const overflow = grid.style.overflow; grid.style.overflow = 'hidden';
  grid.innerHTML = days + bars;   // (the weeks either side, if built, go with it: buildNeighbours makes them again)
  barWidths(grid.querySelectorAll('.cfb'));
  fitRows();
  grid.style.overflow = overflow;
  keepScroll.forEach((top, d) => { const it = grid.querySelector(`.day[data-date="${d}"] .items`); if (it) { it.scrollTop = top; markMore(it); } });
  laterNeighbours();
}
/* The markup of `weeks` weeks from `start`, put in grid rows row0 + 1…: { days, bars }. Each week stands on its own
   (its conflicts get their lines within the week), so a week slide can add or drop whole weeks (weekShift) and get
   what a full redraw would. The first day shown is labelled with its month by firstLabels, afterwards. */
function calWeeksHTML(start, weeks, row0) {
  const end = addDays(start, weeks * 7 - 1), today = todayISO();
  // boxes: runs of tasks joined by same-day links (shown together in a dashed box)
  const byDate = {};
  for (const { p, t, path } of allThreads()) {
    const n = t.tasks.length; let i = 0;
    while (i < n) {
      let j = i; while (j + 1 < n && t.tasks[j + 1].linkToPrev === 'sameDay') j++;
      const d = t.tasks[i].date;
      if (d && d >= start && d <= end) (byDate[d] = byDate[d] || []).push({ p, t, path, s: i, e: j });
      i = j + 1;
    }
  }
  const archOn = archivedByDate();
  const archChip = x => MOBILE ? mChip(`arch ${x.fl ? 'failed' : x.k.done ? 'done' : ''}`, '', x.color, x.k.title) : x.fl ? `<div class="chip arch failed" style="--c:${esc(x.color)}" title="${esc(x.path)} · failed attempt ${x.a + 1} · archived">
    <span class="fx">${ICON.x}</span><div class="cb"><div class="tt">${esc(x.k.title)}</div><div class="ts"><span class="fl">failed</span><span class="tn">${esc(x.name)} · archived</span></div></div></div>`
    : `<div class="chip arch ${x.k.done ? 'done' : ''}" style="--c:${esc(x.color)}" title="${esc(x.path)} · archived">
    <input type="checkbox" ${x.k.done ? 'checked' : ''} disabled tabindex="-1"><div class="cb"><div class="tt">${esc(x.k.title)}</div><div class="ts"><span class="tn">${esc(x.name)} · archived</span></div></div></div>`;
  const all = confs().filter(c => c.start && c.end >= start && c.start <= end)
    .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end > b.end ? -1 : 1);
  let days = '', bars = '';
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, 7 * w), we = addDays(ws, 6), row = row0 + w + 1;
    // the week's conflicts: each gets a line so overlapping ones stack; a day under bars keeps room for the lowest
    // one over it (days with no bar over them keep none)
    const cs = all.filter(c => c.start <= we && c.end >= ws), slotOf = packLines(cs).line;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), dd = parseD(d), wd = dd.getDay(), over = cs.filter(c => c.start <= d && d <= c.end);
      const cls = ['day', i === 6 && 'l7', (wd === 0 || wd === 6) && 'we', d === today && 'today', d < today && 'past', over.length && 'cf'].filter(Boolean).join(' ');
      // runs and failed attempts in the day's own order (see dayItems), so an attempt stays where it happened
      const posOf = dayOrder(d);
      const items = (byDate[d] || []).map(r => {
        const chips = []; for (let k = r.s; k <= r.e; k++) chips.push([r.t.tasks[k].id, chip(r, k)]);
        return [posOf(r.t.tasks[r.s].id), r.e > r.s ? `<div class="grp" style="--c:${esc(colorOf(r.t))}">${selRuns(chips)}</div>` : selRuns(chips)];
      }).concat(dayFailRuns(d).map(g => [posOf(g[0].fl.id), g.length > 1 ? `<div class="grp" style="--c:${esc(colorOf(g[0].t))}">${g.map(failChip).join('')}</div>` : failChip(g[0])]))
        .sort((a, b) => a[0] - b[0]).map(x => x[1]).join('') + (archOn[d] || []).map(archChip).join('');
      const sl = over.reduce((m, c) => Math.max(m, slotOf.get(c.id) + 1), 0), gap = sl ? `<div class="cf-gap" style="height:${sl * CF_PITCH + 4}px"></div>` : '';
      days += `<div class="${cls}" data-date="${d}" style="grid-row:${row};grid-column:${i + 1} / ${i + 2}"><div class="dn"><span class="n" data-act="openday" data-date="${d}">${dayNum(d, w === 0 && i === 0 && row0 === 0)}</span></div>${gap}<div class="items">${items}</div></div>`;
    }
    cs.forEach(c => {
      const a = c.start < ws ? ws : c.start, b = c.end > we ? we : c.end, st = c.start >= ws, en = c.end <= we;
      bars += `<div class="${['cfb', st && 's', en && 'e'].filter(Boolean).join(' ')}" data-cid="${c.id}" data-d0="${a}" title="${cfTip(c)}"
        style="grid-row:${row};grid-column:${diffDays(a, ws) + 1} / ${diffDays(b, ws) + 2};margin-top:${CF_TOP + slotOf.get(c.id) * CF_PITCH}px">
        <span class="cfl" data-act="rename-c" data-id="${c.id}">${esc(c.title)}</span>${st ? '<i class="h l"></i>' : ''}${en ? '<i class="h r"></i>' : ''}</div>`;
    });
  }
  return { days, bars };
}
// a day's number; the first day shown and each 1st of a month also say the month
const dayNum = (d, first) => { const dd = parseD(d); return first || dd.getDate() === 1 ? `${MON[dd.getMonth()]} ${dd.getDate()}` : String(dd.getDate()); };
// after weeks were added or dropped: the first day's label (and the one that was first) as a fresh redraw has them
function firstLabels(grid) {
  viewDays(grid).forEach((d, i) => { const n = d.querySelector('.dn .n'), t = dayNum(d.dataset.date, i === 0); if (n.textContent !== t) n.textContent = t; });
}
// the days shown, in date order (not the pre-built weeks either side, .nb; page order isn't date order after a slide)
const viewDays = (grid = $('#grid')) => $$(':scope > .day:not(.nb)', grid).sort((a, b) => a.dataset.date < b.dataset.date ? -1 : 1);
// renaming a long conflict: the box takes the width of the day it starts on
function barWidths(bars) {
  const grid = $('#grid');
  bars.forEach(b => { const d = grid.querySelector(`.day[data-date="${b.dataset.d0}"]`); if (d) b.style.setProperty('--colw', d.offsetWidth + 'px'); });
}
/* Week heights: busy weeks grow into the space emptier weeks don't need, but the calendar never gets taller
   than the window; when a week can't fit, its row is capped and the crowded days scroll inside themselves. */
function fitRows() {
  if (weekAnim) return;
  const grid = $('#grid'), days = viewDays(grid); if (!days.length) return;
  const H = grid.clientHeight; if (!H) return;
  // mobile: weeks sized for what they hold, titles wrapping where there's room (mFit); days that still can't show all
  // their tasks end in "…" (mClip)
  if (MOBILE) { grid.style.gridTemplateRows = mFit(days, H).tpl; mClip(grid); return; }
  grid.style.gridTemplateRows = fitSizes(weekNeeds(days), H).tpl;
  days.forEach(d => markMore(d.querySelector('.items')));
}
// the height each week's fullest day needs (days: the grid's .day elements, 7 a week). Row heights don't change
// it (a capped day's list scrolls; offsetTop ignores that), so it can be read from any layout, the slide's included.
function weekNeeds(days) {
  const nat = Array(Math.floor(days.length / 7)).fill(0);
  days.forEach((d, idx) => {
    const it = d.querySelector('.items'), last = it.lastElementChild, dn = d.querySelector('.dn'), gap = d.querySelector('.cf-gap');
    const bottom = last ? last.offsetTop + last.offsetHeight + 3 : gap ? gap.offsetTop + gap.offsetHeight + 3 : dn.offsetTop + dn.offsetHeight;
    nat[Math.floor(idx / 7)] = Math.max(nat[Math.floor(idx / 7)], bottom + 9);   // + bottom padding and border
  });
  return nat;
}
// rows for weeks needing nat px in a calendar H px tall: tpl for grid-template-rows, px = the heights that gives
function fitSizes(nat, H) {
  const n = nat.length, want = nat.map(h => Math.max(h, Math.min(110, H / n)));
  if (want.reduce((a, b) => a + b, 0) <= H) {   // all fit: each gets at least what it needs, the rest is shared (1fr)
    const min = want.map(h => Math.ceil(h));
    // as the browser shares it: rows needing more than an equal share keep their minimum, the others split the rest
    let fixed = new Set(), fr = 0;
    for (;;) {
      const rest = min.filter((_, i) => !fixed.has(i));
      fr = (H - min.reduce((a, h, i) => a + (fixed.has(i) ? h : 0), 0)) / Math.max(rest.length, 1);
      const more = min.findIndex((h, i) => !fixed.has(i) && h > fr);
      if (more < 0) break; fixed.add(more);
    }
    return { tpl: min.map(h => `minmax(${h}px, 1fr)`).join(' '), px: min.map((h, i) => fixed.has(i) ? h : Math.max(h, fr)) };
  }
  // cap: weeks that fit keep their height, the rest share what's left equally
  const sorted = [...want].sort((a, b) => a - b); let rem = H, k = n, cap = H / n;
  for (const h of sorted) { if (h <= rem / k) { rem -= h; k--; } else { cap = rem / k; break; } }
  const px = want.map(h => Math.floor(Math.min(h, cap)));
  return { tpl: px.map(h => h + 'px').join(' '), px };
}
// fade at the bottom of a day that has more tasks below (macOS hides scrollbars until you scroll)
function markMore(it) { if (it) it.parentElement.classList.toggle('more', it.scrollTop + it.clientHeight < it.scrollHeight - 2); }
new ResizeObserver(() => fitRows()).observe($('#grid'));
$('#grid').addEventListener('scroll', e => { if (e.target.classList && e.target.classList.contains('items')) markMore(e.target); }, true);

/* Scrolling the calendar moves it a week at a time. While you scroll it follows your fingers a little (with
   resistance); once you've pulled past WEEK_PULL it snaps to the next/previous week, and if you let go before
   that it springs back. One step per gesture: the trackpad's momentum after a step is ignored. A scroll that
   starts inside a day with more tasks than fit scrolls that day's list instead. */
const WEEK_PULL = 70;   // px of scrolling needed to change week
let weekAnim = null;   // { cancel, finish } while a week is sliding in
// px height of each week row as currently laid out
const rowHeights = () => { const ds = viewDays(); return Array.from({ length: Math.floor(ds.length / 7) }, (_, w) => ds[w * 7].getBoundingClientRect().height); };
/* Slide one week up (dir 1) or down (dir -1), or m weeks at once (T: jump to today). The grid briefly holds the old
   and new views together (m extra weeks) and scrolls from where it is now to where the new view sits, so you see the
   calendar move. Row heights blend along the way: the slide starts laid out exactly like the old view and ends exactly
   like the new one, so neither the start nor the landing jumps, even when a busy week sits next to a light one. Weeks
   that are in neither view (a slide of more weeks than are shown) pass by at an average height. */
function weekShift(dir, m = 1) {
  if (weekAnim) weekAnim.finish();
  clearTimeout(nbTimer);
  const g = $('#grid'), pulled = weekPull;   // how far a swipe's pull already moved it: the slide goes on from there
  setPull(0);
  const oldStart = ui.viewStart, oldRows = rowHeights(), n = ui.weeks;
  ui.viewStart = addDays(oldStart, 7 * dir * m); renderHeader();
  if (oldRows.length !== n || !g.clientHeight || calStale) return renderWeeks();
  // strip of n+m weeks: the old view at strip row oi, the new one at ni. The days already shown stay as they are;
  // the arriving week is the one already built beside them (buildNeighbours), or (not built yet, or several weeks
  // at once) is built now. Each row's height goes from a (laid out as the old view) to b (as the new one). The new
  // view's heights come from the strip itself (what its weeks need, sized as fitRows would).
  const oi = dir > 0 ? 0 : m, ni = dir > 0 ? m : 0;
  weekAnim = { cancel() {}, finish: null, stale: false };
  g.style.overflow = 'hidden'; hideLinkLine();
  const side = dir > 0 ? 'below' : 'above', ready = m === 1 && g.querySelector(`:scope > .day.nb.${side}`);
  // what the weeks need, read before anything changes (nothing has to be laid out again to read it)
  let nat = null;
  if (ready) {
    const nbNat = weekNeeds($$(`:scope > .day.nb.${side}`, g).sort((x, y) => x.dataset.date < y.dataset.date ? -1 : 1)), viewNat = weekNeeds(viewDays(g));
    nat = dir > 0 ? viewNat.concat(nbNat) : nbNat.concat(viewNat);
  }
  $$(`:scope > .nb${ready ? ':not(.' + side + ')' : ''}`, g).forEach(el => el.remove());   // the rest aren't needed
  if (dir < 0) for (const el of g.children) if (!el.classList.contains('nb') && el.style.gridRowStart) el.style.gridRow = String(parseInt(el.style.gridRowStart, 10) + m);
  if (ready) {   // it joins the grid as an ordinary week
    $$(':scope > .nb', g).forEach(el => { el.classList.remove('nb', 'above', 'below'); el.style.gridRow = String(dir > 0 ? n + 1 : 1); });
  } else {
    const { days: dh, bars: bh } = calWeeksHTML(dir > 0 ? addDays(oldStart, 7 * n) : ui.viewStart, m, dir > 0 ? n : 0);
    const oldBars = new Set(g.querySelectorAll('.cfb'));
    g.insertAdjacentHTML('beforeend', dh + bh);
    barWidths([...g.querySelectorAll('.cfb')].filter(b => !oldBars.has(b)));
  }
  firstLabels(g);
  // (mobile: sized as fitRows sizes them there, mFit)
  const newRows = MOBILE ? mFit(viewDays(g).slice(ni * 7, (ni + n) * 7), g.clientHeight).px : fitSizes((nat || weekNeeds(viewDays(g))).slice(ni, ni + n), g.clientHeight).px;
  const avg = [...oldRows, ...newRows].reduce((x, y) => x + y, 0) / (2 * n);
  const hOf = (rows, at, i) => i >= at && i < at + n ? rows[i - at] : null;
  const a = [], b = [];
  for (let i = 0; i < n + m; i++) {
    a.push(hOf(oldRows, oi, i) ?? hOf(newRows, ni, i) ?? avg);
    b.push(hOf(newRows, ni, i) ?? hOf(oldRows, oi, i) ?? avg);
  }
  const sum = (rows, k) => rows.slice(0, k).reduce((x, y) => x + y, 0);
  const s0 = sum(a, oi) + pulled, s1 = sum(b, ni);
  // The slide moves pixels instead of redrawing them, as the day view's does: the strip is laid out once, each row as
  // tall as it gets (R), nothing scrolls, and every day and conflict bar is moved into place with a transform each
  // frame (days are layers: css #grid .day). Only the days of rows that change height get a new height (and a
  // repaint). (Resizing the rows and scrolling instead made the whole calendar repaint on every frame.)
  const moving = a.map((h, i) => h !== b[i]);
  // (rows that keep their height keep exactly it, and their days stay stretched to it: nothing in them is laid out again)
  const R = a.map((h, i) => moving[i] ? Math.ceil(Math.max(h, b[i])) : h), T = R.map((_, i) => sum(R, i));
  const rows = R.map(() => ({ days: [], bars: [] }));
  for (const el of g.children) {
    const r = parseInt(el.style.gridRowStart, 10) - 1; if (!(r >= 0 && r < R.length)) continue;
    if (el.classList.contains('day')) rows[r].days.push(el); else if (el.classList.contains('cfb')) rows[r].bars.push(el);
  }
  g.style.gridTemplateRows = R.map(h => h + 'px').join(' ');
  if (MOBILE) mClip(g);   // (arriving weeks built just now get their "…")
  g.classList.add('sliding'); g.scrollTop = 0;
  if (hl) setHL(hl, true);
  const frame = (k, all) => {
    let y = -(s0 + (s1 - s0) * k);
    R.forEach((_, i) => {
      const h = a[i] + (b[i] - a[i]) * k, tf = `translate3d(0,${(y - T[i]).toFixed(2)}px,0)`;
      for (const d of rows[i].days) {
        d.style.transform = tf;
        // a row changing height: its days get it (the fade on days with more below, markMore, follows, so it doesn't
        // drop out mid-slide)
        if (moving[i]) { if (all) d.style.alignSelf = 'start'; d.style.height = h.toFixed(2) + 'px'; markMore(d.querySelector('.items')); }
        else if (all) markMore(d.querySelector('.items'));
      }
      for (const c of rows[i].bars) c.style.transform = tf;
      y += h;
    });
  };
  frame(0, true);
  // landing: the weeks that left go, the rest drop their slide styles and take the new view's rows (b, as fitRows
  // has them). Something changed mid-slide (renderCal waited: stale): everything is redrawn instead.
  const land = () => {
    weekAnim.cancel(); const stale = weekAnim.stale; weekAnim = null;
    g.classList.remove('sliding');
    if (stale) { g.style.overflow = ''; return renderWeeks(); }
    const lo = ni + 1, hi = ni + n;   // rows kept
    for (const el of [...g.children]) {
      const r = parseInt(el.style.gridRowStart, 10);
      if (!r) continue;
      if (r < lo || r > hi) { el.remove(); continue; }
      if (dir > 0) el.style.gridRow = String(r - m);
      el.style.transform = ''; el.style.height = ''; el.style.alignSelf = '';
    }
    firstLabels(g);
    fitRows();                  // (still without a scrollbar: see renderCal)
    g.style.overflow = '';
    if (hl) setHL(hl, true);
    laterNeighbours();
  };
  weekAnim.finish = land;
  weekAnim.cancel = tween(WEEK_SLIDE_MS + 50 * (m - 1), k => frame(k), land).cancel;
}
/* The weeks just before and after the view are built ahead (.nb .above / .below), once things are quiet after a redraw
   or a slide: out of the layout, just past the top and bottom edges, where the grid clips them. A step then only has
   to turn the arriving one into an ordinary week. A full redraw (renderCal) drops them. */
let nbTimer = 0;
const laterNeighbours = () => { clearTimeout(nbTimer); nbTimer = setTimeout(buildNeighbours, 60); };
function buildNeighbours() {
  const g = $('#grid');
  if (weekAnim || drag || calStale || ui.dayView || admOpen || !g.clientHeight) return;
  const days = viewDays(g); if (days.length !== ui.weeks * 7) return;
  const rows = rowHeights(); g.style.setProperty('--nbh', (rows.reduce((x, y) => x + y, 0) / rows.length).toFixed(1) + 'px');
  for (const [side, ws] of [['above', addDays(ui.viewStart, -7)], ['below', addDays(ui.viewStart, 7 * ui.weeks)]]) {
    if (g.querySelector(`:scope > .day.nb.${side}`)) continue;
    const { days: dh, bars: bh } = calWeeksHTML(ws, 1, side === 'above' ? 0 : 1);   // (above: its first day says the month)
    const f = document.createRange().createContextualFragment(dh + bh);
    for (const el of f.children) { el.classList.add('nb', side); el.style.gridRow = '1 / -1'; if (weekPull) el.style.translate = `0 ${-weekPull}px`; }
    const bars = [...f.querySelectorAll('.cfb')];
    g.appendChild(f);
    barWidths(bars);
  }
  if (MOBILE) { mNbFit(g); mClip(g); }   // (mobile: each as tall as it will be in view, and its days end in "…" too)
}
// the pull: while a swipe builds up, the days (and the week beyond, built ahead) follow it with resistance, without
// the grid's edges moving, so the coming week shows; let go early and they spring back (settle)
let weekPull = 0;
function setPull(px, settle) {
  const g = $('#grid'); weekPull = px;
  g.classList.toggle('settle', !!settle);
  const tr = px ? `0 ${-px}px` : '';
  for (const el of g.children) if (el.classList.contains('day') || el.classList.contains('cfb')) el.style.translate = tr;
}
// scrolling the calendar: a week per swipe. The swipe pulls the days along (setPull); once it has scrolled WEEK_PULL
// px, the calendar takes the same step as ‹ › and the arrow keys, on from where the pull got to. A scroll that starts
// inside a day with more tasks than fit scrolls that day's list instead; once the list has reached its end, a fresh
// push (not the swipe's momentum) and another WEEK_PULL change the week.
const weekWheel = wheelSteps({
  pull: WEEK_PULL,
  skip: e => ui.dayView || e.ctrlKey || drag,                            // day view, pinch-zoom, or mid drag-and-drop
  axis: e => [wheelPx(e, e.deltaY), 0],
  ignore: e => Math.abs(e.deltaX) > Math.abs(e.deltaY),                  // sideways: nothing to do
  claim: (e, dy) => {
    const it = e.target.closest && e.target.closest('.items');
    return !(it && (dy > 0 ? it.scrollTop + it.clientHeight < it.scrollHeight - 1 : it.scrollTop > 0));
  },
  reclaim: WEEK_PULL,
  busy: () => !!weekAnim,
  step: dir => weekShift(dir),                                            // the same slide as ‹ › and the arrow keys
  follow: acc => setPull(acc * 0.35),                                    // with resistance
  back: () => { setPull(0, true); weekWheel.reset(); },                   // let go too early: springs back
});
$('main').addEventListener('wheel', weekWheel, { passive: false });
// chips ([id, html]) in order, each run of ones selected in the sidebar wrapped in one .selrun, which draws a single
// blue outline round the run's shape. Where some are selected, the runs of unselected ones are wrapped too (.unrun), so
// a hovered same-day group can outline each part in its own color (see css/calendar.css). None selected: as they are.
function selRuns(chips) {
  if (!chips.some(([id]) => sel.has(id))) return chips.map(c => c[1]).join('');
  let out = '', run = '', on = null;
  const end = () => { if (run) out += `<div class="${on ? 'selrun' : 'unrun'}">${run}</div>`; run = ''; };
  for (const [id, h] of chips) { if (sel.has(id) !== on) { end(); on = sel.has(id); } run += h; }
  end(); return out;
}
// mobile (mobile.js): just the title, on one line
const mChip = (cls, attrs, color, title) => `<div class="chip m ${cls}" ${attrs} style="--c:${esc(color)}"><div class="tt">${esc(title)}</div></div>`;
function chip({ p, t, path }, i) {
  const k = t.tasks[i];
  if (MOBILE) return mChip(k.done ? 'done' : '', `data-id="${k.id}" data-thread="${t.id}"`, colorOf(t), k.title);
  // next-day links to the task before / after it in the thread (see showLinkLines)
  const prev = k.linkToPrev === 'nextDay' && i > 0 ? t.tasks[i - 1] : null, next = t.tasks[i + 1] && t.tasks[i + 1].linkToPrev === 'nextDay' ? t.tasks[i + 1] : null;
  const nd = prev || next ? `<span class="nd">linked to ${prev && next ? 'prior and later tasks' : prev ? 'a prior task' : 'a later task'}</span>` : '';
  const links = (prev ? [prev.id] : []).concat(next ? [next.id] : []).join(' ');
  return `<div class="chip ${k.done ? 'done' : ''}${sel.has(k.id) ? ' sel' : ''}" draggable="true" data-id="${k.id}" data-thread="${t.id}" ${links ? `data-links="${links}"` : ''} style="--c:${esc(colorOf(t))}"
      ${k.notes ? '' : `title="${esc([p.name, ...path].join(' › '))}${isLoose(p, t) ? '' : ` #${i + 1}`}"`}>
    <input type="checkbox" data-act="done" data-id="${k.id}" ${k.done ? 'checked' : ''}>
    <div class="cb" data-act="reveal" data-id="${k.id}"><div class="tt">${esc(k.title)}${noteMark(k)}</div><div class="ts"><span class="tn">${esc(t.name)}${isLoose(p, t) ? '' : ` · ${i + 1}/${t.tasks.length}`}</span>${tryBadge(k)}${nd}</div></div>
    <button class="ic cx" data-act="unsched" data-id="${k.id}" title="Unschedule" draggable="false">${ICON.x}</button>
  </div>`;
}
/* A failed attempt (task.fails, see failTasks): a struck, hatched chip on the day it happened. It isn't the task
   itself (no data-id: no checkbox, selection or notes), but hovering it picks out the task, clicking shows it in the
   sidebar and right-clicking opens openFailMenu. While the task is unscheduled, dragging the chip to a day
   reschedules the task (the attempt stays where it is); dropping it back on itself calls that off (failBail), and
   once the task sits on a day again its attempts can't be dragged - that chip is the task's, so you drag it. */
function failChip(e) {
  if (MOBILE) return mChip('failed', `data-fid="${e.fl.id}" data-kid="${e.k.id}"`, colorOf(e.t), e.k.title);
  const tip = `Failed attempt ${e.a + 1} · ${[e.p.name, ...e.path].join(' › ')}`;
  return `<div class="chip failed" draggable="${e.k.date ? 'false' : 'true'}" data-fid="${e.fl.id}" data-kid="${e.k.id}" style="--c:${esc(colorOf(e.t))}" title="${esc(tip)}">
    <span class="fx">${ICON.x}</span>
    <div class="cb" data-act="reveal" data-id="${e.k.id}"><div class="tt">${esc(e.k.title)}</div><div class="ts"><span class="fl">failed</span><span class="tn">${esc(e.t.name)}</span></div></div>
  </div>`;
}
// on a task that has failed before: which attempt this is ("try 2"), with the earlier dates on hover
const tryBadge = k => k.fails ? `<span class="try" title="Failed ${k.fails.map(x => fmtShort(x.date)).join(', ')}">try ${attemptNo(k)}</span>` : '';
let hl = null;
// highlight one task in both the sidebar and the calendar
function setHL(id, force) {
  if (id === hl && !force) return;
  hl = id;
  $$('.hl').forEach(x => x.classList.remove('hl'));
  if (!id) return;
  $$(`.task[data-id="${id}"], #tree .drun[data-has~="${id}"]`).forEach(x => x.classList.add('hl'));   // sidebar: just that task (or its folded line)
  $$(`.chip[data-id="${id}"]`).forEach(c => (c.closest('.grp') || c).classList.add('hl'));  // calendar: its whole same-day group
  $$(`.chip[data-kid="${id}"]`).forEach(c => (c.closest('.grp') || c).classList.add('hl'));  // ... and its failed attempts (with the ones that failed linked to them)
}

// hover a task in one place -> highlight it in the other
const grid = $('#grid');
// (mobile: none, as a tap's emulated mouseover would leave the chip lit)
grid.addEventListener('mouseover', e => { if (drag || MOBILE) return; const c = e.target.closest('.chip'); setHL(c ? c.dataset.id || c.dataset.kid || null : null); });
grid.addEventListener('mouseleave', () => setHL(null));
// ⌘ / Ctrl / Shift-click a chip: select it, as in the sidebar (Shift: every chip between, day by day; selClick in sidebar.js)
grid.addEventListener('mousedown', e => {   // (Shift-click would otherwise select the text in between)
  if (e.shiftKey && e.target.closest('.chip[data-id]') && !e.target.closest('input, button, .inl')) e.preventDefault();
});
grid.addEventListener('click', e => {
  const c = e.target.closest('.chip[data-id]');
  if (!c || !(e.metaKey || e.ctrlKey || e.shiftKey) || e.target.closest('input, button, .inl')) return;
  e.stopPropagation(); clearTimeout(revealTimer); closeMenu();
  selClick(c.dataset.id, e.shiftKey, $$('#grid .chip[data-id]').map(x => x.dataset.id));
});
/* Dragging a task over a day opens a gap in its list where the task would land (calGap; tasks sit in sidebar order),
   and on the drop the chips slide into place: within a day from where they were, onto it from the gap; chips that
   changed day fade in where they land (flipTo). */
const calGap = makeGap('cgap');
// the chips that land on the day itself: the dragged task with its same-day group (just it with Option), or a selection
function calLanding(split) {
  if (drag.ids) return drag.ids;
  const f = findTask(drag.id); if (split || !f) return [drag.id];
  const [s, e] = dayRunOf(f.t, f.i); return f.t.tasks.slice(s, e + 1).map(k => k.id);
}
function calGapAt(day, split) {
  const d = day.dataset.date, f = findTask(drag.id);
  if (!f || !MOTION() || (!drag.ids && f.task.date === d)) return calGap.hide();
  const ids = calLanding(split), items = day.querySelector('.items');
  // the item the drop would sit above (dayDropBefore): the gap opens before its chip, inside its group if it's in one
  const nx = dayDropBefore(d, ids), q = nx ? `[data-id="${nx}"], [data-fid="${nx}"]` : '';
  const kids = [...items.children].filter(c => !c.classList.contains('dgap'));
  const at = nx ? kids.findIndex(c => c.matches(q) || c.querySelector(q)) : -1;
  const n = ids.slice(0, 3), h = n.reduce((a, id) => a + (($(`#grid .chip[data-id="${id}"]`) || {}).offsetHeight || drag.ch), 0) + 4 * (n.length - 1);
  calGap.show(d + ':' + at, el => at < 0 ? items.appendChild(el) : items.insertBefore(el, kids[at]), h);
}
const CAL_CHIPS = '#grid .chip[data-id], #grid .chip[data-fid]';
const chipKey = el => el.dataset.id ? 'c:' + el.dataset.id : 'f:' + el.dataset.fid;
const dropDay = e => e.target.closest('.day') || (e.target.closest('.cfb') && $(`#grid .day[data-date="${calDayAt(e.clientX, e.clientY)}"]`));
/* Back on the chip it came from = don't reschedule: a failed attempt's chip sits on the day its task would land on
   if it were dropped anywhere else there, so without this there'd be no way to change your mind over that day. */
const failBail = e => !!(drag && drag.from === 'fail' && e.target.closest(`.chip.failed[data-fid="${drag.fid}"]`));
grid.addEventListener('dragover', e => {
  if (!drag || drag.kind !== 'task') return; const day = dropDay(e); if (!day) return;
  e.preventDefault();
  if (failBail(e)) { e.dataTransfer.dropEffect = 'none'; $$('.day.over').forEach(x => x.classList.remove('over')); return calGap.hide(); }
  e.dataTransfer.dropEffect = splitHeld(e) ? 'copy' : 'move';
  if (!day.classList.contains('over')) { $$('.day.over').forEach(x => x.classList.remove('over')); day.classList.add('over'); }
  calGapAt(day, splitHeld(e));
});
grid.addEventListener('dragleave', e => { if (!grid.contains(e.relatedTarget)) { $$('.day.over').forEach(x => x.classList.remove('over')); calGap.hide(); } });
grid.addEventListener('drop', e => {
  const day = dropDay(e); if (!drag || drag.kind !== 'task' || !day) return;
  e.preventDefault();
  if (failBail(e)) { drag = null; calGap.hide(); return; }   // dropped back on its own chip: nothing to do
  calDropOn(day, splitHeld(e));
});
// the drop of `drag` on a day (also a touch drag's, mobile.js): the task moves there and the chips slide into place
function calDropOn(day, split) {
  const id = drag.id, many = drag.ids, date = day.dataset.date; drag = null;
  // chips now (the dropped ones at the gap), and which day each was on
  const before = snapRects(CAL_CHIPS, chipKey), dayOf = new Map($$(CAL_CHIPS).map(c => [chipKey(c), c.closest('.day').dataset.date]));
  const gr = calGap.el && calGap.el.getBoundingClientRect();
  if (gr) { let y = gr.top; (many ? movingMany(many, split) : movingIds(id, split)).forEach(k => { before.set('c:' + k, { left: gr.left, top: y, height: gr.height }); dayOf.set('c:' + k, date); y += gr.height + 4; }); }
  calGap.hide();
  if (many) selDate(many, date, split);   // a selection from the sidebar: every task to that day
  else moveTask(id, date, split);
  flipTo(CAL_CHIPS, chipKey, before, { fade: true, same: (el, k) => dayOf.get(k) === el.closest('.day').dataset.date });
}

/* Next-day links: resting on a chip that's linked to the task before or after it (on another day) for LINK_HOVER_MS
   draws a dotted line from it to each linked task: straight runs along the calendar's lines, rounded where they
   turn, drawing itself outward from the chip you're on. A linked task scrolled out of sight in its day's list is
   scrolled into view first. Nothing is drawn for a linked task that isn't on the weeks in view. The lines live in
   an SVG inside <main>, so day view and the Timeline cover them. */
const LINK_HOVER_MS = 1000, LINK_DRAW_MS = 650, LINK_R = 8;   // LINK_R: corner radius (px)
let linkChip = null, linkTimer = 0, linkAnim = null;
const linkSvg = (() => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); el.id = 'linkline';
  $('main').appendChild(el);
  return el;
})();
function hideLinkLine() {
  clearTimeout(linkTimer); linkChip = null;
  if (linkAnim) { linkAnim.cancel(); linkAnim = null; }
  linkSvg.classList.remove('on');
  $$('#grid .chip.linkfrom').forEach(c => c.classList.remove('linkfrom'));
}
function showLinkLines(c) {
  const others = c.isConnected ? c.dataset.links.split(' ').map(id => grid.querySelector(`.day:not(.nb) .chip[data-id="${id}"]`)).filter(Boolean) : [];
  if (!others.length) return;
  // bring the linked tasks into view in their days' lists
  const scrolls = others.map(o => {
    const it = o.closest('.items'), ir = it.getBoundingClientRect(), r = o.getBoundingClientRect(), s0 = it.scrollTop;
    let s1 = s0;
    if (r.top < ir.top + 4) s1 += r.top - ir.top - 4; else if (r.bottom > ir.bottom - 4) s1 += r.bottom - ir.bottom + 4;
    return [it, s0, clamp(s1, 0, it.scrollHeight - it.clientHeight)];
  }).filter(([, s0, s1]) => Math.abs(s1 - s0) >= 1);
  if (!scrolls.length) return drawLinkLines(c, others);
  linkAnim = tween(300, k => scrolls.forEach(([it, s0, s1]) => { it.scrollTop = s0 + (s1 - s0) * k; }), () => { linkAnim = null; drawLinkLines(c, others); });
}
// a path through points, with the corners rounded (radius up to LINK_R, less where a run is short)
function roundedPath(pts) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y), r = Math.min(LINK_R, l1 / 2, l2 / 2);
    if (r < 0.5) { d += ` L${x.toFixed(1)},${y.toFixed(1)}`; continue; }
    const ax = x - (x - px) / l1 * r, ay = y - (y - py) / l1 * r, bx = x + (nx - x) / l2 * r, by = y + (ny - y) / l2 * r;
    d += ` L${ax.toFixed(1)},${ay.toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + ` L${lx.toFixed(1)},${ly.toFixed(1)}`;
}
// the route from the earlier task's chip a to the later one's b (rects; dayB = b's day cell)
function linkRoute(a, b, dayB) {
  if (b.left > a.right - 2) {   // later day to the right: out of a's right edge, along the column line just left of b's day, into b's left edge
    const y0 = a.top + a.height / 2, y1 = b.top + b.height / 2, xm = dayB.left;
    return Math.abs(y1 - y0) < 1 ? [[a.right, y0], [b.left, y1]] : [[a.right, y0], [xm, y0], [xm, y1], [b.left, y1]];
  }
  // on the next week's row: down from a, along the line between the weeks, down into b's top
  const x0 = a.left + a.width / 2, x1 = b.left + b.width / 2, ym = dayB.top;
  return Math.abs(x1 - x0) < 1 ? [[x0, a.bottom], [x1, b.top]] : [[x0, a.bottom], [x0, ym], [x1, ym], [x1, b.top]];
}
function drawLinkLines(c, others) {
  if (linkChip !== c) return;
  const m = $('main').getBoundingClientRect(), rc = c.getBoundingClientRect(), NS = 'http://www.w3.org/2000/svg';
  linkSvg.innerHTML = '';
  linkSvg.style.setProperty('--c', getComputedStyle(c).getPropertyValue('--c'));   // the thread's color
  const reveal = others.map((o, n) => {
    const ro = o.getBoundingClientRect(), earlier = o.closest('.day').dataset.date < c.closest('.day').dataset.date;
    let pts = earlier ? linkRoute(ro, rc, c.closest('.day').getBoundingClientRect()) : linkRoute(rc, ro, o.closest('.day').getBoundingClientRect());
    if (earlier) pts = pts.reverse();   // always drawn outward from the chip you're on
    pts = pts.map(([x, y]) => [x - m.left, y - m.top]);
    const d = roundedPath(pts), g = document.createElementNS(NS, 'g');
    g.innerHTML = `<mask id="linkmask${n}" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%"><path class="rv" d="${d}"/></mask>
      <path class="ln" d="${d}" mask="url(#linkmask${n})"/><circle r="3" cx="${pts[0][0]}" cy="${pts[0][1]}"/><circle class="e1" r="3" cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}"/>`;
    linkSvg.appendChild(g);
    o.classList.add('linkfrom');
    const rv = g.querySelector('.rv'), L = rv.getTotalLength(), e1 = g.querySelector('.e1');
    rv.style.strokeDasharray = `${L} ${L}`; rv.style.strokeDashoffset = L; e1.style.opacity = 0;
    return k => { rv.style.strokeDashoffset = L * (1 - k); e1.style.opacity = clamp((k - 0.85) / 0.15, 0, 1); };
  });
  linkSvg.classList.add('on');
  linkAnim = tween(LINK_DRAW_MS, k => reveal.forEach(f => f(k)), () => { linkAnim = null; });
}
grid.addEventListener('mouseover', e => {
  const c = e.target.closest('.chip[data-links]');
  if (c === linkChip) return;
  hideLinkLine();
  if (!c || drag) return;
  linkChip = c; linkTimer = setTimeout(() => showLinkLines(c), LINK_HOVER_MS);
});
grid.addEventListener('mouseleave', hideLinkLine);
grid.addEventListener('mousedown', () => { const c = linkChip; hideLinkLine(); linkChip = c; });   // a click or drag ends it (until you move to another chip)
$('main').addEventListener('wheel', hideLinkLine, { passive: true });
