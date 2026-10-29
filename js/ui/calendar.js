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
    const fr = e.from || {}, add = (k, color, name, path) => { if (k.date) (archOn[k.date] = archOn[k.date] || []).push({ k, color, name, path }); };
    if (e.kind === 'task') { const live = fr.tid && findThread(fr.tid); add(e.item, live ? colorOf(live.t) : fr.color || PALETTE[0], (fr.path || []).slice(-1)[0] || '', (fr.path || []).join(' › ')); return; }
    const cm = new Map(), threads = e.kind === 'project' ? (e.item.threads || []) : [e.item];
    if (e.kind === 'thread') { const c0 = e.item.color || fr.color || PALETTE[0]; cm.set(e.item.id, c0); colorTree(e.item.threads, c0, cm); } else colorTree(threads, null, cm);
    const rec = (t, path) => { (t.tasks || []).forEach(k => add(k, cm.get(t.id) || PALETTE[0], t.name, path.concat(t.name).join(' › '))); (t.threads || []).forEach(c => rec(c, path.concat(t.name))); };
    threads.forEach(t => rec(t, e.kind === 'project' ? [e.item.name] : (fr.path || [])));
  });
  return archOn;
});
function renderCal(strip) {
  if (weekAnim && !strip) return;                       // mid-slide: the slide re-renders when it lands
  hideLinkLine();
  const weeks = strip ? strip.weeks : ui.weeks, start = strip ? strip.start : ui.viewStart;
  const days = weeks * 7, end = addDays(start, days - 1), today = todayISO();
  const cols = colTemplate();
  const dow = $('#dow'); dow.style.gridTemplateColumns = cols;
  dow.innerHTML = Array.from({ length: 7 }, (_, i) => `<div>${DOW[(ui.weekStart + i) % 7]}</div>`).join('');
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
  const archChip = x => `<div class="chip arch ${x.k.done ? 'done' : ''}" style="--c:${esc(x.color)}" title="${esc(x.path)} · archived">
    <input type="checkbox" ${x.k.done ? 'checked' : ''} disabled tabindex="-1"><div class="cb"><div class="tt">${esc(x.k.title)}</div><div class="ts"><span class="tn">${esc(x.name)} · archived</span></div></div></div>`;
  const grid = $('#grid');
  grid.style.gridTemplateColumns = cols;
  // conflicts in view: each gets a slot (a line) so overlapping ones stack; a week keeps room for the slots it uses
  const cs = confs().filter(c => c.start && c.end >= start && c.start <= end)
    .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end > b.end ? -1 : 1);
  const slotOf = packLines(cs).line;
  const wkSlots = Array.from({ length: weeks }, (_, w) => { const ws = addDays(start, 7 * w), we = addDays(ws, 6);
    return cs.filter(c => c.start <= we && c.end >= ws).reduce((m, c) => Math.max(m, slotOf.get(c.id) + 1), 0); });
  let html = '', bars = '';
  for (let n = 0; n < days; n++) {
    const d = addDays(start, n), dd = parseD(d), wd = dd.getDay(), w = Math.floor(n / 7);
    const cls = ['day', (wd === 0 || wd === 6) && 'we', d === today && 'today', d < today && 'past', cs.some(c => c.start <= d && d <= c.end) && 'cf'].filter(Boolean).join(' ');
    const label = (n === 0 || dd.getDate() === 1) ? `${MON[dd.getMonth()]} ${dd.getDate()}` : dd.getDate();
    const items = (byDate[d] || []).map(r => {
      const chips = []; for (let k = r.s; k <= r.e; k++) chips.push(chip(r, k));
      return r.e > r.s ? `<div class="grp" style="--c:${esc(colorOf(r.t))}">${chips.join('')}</div>` : chips[0];
    }).join('') + (archOn[d] || []).map(archChip).join('');
    const gap = wkSlots[w] ? `<div class="cf-gap" style="height:${wkSlots[w] * CF_PITCH + 4}px"></div>` : '';
    html += `<div class="${cls}" data-date="${d}" style="grid-row:${w + 1};grid-column:${n % 7 + 1}"><div class="dn"><span class="n" data-act="openday" data-date="${d}">${label}</span></div>${gap}<div class="items">${items}</div></div>`;
  }
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, 7 * w), we = addDays(ws, 6);
    cs.filter(c => c.start <= we && c.end >= ws).forEach(c => {
      const a = c.start < ws ? ws : c.start, b = c.end > we ? we : c.end, st = c.start >= ws, en = c.end <= we;
      bars += `<div class="cfb ${st ? 's' : ''} ${en ? 'e' : ''}" data-cid="${c.id}" data-d0="${a}" title="${cfTip(c)}"
        style="grid-row:${w + 1};grid-column:${diffDays(a, ws) + 1} / ${diffDays(b, ws) + 2};margin-top:${CF_TOP + slotOf.get(c.id) * CF_PITCH}px">
        <span class="cfl" data-act="rename-c" data-id="${c.id}">${esc(c.title)}</span>${st ? '<i class="h l"></i>' : ''}${en ? '<i class="h r"></i>' : ''}</div>`;
    });
  }
  // days scrolled down to tasks further down their list stay where they were
  const keepScroll = new Map(); $$('.day .items', grid).forEach(it => { if (it.scrollTop) keepScroll.set(it.parentElement.dataset.date, it.scrollTop); });
  grid.innerHTML = html + bars;   // bars after the days, so the days stay children 1…n
  // renaming a long conflict: the box takes the width of the day it starts on
  $$('.cfb', grid).forEach(b => { const d = grid.querySelector(`.day[data-date="${b.dataset.d0}"]`); if (d) b.style.setProperty('--colw', d.offsetWidth + 'px'); });
  if (strip) grid.style.gridTemplateRows = strip.rows.map(h => h + 'px').join(' ');
  else fitRows();
  keepScroll.forEach((top, d) => { const it = grid.querySelector(`.day[data-date="${d}"] .items`); if (it) { it.scrollTop = top; markMore(it); } });
}
/* Week heights: busy weeks grow into the space emptier weeks don't need, but the calendar never gets taller
   than the window; when a week can't fit, its row is capped and the crowded days scroll inside themselves. */
