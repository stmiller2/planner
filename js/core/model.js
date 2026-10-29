'use strict';
/* The planner's data and its rules (no DOM).
   state = { version, title?, projects: [{ id, name, threads }], archive: [...], conflicts: [...], scratch: [...] }
     thread = { id, name, color (null = shade of its parent's), tasks: [...], threads: [sub-threads], afterTask }
     task   = { id, title, date (YYYY-MM-DD or null), done, linkToPrev (null | 'sameDay' | 'nextDay'), plan? }
     scratch = day view's "Other to-do": [{ id, title, done }], small to-dos outside every project (no dates)
   Every change goes through mutate(), which normalizes, records undo, re-renders, saves and raises warnings. */

// link types a task can have to the task before it (the "+1d" kind adds a day; see offsets())
const LINKS = { sameDay: { badge: '=', label: 'Same day as' }, nextDay: { badge: '+1d', label: 'Day after' } };

/* ---------- state ---------- */
let state = { version: 4, projects: [], archive: [], conflicts: [], scratch: [] };
const undoStack = [], redoStack = [];
// stateGen counts changes to `state`; anything derived from it (index, colors, warnings, JSON) is cached per generation.
// Call touch() after changing state in place outside mutate().
let stateGen = 0;
const touch = () => { stateGen++; };
// a value computed from the current state, recomputed only when state has changed since (or `key` differs)
function memo(compute) {
  let of = null, gen = -1, key, val;
  return k => {
    if (of !== state || gen !== stateGen || key !== k) { val = compute(k); of = state; gen = stateGen; key = k; }
    return val;
  };
}
function nextColor() {
  const used = {}; PALETTE.forEach(c => used[c] = 0);
  state.projects.forEach(p => p.threads.forEach(t => { if (t.color in used) used[t.color]++; }));
  return PALETTE.reduce((best, c) => used[c] < used[best] ? c : best, PALETTE[0]);
}

// thread id -> color shown, for every live thread
let colors = new Map();
const liveColors = memo(() => { const m = new Map(); state.projects.forEach(p => colorTree(p.threads, null, m)); return m; });
function computeColors() { colors = liveColors(); }
const colorOf = t => colors.get(t.id) || t.color || PALETTE[0];

function migThread(t, top, counter) {
  const T = { ...t, id: t.id || uid(), name: String(t.name ?? 'Thread'),
    color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : (top ? PALETTE[counter.n % PALETTE.length] : null), tasks: [], threads: [] };
  if (top) counter.n++;
  for (const k of (Array.isArray(t.tasks) ? t.tasks : [])) {
    const link = k.linkToPrev in LINKS ? k.linkToPrev : (k.sameDayAsPrev ? 'sameDay' : null);
    const K = { ...k, id: k.id || uid(), title: String(k.title ?? ''), date: /^\d{4}-\d{2}-\d{2}$/.test(k.date) ? k.date : null, done: !!k.done, linkToPrev: link };
    delete K.sameDayAsPrev; delete K.doneOn;   // doneOn: briefly recorded by an earlier version, no longer used
    T.tasks.push(K);
  }
  for (const c of (Array.isArray(t.threads) ? t.threads : [])) {
    const C = migThread(c, false, counter);
    // older files had no interleaving: sub-threads came after all of the parent's tasks
    C.afterTask = 'afterTask' in c ? c.afterTask : (T.tasks.length ? T.tasks[T.tasks.length - 1].id : null);
    T.threads.push(C);
  }
  if (top) delete T.afterTask;
  normalize(T);
  return T;
}
function migrate(d) {
  const s = { version: 4, projects: [] };
  if (d && typeof d.title === 'string' && d.title.trim()) s.title = d.title.trim();   // custom name shown top-left
  const counter = { n: 0 };
  for (const p of (d && Array.isArray(d.projects) ? d.projects : [])) {
    const P = { ...p, id: p.id || uid(), name: String(p.name ?? 'Project'), threads: [] };
    delete P.color;
    for (const t of (Array.isArray(p.threads) ? p.threads : [])) P.threads.push(migThread(t, true, counter));
    s.projects.push(P);
  }
  // archived projects / threads / tasks (see "archive" below): kept as they were, with where they came from
  s.archive = (d && Array.isArray(d.archive) ? d.archive : []).filter(e => e && e.item && ['task', 'thread', 'project'].includes(e.kind));
  // conflicts (holidays, travel…): days that are blocked, { id, title, start, end } with end inclusive; no date = null
  const okD = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
  s.conflicts = (d && Array.isArray(d.conflicts) ? d.conflicts : []).filter(c => c && typeof c === 'object').map(c => {
    const st = okD(c.start) ? c.start : null, en = st && okD(c.end) && c.end >= st ? c.end : st;
    return { ...c, id: c.id || uid(), title: String(c.title ?? 'Conflict'), start: st, end: en };
  });
  // scratch tasks (day view's "Other to-do"): { id, title, done }
  s.scratch = (d && Array.isArray(d.scratch) ? d.scratch : []).filter(x => x && typeof x === 'object')
    .map(x => ({ id: x.id || uid(), title: String(x.title ?? ''), done: !!x.done })).filter(x => x.title.trim());
  return s;
}

