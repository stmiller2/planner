'use strict';
/* Shared UI building blocks used by every view: element lookup, icons, popup menu, inline text / date boxes,
   warning bar, toasts, modal windows, drop / insert guide lines, and the animation + scroll-gesture helpers. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  auto: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'),
  dleft: svg('<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>'),
  dright: svg('<path d="m6 17 5-5-5-5M13 17l5-5-5-5"/>'),
  up: svg('<path d="m18 15-6-6-6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9.5h18M9 9.5V21M15 9.5V21M3 15.25h18"/>'),
  day: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  timeline: svg('<path d="M4 4v16"/><path d="M8 7h7"/><path d="M11 12h9"/><path d="M8 17h5"/>'),
  archive: svg('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>'),
  gear: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
};

/* ---------- inline text boxes ----------
   Wires up a box typed into in place: Enter (or `enter`) and clicking away finish saving, Esc finishes without
   saving; done(save) runs once. Returns finish(save); finish.claim() ends the box without calling done. */
function inlineBox(inp, done, { enter, keys } = {}) {
  let over = false;
  const claim = () => { if (over) return false; over = true; inp.dataset.done = '1'; return true; };
  const finish = save => { if (claim()) done(save); };
  finish.claim = claim;
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') enter ? enter() : finish(true);
    else if (e.key === 'Escape') finish(false);
    else if (keys) keys(e);
  });
  inp.addEventListener('blur', () => finish(true));
  return finish;
}

/* typed dates */
const dayLabel = d => { const x = parseD(d); return `${DOW[x.getDay()]}, ${MON[x.getMonth()]} ${x.getDate()}${x.getFullYear() !== new Date().getFullYear() ? ', ' + x.getFullYear() : ''}`; };
const dhint = document.createElement('div'); dhint.id = 'dhint'; document.body.appendChild(dhint);
// a small line under a date box saying what it reads as (or how to type one)
function dateHint(inp, opt = {}) {
  const v = parseDateText(inp.value), bad = v === null || (v === '' && !opt.allowEmpty && inp.value.trim() !== '') || (v && opt.min && v < opt.min);
  inp.classList.toggle('bad', !!bad);
  dhint.textContent = v ? (opt.min && v < opt.min ? `before ${fmtShort(opt.min)}` : dayLabel(v)) : v === '' ? (opt.emptyText || '') : 'try Nov 26, 11/26, fri, tomorrow, +3';
  if (!dhint.textContent || document.activeElement !== inp) { dhint.style.display = 'none'; return bad ? null : v; }
  const r = inp.getBoundingClientRect(); dhint.style.display = 'block';
  dhint.style.left = Math.min(innerWidth - dhint.offsetWidth - 8, Math.max(8, r.left)) + 'px'; dhint.style.top = (r.bottom + 4) + 'px';
  return bad ? null : v;
}
// swap a date button for a box you type into: Enter / clicking away saves, Esc cancels, ↑ / ↓ move a day
function editDateIn(btn, opt) {
  const inp = document.createElement('input'); inp.className = 'inl dinp'; inp.spellcheck = false;
  inp.value = opt.value ? fmtShort(opt.value) : ''; inp.placeholder = opt.placeholder || 'e.g. Nov 26';
  if (opt.clear) {   // a quiet × inside the box: unschedule
    const wrap = document.createElement('span'); wrap.className = 'dwrap';
    const x = document.createElement('button'); x.className = 'dclr'; x.title = 'Unschedule'; x.innerHTML = ICON.x; x.tabIndex = -1;
    x.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (!finish.claim()) return; dhint.style.display = 'none'; opt.clear(); });
    wrap.append(inp, x); btn.replaceWith(wrap);
  } else btn.replaceWith(inp);
  inp.focus(); inp.select();
  const finish = inlineBox(inp, save => {
    const v = save ? dateHint(inp, opt) : null;   // (reading the box can show the hint again: hide it after)
    dhint.style.display = 'none';
    if (save && v !== null && (v || null) !== (opt.value || null)) opt.commit(v || null); else render();
  }, {
    enter: () => { if (dateHint(inp, opt) !== null) finish(true); },
    keys: e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); const v = parseDateText(inp.value) || opt.value || opt.min || todayISO();
      inp.value = fmtShort(addDays(v, e.key === 'ArrowUp' ? 1 : -1)); dateHint(inp, opt);
    },
  });
  inp.addEventListener('input', () => dateHint(inp, opt));
  dateHint(inp, opt);
}

