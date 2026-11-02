'use strict';
/* The Timeline view's data (the code calls this view "admire"): admireData() turns live and archived tasks into
   projects › lanes with per-day counts and date spans. Drawing is in timeline.js. */
/* A timeline of finished work.
   Every finished task (live and archived) sits on its calendar day. One lane per thread (sub-threads branch off
   their parent), one ribbon per project, and a stacked wave of daily totals on top (one layer per thread).
   Unordered threads (isLoose: no progression) are "loose" lanes: no line and no row of their own. Their dots ride
   on their host's row: the nearest ordered thread above them (L.host), or the project's ribbon row (host null),
   without stretching that line. A project with no ordered work (or set unordered as a whole) has no ribbon and
   is a single row of dots; those come after the projects that have one.
   Optionally, tasks still on the calendar show too, a little transparent. Rows wrap a whole number of weeks to
   fit the window. Read-only: nothing here changes the plan. */
const ADM_PROJ = 32, ADM_LANE = 24, ADM_PULSE = 66, ADM_TIP_DELAY = 1000;
// bar thickness (px) for the project ribbon, a thread, a sub-thread; and bar opacity at its left / right end
const ADM_BAR = { rib: 12, top: 6, sub: 4 }, ADM_A0 = .38, ADM_A1 = .68, ADM_PLAN = .4;
const isoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null;
// lanes form trees (a sub-thread's lane has parentKey = its parent's): walk up from L (itself first unless self = false)
function* laneUp(L, lanes, self = true) { for (let x = self ? L : L.parentKey && lanes.get(L.parentKey); x; x = x.parentKey && lanes.get(x.parentKey)) yield x; }
const laneUnder = (L, key, lanes, self = true) => { for (const x of laneUp(L, lanes, self)) if (x.key === key) return true; return false; };
// a day's dot shared by several lanes: a pie of their colors
function pieOf(parts, d, tot) {
  if (parts.length < 2) return '';
  let acc = 0;
  return `conic-gradient(${parts.map(L => { const o = L.own.get(d), a = acc; acc += (o.done.length + o.plan.length) / tot * 360; return `${L.color} ${a.toFixed(1)}deg ${acc.toFixed(1)}deg`; }).join(',')})`;
}

