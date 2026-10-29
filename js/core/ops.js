'use strict';
/* Every change a user can make to the plan: scheduling, links, adding / moving / deleting projects, threads and
   tasks, archive and restore, conflicts. Each public operation wraps its change in mutate() (one undo step). */
/* ---------- operations ---------- */
// Change a task's date (no undo step of its own; callers wrap it in mutate).
//   normal: the task's whole linked chain moves with it, and (if "Shift later tasks" is on) everything later in the
//           thread shifts by the same amount
//   split (Option held): only this task moves; it's unlinked from its chain first and nothing else shifts
function applyMove(t, i, newDate, split) {
  const ts = t.tasks, task = ts[i], old = task.date;
  if (split) {
    if (ts[i + 1] && ts[i + 1].linkToPrev) ts[i + 1].linkToPrev = null;   // the rest of the chain keeps its dates
    task.linkToPrev = null;
    task.date = newDate;
    return;
  }
  const [s, e] = runOf(t, i);
  if (newDate === null) { for (let k = s; k <= e; k++) ts[k].date = null; return; }
  const off = offsets(t, s, e), base = addDays(newDate, -off[i - s]);
  for (let k = s; k <= e; k++) ts[k].date = addDays(base, off[k - s]);
  if (old === null || !ui.shiftLater) return;
  const delta = diffDays(newDate, old);
  // shift everything that comes later in this thread: later task chains and later sub-threads (whole subtrees)
  const L = layout(t), from = L.findIndex(x => x.obj === ts[e]);
  let k = from + 1;
  while (k < L.length) {
    if (L[k].kind === 'sub') { shiftSubtree(L[k].obj, delta); k++; continue; }
    const ti = ts.indexOf(L[k].obj), [rs, re] = runOf(t, ti), run = ts.slice(rs, re + 1);
    if (run[0].date && run.some(x => !x.done)) run.forEach(x => x.date = addDays(x.date, delta));
    k += re - ti + 1;
  }
}
function moveTask(id, newDate, split = false) {
  const f = findTask(id); if (!f) return;
  if (newDate === f.task.date) return;
  mutate(() => applyMove(f.t, f.i, newDate, split));
}
function setLink(id, type) {
  const f = findTask(id); if (!f || f.i === 0) return;
  mutate(() => { f.task.linkToPrev = type || null; });
}
function delTask(id) {
  const f = findTask(id); if (!f) return;
  mutate(() => detachTask(f));
}
// add tasks at a spot in a thread ({refId, side}; no refId = the very end).
// Inserting inside a linked chain links the new tasks same-day to the task above, keeping the chain intact.
function addTasks(tid, titles, spot) {
  const f = findThread(tid); if (!f) return null;
  titles = titles.map(s => s.trim()).filter(Boolean); if (!titles.length) return null;
  const news = titles.map(title => ({ id: uid(), title, date: null, done: false, linkToPrev: null }));
  if (spot && inserting) inserting = { tid, refId: news[news.length - 1].id, side: 'after' };
  else { focusAdd = tid; addOpen = tid; }
  mutate(() => {
    const t = f.t, L = layout(t), at = layoutIndex(L, spot && spot.refId, spot && spot.side);
    if (L[at] && L[at].kind === 'task' && L[at].obj.linkToPrev) news.forEach(n => n.linkToPrev = 'sameDay');
    L.splice(at, 0, ...news.map(o => ({ kind: 'task', obj: o })));
    writeLayout(t, L);
  });
}
function addProject() {
  const id = uid();
  mutate(() => state.projects.push({ id, name: 'New project', threads: [] }));
  startRename('p', id);
}
function addThread(pid) {
  const p = state.projects.find(x => x.id === pid); if (!p) return;
  const id = uid(); ui.collapsed[pid] = false; saveUI();
  const color = nextColor();
  mutate(() => p.threads.push({ id, name: 'New thread', color, tasks: [], threads: [] }));
  startRename('t', id);
}
function addSubThread(tid) {
  const f = findThread(tid); if (!f) return;
  const id = uid(); ui.collapsed[tid] = false; saveUI();
  mutate(() => { const L = layout(f.t); L.push({ kind: 'sub', obj: { id, name: 'New sub-thread', color: null, tasks: [], threads: [] } }); writeLayout(f.t, L); });
  startRename('t', id);
}
// detach a task from its thread, repairing the link of the task that followed it
function detachTask(f) {
  const ts = f.t.tasks, nx = ts[f.i + 1], a = f.task.linkToPrev;
  if (nx && nx.linkToPrev) nx.linkToPrev = a ? (a === 'nextDay' || nx.linkToPrev === 'nextDay' ? 'nextDay' : 'sameDay') : null;
  writeLayout(f.t, layout(f.t).filter(x => x.obj !== f.task));
}
// ids that move when task `id` is dragged: its whole linked chain, or just itself with Option
function movingIds(id, single) {
  const f = findTask(id); if (!f) return [];
  if (single) return [id];
  const [s, e] = runOf(f.t, f.i); return f.t.tasks.slice(s, e + 1).map(x => x.id);
}
/* A drop spot: { tid, refId, side } = in thread tid, before/after the task or sub-thread refId (no refId = at the end);
   or { pid, refId, side } = among a project's top-level threads. */