/* ---------- popup menu (the link menu) ---------- */
const menu = $('#menu');
function closeMenu() { menu.style.display = 'none'; }

/* ---------- inline rename ---------- */
// rename in place: in the sidebar (default), or on a calendar chip / day-view block or list item (el given)
let revealTimer = null;
// Pressing anywhere outside an open rename box saves and closes it right away, even on spots that
// would otherwise keep focus (other chips, day-view blocks).
document.addEventListener('pointerdown', e => {
  const inp = document.querySelector('.inl');
  if (inp && e.target !== inp && !e.target.closest('.dclr')) inp.blur();
}, true);
function startRename(kind, id, el) {
  el = el || $(`[data-act="rename-${kind}"][data-id="${id}"]`); if (!el) return;
  let cur, commit;
  if (kind === 'p') { const p = state.projects.find(x => x.id === id); cur = p.name; commit = v => mutate(() => p.name = v); }
  else if (kind === 't') { const f = findThread(id); cur = f.t.name; commit = v => mutate(() => f.t.name = v); }
  else if (kind === 'c') { const c = confs().find(x => x.id === id); cur = c.title; commit = v => mutate(() => c.title = v); }
  else if (kind === 's') { const x = (state.scratch || []).find(s => s.id === id); if (!x) return; cur = x.title; commit = v => renameScratch(id, v); }
  else if (kind === 'b') { cur = state.title || 'Planner'; commit = v => mutate(() => { if (v === 'Planner') delete state.title; else state.title = v; }); }
  else { const f = findTask(id); cur = f.task.title; commit = v => mutate(() => f.task.title = v); }
  const inp = document.createElement('input'); inp.className = 'inl'; inp.value = cur;
  el.replaceChildren(inp); el.style.overflow = 'visible'; el.classList.add('editing');
  const row = el.closest('[draggable]'); if (row) row.draggable = false;
  inp.focus(); inp.select();
  inlineBox(inp, save => { const v = inp.value.trim(); if (save && v && v !== cur) commit(v); else render(); });
}

/* ---------- warnings / toasts / modal ---------- */
function showWarn(list) {
  // conflicts: one line per conflict, however many tasks land on it
  const byC = new Map(); list.filter(v => v.kind === 'cf').forEach(v => { if (!byC.has(v.c.id)) byC.set(v.c.id, { c: v.c, ks: new Set() }); byC.get(v.c.id).ks.add(v.task.id); });
  const cfLines = [...byC.values()].map(({ c, ks }) => {
    const one = ks.size === 1 && list.find(v => v.kind === 'cf' && v.c.id === c.id);
    return `<div><b>Conflict</b>: ${one ? `“${esc(one.task.title)}” is` : `${ks.size} tasks are`} scheduled during “${esc(c.title)}” (${cfSpan(c)}).</div>`;
  });
  list = list.filter(v => v.kind !== 'cf');
  const lines = [...cfLines, ...list.slice(0, Math.max(0, 3 - cfLines.length)).map(v =>
    `<div><b>Out of order</b> in ${esc([v.p.name, ...v.path].join(' › '))}: #${v.i + 1} “${esc(v.task.title)}” (${fmtShort(v.task.date)}) comes before “${esc(v.prev.title)}”${v.prevPath !== v.path ? ` in ${esc(v.prevPath[v.prevPath.length - 1])}` : ''} (${fmtShort(v.prev.date)}), which should be done first.</div>`)];
  const extra = list.length - Math.max(0, 3 - cfLines.length); if (extra > 0) lines.push(`<div>…and ${extra} more out of order.</div>`);
  $('#warn .msg').innerHTML = lines.join('');
  $('#warn').style.display = 'flex';
}
function hideWarn() { $('#warn').style.display = 'none'; }
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'flex';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.display = 'none', ms);
}
function showModal(html, dismissable = true) {
  const m = $('#modal'), c = $('.card', m); c.innerHTML = html; c.className = 'card'; c.onclick = c.onchange = c.oninput = null; m.style.display = 'grid';
  m.dataset.dismiss = dismissable ? '1' : ''; m.dataset.kind = '';   // kind: 'help' / 'settings' (set by those windows)
  m.onclick = e => { if (dismissable && e.target === m) hideModal(); };
}
function hideModal() { $('#modal').style.display = 'none'; }