/* Index of the current state, rebuilt only after it changes:
   every thread at any depth, in display order, as { p (project), t (thread), parent (thread or null), siblings, path (names) },
   plus lookups by thread id, by task id and by date. */
const index = memo(() => {
  const threads = [], byThread = new Map(), byTask = new Map(), byDate = new Map();
  const rec = (list, p, parent, path) => list.forEach(t => {
    const pth = path.concat(t.name), x = { p, t, parent, siblings: list, path: pth };
    threads.push(x);
    if (!byThread.has(t.id)) byThread.set(t.id, x);
    t.tasks.forEach((k, i) => {
      if (!byTask.has(k.id)) byTask.set(k.id, [x, i]);
      if (k.date) { if (!byDate.has(k.date)) byDate.set(k.date, []); byDate.get(k.date).push({ ...x, k, i }); }
    });
    rec(t.threads, p, t, pth);
  });
  state.projects.forEach(p => rec(p.threads, p, null, []));
  return { threads, byThread, byTask, byDate };
});
const allThreads = () => index().threads;
function findTask(id) { const f = index().byTask.get(id); return f ? { ...f[0], i: f[1], task: f[0].t.tasks[f[1]] } : null; }
function findThread(id) { return index().byThread.get(id) || null; }
// the tasks dated d, as { ...thread entry, k (task), i (its number - 1) }, in sidebar order
const dayTasks = d => (index().byDate.get(d) || []).slice();
function subtreeTasks(t) { return t.tasks.concat(...t.threads.map(subtreeTasks)); }
function inSubtree(root, id) { return root.id === id || root.threads.some(c => inSubtree(c, id)); }
// A chain = contiguous tasks joined by links (same day or next day). Chains always move together.
function runOf(t, i) {
  let s = i, e = i;
  while (s > 0 && t.tasks[s].linkToPrev) s--;
  while (e + 1 < t.tasks.length && t.tasks[e + 1].linkToPrev) e++;
  return [s, e];
}
function offsets(t, s, e) {
  const off = [0];
  for (let k = s + 1; k <= e; k++) off.push(off[off.length - 1] + (t.tasks[k].linkToPrev === 'nextDay' ? 1 : 0));
  return off;
}
function normalize(t) {
  const ts = t.tasks;
  ts.forEach(k => { if (!(k.linkToPrev in LINKS)) k.linkToPrev = null; });
  if (ts.length) ts[0].linkToPrev = null;
  let i = 0;
  while (i < ts.length) {
    const [s, e] = runOf(t, i);
    if (e > s) {
      const off = offsets(t, s, e);
      const m = ts.slice(s, e + 1).findIndex(x => x.date);
      if (m < 0) for (let k = s; k <= e; k++) ts[k].date = null;
      else { const base = addDays(ts[s + m].date, -off[m]); for (let k = s; k <= e; k++) ts[k].date = addDays(base, off[k - s]); }
    }
    i = e + 1;
  }
  // sub-thread anchors: must point at an existing task and never sit inside a linked chain
  t.threads.forEach(s => {
    if (!s.afterTask) { s.afterTask = null; return; }
    let a = ts.findIndex(k => k.id === s.afterTask);
    if (a < 0) a = ts.length - 1;
    while (a >= 0 && a + 1 < ts.length && ts[a + 1].linkToPrev) a++;
    s.afterTask = a >= 0 ? ts[a].id : null;
  });
  t.threads = layout(t).filter(x => x.kind === 'sub').map(x => x.obj);   // keep array in display order
}

/* layout: a thread's tasks and sub-threads interleaved in display order.
   Each sub-thread stores afterTask = id of the parent task it follows (null = before all tasks). */
function layout(t) {
  const out = [], at = new Map(), ids = new Set(t.tasks.map(k => k.id)), pre = [], post = [];
  t.threads.forEach(s => {
    if (!s.afterTask) pre.push(s);
    else if (ids.has(s.afterTask)) { if (!at.has(s.afterTask)) at.set(s.afterTask, []); at.get(s.afterTask).push(s); }
    else post.push(s);
  });
  pre.forEach(s => out.push({ kind: 'sub', obj: s }));
  t.tasks.forEach(k => { out.push({ kind: 'task', obj: k }); (at.get(k.id) || []).forEach(s => out.push({ kind: 'sub', obj: s })); });
  post.forEach(s => out.push({ kind: 'sub', obj: s }));
  return out;
}
function writeLayout(t, list) {
  t.tasks = []; t.threads = []; let last = null;
  for (const x of list) {
    if (x.kind === 'task') { t.tasks.push(x.obj); last = x.obj.id; }
    else { x.obj.afterTask = last; t.threads.push(x.obj); }
  }
}
// index in layout(t) where something dropped at {refId, side} lands (no ref = end)
function layoutIndex(L, refId, side) {
  if (!refId) return L.length;
  const i = L.findIndex(x => x.obj.id === refId);
  return i < 0 ? L.length : i + (side === 'after' ? 1 : 0);
}