function isNoopTasks(id, single, spot) {
  const f = findTask(id); if (!f || f.t.id !== spot.tid) return false;
  const ids = movingIds(id, single), L = layout(f.t);
  const ms = L.findIndex(x => x.obj.id === ids[0]), me = L.findIndex(x => x.obj.id === ids[ids.length - 1]);
  const at = layoutIndex(L, spot.refId, spot.side);
  return at >= ms && at <= me + 1;
}
function isNoopThread(id, spot) {
  const f = findThread(id); if (!f) return true;
  if (spot.pid) {
    if (f.parent || f.p.id !== spot.pid) return false;
    const a = f.p.threads, m = a.indexOf(f.t);
    const at = spot.refId ? a.findIndex(x => x.id === spot.refId) + (spot.side === 'after' ? 1 : 0) : a.length;
    return at === m || at === m + 1;
  }
  if (!f.parent || f.parent.id !== spot.tid) return false;
  const L = layout(f.parent), m = L.findIndex(x => x.obj === f.t), at = layoutIndex(L, spot.refId, spot.side);
  return at === m || at === m + 1;
}
// move task `id` (with its linked chain unless `single`) to a drop spot
function moveTasksTo(id, single, spot) {
  const f = findTask(id), g = findThread(spot.tid); if (!f || !g) return;
  if (spot.refId && movingIds(id, single).includes(spot.refId)) return;
  if (isNoopTasks(id, single, spot)) return;
  ui.collapsed[spot.tid] = false; saveUI();
  mutate(() => {
    let moved;
    if (single) { detachTask(f); moved = [f.task]; }
    else {
      const [s, e] = runOf(f.t, f.i); moved = f.t.tasks.slice(s, e + 1);
      writeLayout(f.t, layout(f.t).filter(x => !moved.includes(x.obj)));
    }
    moved[0].linkToPrev = null;
    const L = layout(g.t);
    L.splice(layoutIndex(L, spot.refId, spot.side), 0, ...moved.map(o => ({ kind: 'task', obj: o })));
    writeLayout(g.t, L);
  });
}
// move a thread to a drop spot (inside a thread, or top level of a project)
function moveThreadTo(id, spot) {
  const f = findThread(id); if (!f) return;
  if (spot.tid && inSubtree(f.t, spot.tid)) return;
  if (isNoopThread(id, spot)) return;
  const c = colorOf(f.t);
  ui.collapsed[spot.tid || spot.pid] = false; saveUI();
  mutate(() => {
    if (f.parent) writeLayout(f.parent, layout(f.parent).filter(x => x.obj !== f.t));
    else f.p.threads.splice(f.p.threads.indexOf(f.t), 1);
    if (spot.pid) {
      const p = state.projects.find(x => x.id === spot.pid), a = p.threads;
      const at = spot.refId ? a.findIndex(x => x.id === spot.refId) + (spot.side === 'after' ? 1 : 0) : a.length;
      a.splice(at < 0 ? a.length : at, 0, f.t);
      delete f.t.afterTask;
      if (f.parent) f.t.color = f.t.color || c;          // becoming top-level: keep the color it was showing
    } else {
      const g = findThread(spot.tid), L = layout(g.t);
      L.splice(layoutIndex(L, spot.refId, spot.side), 0, { kind: 'sub', obj: f.t });
      writeLayout(g.t, L);
      if (g.t !== f.parent) f.t.color = null;            // new parent: take a shade of its color
    }
  });
}
function delProject(id) {
  const p = state.projects.find(x => x.id === id); if (!p) return;
  const n = p.threads.reduce((a, t) => a + subtreeTasks(t).length, 0);
  if (n && ui.confirmDelete && !confirm(`Delete project "${p.name}" and its ${plural(n, 'task')}? (Undo is available.)`)) return;
  mutate(() => state.projects.splice(state.projects.indexOf(p), 1));
  if (n && !ui.confirmDelete) toast(`Deleted project “${p.name}” — ⌘Z to undo.`);
}
function moveProject(id, dir) {
  const i = state.projects.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= state.projects.length) return;
  mutate(() => { const a = state.projects; [a[i], a[j]] = [a[j], a[i]]; });
}
function delThread(id) {
  const f = findThread(id); if (!f) return;
  const n = subtreeTasks(f.t).length, subs = f.t.threads.length;
  if ((n || subs) && ui.confirmDelete && !confirm(`Delete thread "${f.t.name}"${subs ? ', its sub-threads' : ''} and ${plural(n, 'task')}? (Undo is available.)`)) return;
  mutate(() => f.siblings.splice(f.siblings.indexOf(f.t), 1));
  if ((n || subs) && !ui.confirmDelete) toast(`Deleted thread “${f.t.name}” — ⌘Z to undo.`);
}
/* ---------- archive ----------
   Archiving takes a project, thread (with its sub-threads) or task out of the planner and files it in
   state.archive, newest first: { id, kind, at (date archived), item (the thing itself, untouched), from }.
   `from` remembers where it was (project, parent thread, the items next to it, the names along the way), so
   Restore can put it back in the same place. Archived things don't show anywhere else and don't take part in
   scheduling (shifting later tasks, links, order warnings). Archive / restore / delete are all undoable. */