function fitRows() {
  if (weekAnim) return;
  const grid = $('#grid'), days = $$('.day', grid), n = ui.weeks; if (!days.length) return;
  const H = grid.clientHeight; if (!H) return;
  const nat = Array(n).fill(0);
  days.forEach((d, idx) => {
    const it = d.querySelector('.items'), last = it.lastElementChild, dn = d.querySelector('.dn'), gap = d.querySelector('.cf-gap');
    const bottom = last ? last.offsetTop + last.offsetHeight + 3 : gap ? gap.offsetTop + gap.offsetHeight + 3 : dn.offsetTop + dn.offsetHeight;
    nat[Math.floor(idx / 7)] = Math.max(nat[Math.floor(idx / 7)], bottom + 9);   // + bottom padding and border
  });
  const want = nat.map(h => Math.max(h, Math.min(110, H / n)));
  let rows;
  if (want.reduce((a, b) => a + b, 0) <= H) rows = want.map(h => `minmax(${Math.ceil(h)}px, 1fr)`);
  else {                                   // cap: weeks that fit keep their height, the rest share what's left equally
    const sorted = [...want].sort((a, b) => a - b); let rem = H, k = n, cap = H / n;
    for (const h of sorted) { if (h <= rem / k) { rem -= h; k--; } else { cap = rem / k; break; } }
    rows = want.map(h => `${Math.floor(Math.min(h, cap))}px`);
  }
  grid.style.gridTemplateRows = rows.join(' ');
  days.forEach(d => markMore(d.querySelector('.items')));
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
const rowHeights = () => { const ds = $$('#grid .day'); return Array.from({ length: Math.floor(ds.length / 7) }, (_, w) => ds[w * 7].getBoundingClientRect().height); };
/* Slide one week up (dir 1) or down (dir -1). The grid briefly holds the old and new views together (one extra
   week) and scrolls from where it is now to where the new view sits, so you see the calendar move. Row heights
   blend along the way: the slide starts laid out exactly like the old view and ends exactly like the new one,
   so neither the start nor the landing jumps, even when a busy week sits next to a light one. */
function weekShift(dir) {
  if (weekAnim) weekAnim.finish();
  const g = $('#grid');
  const pulled = -(parseFloat((g.style.transform.match(/-?[\d.]+/) || [0])[0]) || 0);   // how far the pull already moved it
  g.classList.remove('settle'); g.style.transform = '';
  const oldStart = ui.viewStart, oldRows = rowHeights();
  ui.viewStart = addDays(oldStart, 7 * dir); render();                  // the new view, for its row heights (and header)
  const newRows = rowHeights(), n = ui.weeks;
  if (oldRows.length !== n || newRows.length !== n) return;
  // strip of n+1 weeks; each row's height goes from a → b, and the scroll position from s0 → s1
  let a, b, s0, s1, start;
  if (dir > 0) {   // [leaving week, shared weeks…, arriving week]
    start = oldStart;
    a = [oldRows[0], ...oldRows.slice(1), newRows[n - 1]];
    b = [oldRows[0], ...newRows.slice(0, n - 1), newRows[n - 1]];
    s0 = pulled; s1 = oldRows[0];
  } else {         // [arriving week, shared weeks…, leaving week]
    start = ui.viewStart;
    a = [newRows[0], ...oldRows.slice(0, n - 1), oldRows[n - 1]];
    b = [newRows[0], ...newRows.slice(1), oldRows[n - 1]];
    s0 = newRows[0] + pulled; s1 = 0;
  }
  weekAnim = { cancel() {}, finish: null };
  renderCal({ start, weeks: n + 1, rows: a });
  if (hl) setHL(hl, true);
  g.style.overflow = 'hidden'; g.scrollTop = s0;
  const land = () => { weekAnim.cancel(); weekAnim = null; g.style.overflow = ''; g.scrollTop = 0; render(); };
  weekAnim.finish = land;
  weekAnim.cancel = tween(WEEK_SLIDE_MS, k => {
    g.style.gridTemplateRows = a.map((h, i) => (h + (b[i] - h) * k).toFixed(2) + 'px').join(' ');
    g.scrollTop = s0 + (s1 - s0) * k;
  }, land).cancel;
}
// scrolling the calendar: a week per swipe. A scroll that starts inside a day with more tasks than fit scrolls that day's list instead.
const weekWheel = wheelSteps({
  pull: WEEK_PULL,
  skip: e => ui.dayView || e.ctrlKey || drag,                            // day view, pinch-zoom, or mid drag-and-drop
  axis: e => [wheelPx(e, e.deltaY), 0],
  ignore: e => Math.abs(e.deltaX) > Math.abs(e.deltaY),                  // sideways: nothing to do
  claim: (e, dy) => {
    const it = e.target.closest && e.target.closest('.items');
    return !(it && (dy > 0 ? it.scrollTop + it.clientHeight < it.scrollHeight - 1 : it.scrollTop > 0));
  },
  busy: () => !!weekAnim,
  step: weekShift,
  follow: acc => { const g = $('#grid'); g.classList.remove('settle'); g.style.transform = `translateY(${-acc * 0.35}px)`; },   // with resistance
  back: () => { const g = $('#grid'); g.classList.add('settle'); g.style.transform = ''; weekWheel.reset(); },               // let go too early
});
$('main').addEventListener('wheel', weekWheel, { passive: false });
function chip({ p, t, path }, i) {
  const k = t.tasks[i];
  // next-day links to the task before / after it in the thread (see showLinkLines)
  const prev = k.linkToPrev === 'nextDay' && i > 0 ? t.tasks[i - 1] : null, next = t.tasks[i + 1] && t.tasks[i + 1].linkToPrev === 'nextDay' ? t.tasks[i + 1] : null;
  const nd = prev || next ? `<span class="nd">linked to ${prev && next ? 'prior and later tasks' : prev ? 'a prior task' : 'a later task'}</span>` : '';
  const links = (prev ? [prev.id] : []).concat(next ? [next.id] : []).join(' ');
  return `<div class="chip ${k.done ? 'done' : ''}" draggable="true" data-id="${k.id}" data-thread="${t.id}" ${links ? `data-links="${links}"` : ''} style="--c:${esc(colorOf(t))}"
      title="${esc([p.name, ...path].join(' › '))} #${i + 1}">
    <input type="checkbox" data-act="done" data-id="${k.id}" ${k.done ? 'checked' : ''}>
    <div class="cb" data-act="reveal" data-id="${k.id}"><div class="tt">${esc(k.title)}</div><div class="ts"><span class="tn">${esc(t.name)} · ${i + 1}/${t.tasks.length}</span>${nd}</div></div>
    <button class="ic cx" data-act="unsched" data-id="${k.id}" title="Unschedule" draggable="false">${ICON.x}</button>
  </div>`;
}
let hl = null;
// highlight one task in both the sidebar and the calendar
function setHL(id, force) {
  if (id === hl && !force) return;
  hl = id;
  $$('.hl').forEach(x => x.classList.remove('hl'));
  if (!id) return;
  $$(`.task[data-id="${id}"], #tree .drun[data-has~="${id}"]`).forEach(x => x.classList.add('hl'));   // sidebar: just that task (or its folded line)
  $$(`.chip[data-id="${id}"]`).forEach(c => (c.closest('.grp') || c).classList.add('hl'));  // calendar: its whole same-day group
}

// hover a task in one place -> highlight it in the other
const grid = $('#grid');
grid.addEventListener('mouseover', e => { if (drag) return; const c = e.target.closest('.chip'); setHL(c ? c.dataset.id : null); });
grid.addEventListener('mouseleave', () => setHL(null));
grid.addEventListener('dragover', e => {
  if (!drag || drag.kind !== 'task') return; const day = e.target.closest('.day') || (e.target.closest('.cfb') && $(`#grid .day[data-date="${calDayAt(e.clientX, e.clientY)}"]`)); if (!day) return;
  e.preventDefault(); e.dataTransfer.dropEffect = splitHeld(e) ? 'copy' : 'move';
  if (!day.classList.contains('over')) { $$('.day.over').forEach(x => x.classList.remove('over')); day.classList.add('over'); }
});
grid.addEventListener('dragleave', e => { if (!grid.contains(e.relatedTarget)) $$('.day.over').forEach(x => x.classList.remove('over')); });
grid.addEventListener('drop', e => {
  const day = e.target.closest('.day') || (e.target.closest('.cfb') && $(`#grid .day[data-date="${calDayAt(e.clientX, e.clientY)}"]`)); if (!drag || drag.kind !== 'task' || !day) return;
  e.preventDefault(); const id = drag.id; drag = null;
  moveTask(id, day.dataset.date, splitHeld(e));
});

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
  const others = c.isConnected ? c.dataset.links.split(' ').map(id => grid.querySelector(`.chip[data-id="${id}"]`)).filter(Boolean) : [];
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