/* Order rules (fork/join): within a thread, tasks and sub-threads run in display order.
   Consecutive sub-threads form a parallel block: each starts after whatever precedes the block,
   and whatever follows the block waits for all of them. */
function violations() {
  const out = [];
  const check = (t, p, path, floor) => {
    let cur = floor; const L = layout(t); let i = 0;
    while (i < L.length) {
      if (L[i].kind === 'task') {
        const k = L[i].obj;
        if (k.date) {
          if (cur && k.date < cur.d) out.push({ key: k.id + '>' + cur.task.id, p, path, task: k, i: t.tasks.indexOf(k), prev: cur.task, prevPath: cur.path });
          if (!cur || k.date > cur.d) cur = { d: k.date, task: k, path };
        }
        i++;
      } else {
        let blockMax = cur;
        while (i < L.length && L[i].kind === 'sub') {
          const s = L[i].obj, r = check(s, p, path.concat(s.name), cur);
          if (r && (!blockMax || r.d > blockMax.d)) blockMax = r;
          i++;
        }
        cur = blockMax;
      }
    }
    return cur;
  };
  state.projects.forEach(p => p.threads.forEach(t => check(t, p, [t.name], null)));
  return out;
}
// shift every not-fully-done scheduled chain in a thread and all its sub-threads
function shiftSubtree(t, delta) {
  let k = 0;
  while (k < t.tasks.length) {
    const [rs, re] = runOf(t, k); const run = t.tasks.slice(rs, re + 1);
    if (run[0].date && run.some(x => !x.done)) run.forEach(x => x.date = addDays(x.date, delta));
    k = re + 1;
  }
  t.threads.forEach(s => shiftSubtree(s, delta));
}

/* conflicts (holidays, travel…): { id, title, start, end } with end inclusive; no date = null.
   Which not-done scheduled tasks sit on a blocked day. */
const confs = () => (state.conflicts || []);
const confsOn = d => confs().filter(c => c.start && c.start <= d && d <= c.end);
const cfSpan = c => fmtShort(c.start) + (c.end !== c.start ? ' – ' + fmtShort(c.end) : '');   // "Nov 3 – Nov 5"
const cfTip = c => `${esc(c.title)} · ${cfSpan(c)}`;
// give overlapping date ranges separate lines (in list order): line number by id, and how many lines
function packLines(list) {
  const line = new Map(), ends = [];
  list.forEach(c => { let k = ends.findIndex(e => e < c.start); if (k < 0) { k = ends.length; ends.push(c.end); } else ends[k] = c.end; line.set(c.id, k); });
  return { line, count: ends.length };
}
function conflictHits() {
  const out = [], cs = confs().filter(c => c.start); if (!cs.length) return out;
  for (const { p, t, path } of allThreads()) for (const k of t.tasks) {
    if (k.done || !k.date) continue;
    for (const c of cs) if (c.start <= k.date && k.date <= c.end) out.push({ kind: 'cf', key: k.id + '@' + c.id + '@' + k.date, p, path, task: k, c });
  }
  return out;
}
const warningsOf = memo(() => [...(ui.orderWarn ? violations() : []), ...(ui.conflictWarn ? conflictHits() : [])]);
const warnings = () => warningsOf(`${ui.orderWarn}${ui.conflictWarn}`);
const stateJSON = memo(() => JSON.stringify(state));
function mutate(fn, quiet) {   // quiet: don't raise warnings for this change
  const before = stateJSON();
  const vBefore = quiet ? null : new Set(warnings().map(v => v.key));
  fn(); touch();
  allThreads().forEach(x => normalize(x.t)); touch();
  if (stateJSON() === before) { render(); return false; }
  undoStack.push(before); if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  afterChange(vBefore);
  return true;
}
function afterChange(vBefore) {
  render(); scheduleSave();
  const now = warnings();
  if (!now.length) hideWarn();
  else if (vBefore) { const fresh = now.filter(v => !vBefore.has(v.key)); if (fresh.length) showWarn(fresh); }
}
function undo() { if (!undoStack.length) return; redoStack.push(stateJSON()); state = JSON.parse(undoStack.pop()); hideWarn(); afterChange(null); }
function redo() { if (!redoStack.length) return; undoStack.push(stateJSON()); state = JSON.parse(redoStack.pop()); afterChange(null); }

/* A task's slot in day view: task.plan = { date, start, dur } (minutes from midnight). It only counts while plan.date
   matches the task's date, so moving a task to another day leaves its old slot dormant (it comes back if the task does). */
const planOf = k => (k.plan && k.plan.date === k.date && Number.isFinite(k.plan.start)) ? k.plan : null;