function archiveEntry(kind, item, from) { state.archive = state.archive || []; state.archive.unshift({ id: uid(), kind, at: todayISO(), item, from }); }
// ids of the items just before and after `obj` in a list of {obj} (a thread's layout, or a project's threads)
function neighbours(list, obj) { const i = list.findIndex(x => (x.obj || x) === obj); return { prevId: i > 0 ? (list[i - 1].obj || list[i - 1]).id : null, nextId: i >= 0 && i + 1 < list.length ? (list[i + 1].obj || list[i + 1]).id : null }; }
function archivedToast(name) { toast(`Archived “${name}”. It’s under Archive at the top of the sidebar; ⌘Z to undo.`, 4500); }
function archiveTask(id) {
  const f = findTask(id); if (!f) return;
  mutate(() => {
    const from = { pid: f.p.id, tid: f.t.id, path: [f.p.name, ...f.path], ...neighbours(layout(f.t), f.task) };
    detachTask(f);                                       // repairs the link of the task that followed it
    archiveEntry('task', { ...f.task, linkToPrev: null }, from);
  }, true);
  archivedToast(f.task.title);
}
function archiveThread(id) {
  const f = findThread(id); if (!f) return;
  mutate(() => {
    const from = { pid: f.p.id, parentTid: f.parent ? f.parent.id : null, path: [f.p.name, ...f.path.slice(0, -1)], color: colorOf(f.t),
      ...(f.parent ? neighbours(layout(f.parent), f.t) : neighbours(f.p.threads, f.t)) };
    if (f.parent) writeLayout(f.parent, layout(f.parent).filter(x => x.obj !== f.t));
    else f.p.threads.splice(f.p.threads.indexOf(f.t), 1);
    archiveEntry('thread', f.t, from);
  }, true);
  archivedToast(f.t.name);
}
function archiveProject(id) {
  const p = state.projects.find(x => x.id === id); if (!p) return;
  mutate(() => {
    const from = { index: state.projects.indexOf(p), path: [], ...neighbours(state.projects, p) };
    state.projects.splice(state.projects.indexOf(p), 1);
    archiveEntry('project', p, from);
  }, true);
  archivedToast(p.name);
}
// where an archived entry would go back to, or why it can't (its project / thread is gone or archived itself)
function restoreTarget(e) {
  if (e.kind === 'project') return { ok: true };
  const p = state.projects.find(x => x.id === e.from.pid);
  if (e.kind === 'task') {
    const t = findThread(e.from.tid);
    return t ? { ok: true, t: t.t } : { ok: false, why: `Its thread “${e.from.path[e.from.path.length - 1]}” isn’t in the planner (archived or deleted). Restore that first.` };
  }
  if (e.from.parentTid) {
    const t = findThread(e.from.parentTid);
    if (t) return { ok: true, t: t.t };
    if (p) return { ok: true, p, note: 'as a top-level thread (its parent thread isn’t in the planner)' };
  } else if (p) return { ok: true, p };
  return { ok: false, why: `Its project “${e.from.path[0]}” isn’t in the planner (archived or deleted). Restore that first.` };
}
function restoreEntry(entryId) {
  const e = (state.archive || []).find(x => x.id === entryId); if (!e) return;
  const tg = restoreTarget(e); if (!tg.ok) return;
  mutate(() => {
    state.archive.splice(state.archive.indexOf(e), 1);
    const at = (list, idOf) => {   // insertion index: after the old neighbour above, else before the one below, else the end
      let i = e.from.prevId ? list.findIndex(x => idOf(x) === e.from.prevId) : -1;
      if (i >= 0) return i + 1;
      i = e.from.nextId ? list.findIndex(x => idOf(x) === e.from.nextId) : -1;
      return i >= 0 ? i : (e.kind === 'project' && e.from.index != null ? Math.min(e.from.index, list.length) : list.length);
    };
    if (e.kind === 'project') { state.projects.splice(at(state.projects, x => x.id), 0, e.item); return; }
    if (tg.t) {
      const L = layout(tg.t);
      L.splice(at(L, x => x.obj.id), 0, { kind: e.kind === 'task' ? 'task' : 'sub', obj: e.kind === 'task' ? { ...e.item, linkToPrev: null } : e.item });
      writeLayout(tg.t, L);
    } else {
      if (!e.item.color) e.item.color = e.from.color || nextColor();   // a top-level thread needs its own color
      tg.p.threads.splice(at(tg.p.threads, x => x.id), 0, e.item);
    }
  });
  const name = e.kind === 'task' ? e.item.title : e.item.name;
  toast(`Restored “${name}”${tg.note ? ' ' + tg.note : ''}.`);
}
function deleteEntry(entryId) {
  const e = (state.archive || []).find(x => x.id === entryId); if (!e) return;
  const name = e.kind === 'task' ? e.item.title : e.item.name;
  if (ui.confirmDelete && !confirm(`Permanently delete “${name}” from the archive? (Undo is available.)`)) return;
  mutate(() => state.archive.splice(state.archive.indexOf(e), 1));
}