function admireData(range, withPlan) {
  const projs = new Map(), lanes = new Map(), all = [];
  let undated = 0;
  const proj = (key, name, arch, loose = false) => { if (!projs.has(key)) projs.set(key, { key, name, arch, loose, lanes: [] }); return projs.get(key); };
  const addTask = (L, k, arch) => {
    const d = isoDate(k.date);
    if (k.done) { if (d) all.push({ d, k, L, plan: false }); else undated++; }
    else if (d && withPlan && !arch) all.push({ d, k, L, plan: true });
  };
  // a thread and everything under it, as lanes in display order
  const sub = (P, t, depth, parentKey, path, cmap, arch) => {
    const L = { key: t.id, name: t.name, path, depth, parentKey, color: cmap.get(t.id) || PALETTE[0], pkey: P.key, arch, loose: !!(t.unordered || P.loose), own: new Map(), n: 0, np: 0 };
    lanes.set(t.id, L);
    const out = [L];
    (t.tasks || []).forEach(k => addTask(L, k, arch));
    (t.threads || []).forEach(c => out.push(...sub(P, c, depth + 1, t.id, path.concat(c.name), cmap, arch)));
    return out;
  };
  state.projects.forEach(p => { const P = proj(p.id, p.name, false, !!p.unordered); p.threads.forEach(t => P.lanes.push(...sub(P, t, 0, null, [t.name], colors, false))); });
  const arch = (state.archive || []).slice().reverse();   // oldest first
  arch.filter(e => e.kind === 'project').forEach(e => {
    const P = proj(e.item.id, e.item.name, true, !!e.item.unordered), cm = colorTree(e.item.threads, null, new Map());
    (e.item.threads || []).forEach(t => P.lanes.push(...sub(P, t, 0, null, [t.name], cm, true)));
  });
  arch.filter(e => e.kind === 'thread').forEach(e => {
    const fr = e.from || {}, P = proj(fr.pid || 'p:' + (fr.path || ['Project'])[0], (fr.path || ['Project'])[0], true);
    const c0 = e.item.color || fr.color || PALETTE[P.lanes.length % PALETTE.length], cm = new Map([[e.item.id, c0]]); colorTree(e.item.threads, c0, cm);
    const par = fr.parentTid && lanes.get(fr.parentTid);
    const list = sub(P, e.item, par ? par.depth + 1 : 0, par ? par.key : null, (par ? par.path : []).concat(e.item.name), cm, true);
    if (par) { let at = P.lanes.indexOf(par); while (at + 1 < P.lanes.length && laneUnder(P.lanes[at + 1], par.key, lanes)) at++; P.lanes.splice(at + 1, 0, ...list); }
    else P.lanes.push(...list);
  });
  arch.filter(e => e.kind === 'task').forEach(e => {
    const fr = e.from || {}; let L = fr.tid && lanes.get(fr.tid);
    if (!L) {
      const path = (fr.path || ['Project', 'Thread']).slice(1), P = proj(fr.pid || 'p:' + (fr.path || ['Project'])[0], (fr.path || ['Project'])[0], true);
      L = { key: fr.tid || 'o:' + e.id, name: path[path.length - 1] || 'Thread', path, depth: 0, parentKey: null, color: PALETTE[P.lanes.length % PALETTE.length], pkey: P.key, arch: true, loose: P.loose, own: new Map(), n: 0, np: 0 };
      lanes.set(L.key, L); P.lanes.push(L);
    }
    addTask(L, e.item, true);
  });
  const done = all.filter(x => !x.plan), plan = all.filter(x => x.plan);
  if (!all.length) return { total: 0, everTotal: 0, undated };
  // date range: whole weeks; planned tasks stretch it to the last one on the calendar
  const today = todayISO(), minOf = xs => xs.reduce((m, x) => x.d < m ? x.d : m, xs[0].d), maxOf = xs => xs.reduce((m, x) => x.d > m ? x.d : m, xs[0].d);
  const first = range === 'all' ? minOf(done.length ? done : plan) : addDays(today, -7 * (range - 1));
  let last = today;
  if (done.length && maxOf(done) > last) last = maxOf(done);
  if (plan.length && maxOf(plan) > last) last = maxOf(plan);
  const R0 = weekStartOf(first), R1 = addDays(weekStartOf(last), 6);
  const inR = all.filter(x => x.d >= R0 && x.d <= R1);
  const days = new Map();   // day -> { done, plan }
  inR.forEach(x => {
    if (!x.L.own.has(x.d)) x.L.own.set(x.d, { done: [], plan: [] });
    x.L.own.get(x.d)[x.plan ? 'plan' : 'done'].push(x.k); x.plan ? x.L.np++ : x.L.n++;
    if (!days.has(x.d)) days.set(x.d, { done: 0, plan: 0 });
    days.get(x.d)[x.plan ? 'plan' : 'done']++;
  });
  // spans (s..e: everything shown; ds..de: finished only), each including everything underneath
  const lo = (a, b) => !a ? b : !b ? a : a < b ? a : b, hi = (a, b) => !a ? b : !b ? a : a > b ? a : b;
  const P = [...projs.values()];
  P.forEach(p => {
    p.lanes.forEach(L => {
      const ds = [...L.own.keys()].sort(), dd = ds.filter(d => L.own.get(d).done.length);
      L.s = ds[0] || null; L.e = ds[ds.length - 1] || null; L.ds = dd[0] || null; L.de = dd[dd.length - 1] || null; L.sub = L.n; L.subp = L.np;
    });
    for (let i = p.lanes.length - 1; i >= 0; i--) {   // children come after their parent in each list
      const L = p.lanes[i], par = L.parentKey && lanes.get(L.parentKey);
      if (!par || par.pkey !== p.key) continue;
      par.sub += L.sub; par.subp += L.subp;            // counts: everything underneath
      // spans: an ordered lane's line runs under its nearest ordered ancestor's (a loose lane has no line)
      if (L.loose || !L.s) continue;
      let A = par; while (A && A.loose) A = A.parentKey && lanes.get(A.parentKey);
      if (!A || A.pkey !== p.key) continue;
      A.s = lo(A.s, L.s); A.e = hi(A.e, L.e); A.ds = lo(A.ds, L.ds); A.de = hi(A.de, L.de);
    }
    p.lanes = p.lanes.filter(L => L.s || L.sub || L.subp);   // (a lane with nothing of its own still lists what's under it)
    p.n = p.lanes.reduce((a, L) => a + L.n, 0); p.np = p.lanes.reduce((a, L) => a + L.np, 0);
    // s..e / ds..de: the ribbon (ordered lanes only; none = no ribbon); as..ae: everything the project shows
    p.s = p.e = p.ds = p.de = p.as = p.ae = null;
    p.lanes.forEach(L => {
      if (!L.s) return;
      p.as = lo(p.as, L.s); p.ae = hi(p.ae, L.e); if (L.loose) return;
      p.s = lo(p.s, L.s); p.e = hi(p.e, L.e); p.ds = lo(p.ds, L.ds); p.de = hi(p.de, L.de);
    });
    // vs..ve: what a row shows (its line plus the loose dots it hosts); loose lanes find their host
    p.lanes.forEach(L => { L.vs = L.loose ? null : L.s; L.ve = L.loose ? null : L.e; });
    p.vs = p.s; p.ve = p.e;
    p.lanes.forEach(L => {
      if (!L.loose) return;
      let H = L.parentKey && lanes.get(L.parentKey); while (H && H.loose) H = H.parentKey && lanes.get(H.parentKey);
      if (H && H.pkey !== p.key) H = null;
      L.host = H ? H.key : null;
      if (L.s) { const o = H || p; o.vs = lo(o.vs, L.s); o.ve = hi(o.ve, L.e); }
    });
    p.color = (p.lanes.find(L => L.depth === 0) || p.lanes[0] || {}).color;
    p.days = new Map();
    p.lanes.forEach(L => L.own.forEach((o, d) => { const c = p.days.get(d) || { done: 0, plan: 0 }; c.done += o.done.length; c.plan += o.plan.length; p.days.set(d, c); }));
    // ribbon colors: each lane's color at the middle of its span
    const span = Math.max(1, diffDays(p.e || R0, p.s || R0));
    const stops = p.lanes.filter(L => (L.n || L.np) && !L.loose).map(L => [L.color, (diffDays(L.s, p.s) + diffDays(L.e, p.s)) / 2 / span]).sort((a, b) => a[1] - b[1]);
    const pick = stops.length > 7 ? stops.filter((x, i) => i % Math.ceil(stops.length / 7) === 0) : stops;
    if (pick.length > 1) pick.forEach((x, i) => x[1] = .5 * x[1] + .5 * i / (pick.length - 1));   // keep stops apart: always a blend
    p.ribStops = pick.length > 1 ? pick : [[p.color, 0], [shade(p.color || PALETTE[0], 2), 1]];
    p.rib = pick.length > 1 ? `linear-gradient(90deg,${pick.map(([c, f]) => `${c} ${(f * 100).toFixed(1)}%`).join(',')})` : `linear-gradient(90deg,${p.color},${shade(p.color || PALETTE[0], 2)})`;
  });
  // projects with a ribbon by where it starts, then the ones without, by their first task
  const projList = P.filter(p => p.n || p.np).sort((a, b) => (!a.s - !b.s) || ((a.s || a.as) < (b.s || b.as) ? -1 : (a.s || a.as) > (b.s || b.as) ? 1 : 0));
  const laneList = projList.flatMap(p => p.lanes);
  const maxCell = laneList.reduce((m, L) => { L.own.forEach(o => m = Math.max(m, o.done.length)); return m; }, 0);
  const total = inR.filter(x => !x.plan).length;
  return { total, planned: inR.length - total, everTotal: all.length, undated, R0, R1, days, projs: projList, lanes, maxCell,
    nThreads: laneList.filter(L => L.n).length, nProjs: projList.filter(p => p.n).length, first: (() => { const f = done.filter(x => x.d >= R0 && x.d <= R1); return f.length ? minOf(f) : null; })() };
}
// the same, computed once per change to the plan (redraws for resizing, folding or hovering reuse it)
const admireDataFor = memo(() => admireData(admRange, ui.admPlanned));