// a modal with a fixed title bar (title + ×) above a scrolling body; returns the body element
function framedModal(title, body) {
  showModal(`<div class="mhead"><h3>${title}</h3><button class="ic mx" title="Close">${ICON.x}</button></div><div class="mbody">${body}</div>`);
  const card = $('#modal .card'); card.classList.add('framed');
  card.querySelector('.mx').onclick = hideModal;
  return card.querySelector('.mbody');
}
/* ---------- guide lines ----------
   dropline: where a dragged item will land; insline: the "+" line for click-to-insert (sidebar and day list).
   Shown at height y, from x to the right edge `right` of the list it belongs to. */
const dropline = $('#dropline');
const insline = $('#insline');
function showGuide(el, y, x, right) {
  const inset = el === insline ? 18 : 4;   // (insline: its + sits in the first 13px, 5px clear of the line)
  Object.assign(el.style, { display: 'block', top: (y - (el === insline ? 0.5 : 1)) + 'px', left: (x + inset) + 'px', width: Math.max(20, right - x - inset - 8) + 'px' });
}
function hideInsline() { insline.style.display = 'none'; }

/* ---------- motion ---------- */
// run frame(k) on every animation frame for ms milliseconds (k eases out from 0 to 1), then done(); returns { cancel }
function tween(ms, frame, done) {
  const t0 = performance.now(), ease = t => 1 - Math.pow(1 - t, 3), h = { raf: 0, cancel: () => cancelAnimationFrame(h.raf) };
  const step = now => {
    const t = clamp((now - t0) / ms, 0, 1);   // (a frame's timestamp can be a hair before t0)
    frame(ease(t));
    if (t < 1) h.raf = requestAnimationFrame(step); else done();
  };
  h.raf = requestAnimationFrame(step);
  return h;
}

/* Scroll gestures that step one unit (a week, a day) per swipe, used by the calendar and the day view. While you
   scroll, the view follows your fingers a little (follow(acc)); once you've pulled past `pull` px it takes a step
   (step(±1)); let go before that and it springs back (back()). One step per gesture: the trackpad's momentum
   after a step is ignored until a fresh push (speed rising over several events in a row). Timing uses each event's
   own timestamp, so events that queue up while a busy view is drawn don't look like a pause (= a new gesture).
   o.axis(e) -> [px along the stepping axis, px across]; o.claim(e, along, across) decides, at the start of a
   gesture, whether it's ours (else the browser scrolls as usual); o.busy() is true while a step is animating.
   handler(e, canPrevent): canPrevent = false for events from a passive listener (it then can't stop the scroll). */
const WEEK_GAP = 160, WEEK_SLIDE_MS = 280;   // ms of quiet that ends a gesture; ms a step's slide takes
function wheelSteps(o) {
  let g = { acc: 0, last: 0, v: 0, rises: 0, locked: false, stepAt: 0, mine: false, endT: null };
  const handler = (e, canPrevent = true) => {
    if (o.skip(e)) return;
    const t = e.timeStamp, dt = t - g.last, fresh = dt > WEEK_GAP;
    const [d, across] = o.axis(e);
    if (o.ignore && o.ignore(e)) { g.last = t; return; }
    if (fresh) g = { acc: 0, last: t, v: 0, rises: 0, locked: false, stepAt: 0, mine: o.claim(e, d, across), endT: null };
    g.last = t;
    if (!g.mine) return;
    if (canPrevent) e.preventDefault();
    // speed rather than per-event size: when events bunch up, one event can carry several events' worth of scroll
    const v = Math.abs(d) / Math.max(dt, 8);
    const rising = v > g.v * 1.15; g.rises = rising ? g.rises + 1 : 0; g.v = v;
    if (g.locked) {
      if (!o.busy() && t - g.stepAt > WEEK_SLIDE_MS && g.rises >= 3 && v > 0.3) { g.locked = false; g.acc = 0; }
      else return;
    }
    if (o.waitWhileBusy && o.busy()) return;
    g.acc += d;
    clearTimeout(g.endT);
    if (Math.abs(g.acc) >= o.pull) { g.locked = true; g.stepAt = t; g.rises = 0; const dir = Math.sign(g.acc); g.acc = 0; o.step(dir); return; }
    o.follow(g.acc);
    g.endT = setTimeout(o.back, WEEK_GAP);
  };
  handler.reset = () => { g.acc = 0; };
  return handler;
}
const wheelPx = (e, d) => e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * 400 : d;   // lines / pages → px