/* ---------- conflicts ---------- */
function delConflict(id) { mutate(() => { state.conflicts = confs().filter(c => c.id !== id); }); }
// set a conflict's dates; moving the start keeps its length, an end before the start pulls the start back with it
function setConflictDates(id, start, end) {
  const c = confs().find(x => x.id === id); if (!c) return;
  mutate(() => {
    if (start === null) { c.start = c.end = null; return; }
    c.start = start; c.end = end && end >= start ? end : start;
  });
}

/* scratch tasks (day view's "Other to-do"): small to-dos outside every project; no dates, they stay until deleted */
const scratchList = () => (state.scratch = state.scratch || []);
// add one task per title, before the scratch task beforeId (none = at the end); returns the new ids
function addScratch(titles, beforeId) {
  titles = titles.map(s => s.trim()).filter(Boolean); if (!titles.length) return [];
  const news = titles.map(title => ({ id: uid(), title, done: false }));
  mutate(() => {
    const L = scratchList(), at = beforeId ? L.findIndex(x => x.id === beforeId) : -1;
    L.splice(at < 0 ? L.length : at, 0, ...news);
  });
  return news.map(n => n.id);
}
function setScratchDone(id, done) { const x = scratchList().find(s => s.id === id); if (x) mutate(() => { x.done = !!done; }); }
function renameScratch(id, title) { const x = scratchList().find(s => s.id === id); if (x && title.trim()) mutate(() => { x.title = title.trim(); }); }
function delScratch(id) { mutate(() => { state.scratch = scratchList().filter(s => s.id !== id); }); }
// delete every ticked-off scratch task; returns how many
function clearDoneScratch() {
  const n = scratchList().filter(s => s.done).length; if (!n) return 0;
  mutate(() => { state.scratch = scratchList().filter(s => !s.done); });
  return n;
}
// move a scratch task to just before beforeId (none = the end)
function moveScratch(id, beforeId) {
  if (id === beforeId) return;
  mutate(() => {
    const L = scratchList(), i = L.findIndex(s => s.id === id); if (i < 0) return;
    const [x] = L.splice(i, 1), at = beforeId ? L.findIndex(s => s.id === beforeId) : -1;
    L.splice(at < 0 ? L.length : at, 0, x);
  });
}
