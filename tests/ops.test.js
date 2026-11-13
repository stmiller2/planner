// Editing the plan: adding, moving and deleting tasks / threads, archive and restore, conflicts.
const test = require('node:test'), assert = require('node:assert');
const { load, T, TH, plan, dates } = require('./load');
const j = x => JSON.parse(JSON.stringify(x));
const ids = (P, tid) => j(P.findThread(tid).t.tasks.map(k => k.id));
const links = (P, tid) => j(P.findThread(tid).t.tasks.map(k => k.linkToPrev));

test('new tasks typed inside a linked chain join it (same day)', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-03', { link: 'nextDay' })])]));
  P.addTasks('t', ['n1', ' ', 'n2'], { tid: 't', refId: 'b', side: 'before' });
  assert.deepStrictEqual(j(P.findThread('t').t.tasks.map(k => [k.title, k.date, k.linkToPrev])),
    [['a', '2026-11-02', null], ['n1', '2026-11-02', 'sameDay'], ['n2', '2026-11-02', 'sameDay'], ['b', '2026-11-03', 'nextDay']]);
});

test('deleting a task from the middle of a chain keeps the chain joined', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-02', { link: 'sameDay' }), T('c', '2026-11-03', { link: 'nextDay' }), T('d', '2026-11-03', { link: 'sameDay' })])]));
  P.delTask('b');   // b (same day) + c (next day) -> c is still the day after a
  assert.deepStrictEqual(links(P, 't'), [null, 'nextDay', 'sameDay']);
  assert.deepStrictEqual(dates(P, 'a', 'c', 'd'), { a: '2026-11-02', c: '2026-11-03', d: '2026-11-03' });
  P.delTask('a');   // the first task goes: the next one starts the chain
  assert.deepStrictEqual(links(P, 't'), [null, 'sameDay']);
});

test('dragging a task in the sidebar moves its whole chain; with Option just the task', () => {
  const P = load(plan([TH('t', [T('a'), T('b', null, { link: 'sameDay' }), T('c')]), TH('u', [T('x')])]));
  P.moveTasksTo('b', false, { tid: 'u', refId: 'x', side: 'after' });
  assert.deepStrictEqual(ids(P, 't'), ['c']);
  assert.deepStrictEqual(ids(P, 'u'), ['x', 'a', 'b']);
  assert.deepStrictEqual(links(P, 'u'), [null, null, 'sameDay']);
  P.moveTasksTo('b', true, { tid: 't', refId: null });
  assert.deepStrictEqual(ids(P, 't'), ['c', 'b']);
  assert.deepStrictEqual(links(P, 't'), [null, null]);
});

test('sidebar drops inside chains: reorder a same-day group, join one, split a next-day link', () => {
  const D1 = '2026-11-02', D2 = '2026-11-03';
  const chain = () => [T('a', D1), T('b', D1, { link: 'sameDay' }), T('c', D1, { link: 'sameDay' }), T('d', D2, { link: 'nextDay' }), T('e', D2, { link: 'sameDay' }), T('x', '2026-11-09')];
  const row = P => j(P.findThread('t').t.tasks.map(k => [k.id, k.linkToPrev, k.date]));
  // within a same-day group: only that task moves, the group keeps its links and its place in the chain
  let P = load(plan([TH('t', chain())]));
  assert.ok(P.dropSingle('c', false, { tid: 't', refId: 'a', side: 'before' }));
  P.moveTasksTo('c', false, { tid: 't', refId: 'a', side: 'before' }, true);
  assert.deepStrictEqual(row(P), [['c', null, D1], ['a', 'sameDay', D1], ['b', 'sameDay', D1], ['d', 'nextDay', D2], ['e', 'sameDay', D2], ['x', null, '2026-11-09']]);
  P.moveTasksTo('e', false, { tid: 't', refId: 'd', side: 'before' }, true);       // front of a group that follows a next-day link
  assert.deepStrictEqual(links(P, 't'), [null, 'sameDay', 'sameDay', 'nextDay', 'sameDay', null]);
  assert.deepStrictEqual(ids(P, 't'), ['c', 'a', 'b', 'e', 'd', 'x']);
  P.moveTasksTo('a', false, { tid: 't', refId: 'b', side: 'after' }, true);         // last in its group (before the next-day step)
  assert.deepStrictEqual(ids(P, 't'), ['c', 'b', 'a', 'e', 'd', 'x']);
  assert.deepStrictEqual(links(P, 't'), [null, 'sameDay', 'sameDay', 'nextDay', 'sameDay', null]);
  // an unlinked task dropped inside a same-day group joins it (and takes its day)
  P = load(plan([TH('t', chain())]));
  P.moveTasksTo('x', false, { tid: 't', refId: 'b', side: 'after' }, true);
  assert.deepStrictEqual(row(P).slice(0, 4), [['a', null, D1], ['b', 'sameDay', D1], ['x', 'sameDay', D1], ['c', 'sameDay', D1]]);
  // ... and dropped between next-day-linked tasks it unlinks them; everything keeps its date
  P = load(plan([TH('t', chain())]));
  P.moveTasksTo('x', false, { tid: 't', refId: 'd', side: 'before' }, true);
  assert.deepStrictEqual(row(P), [['a', null, D1], ['b', 'sameDay', D1], ['c', 'sameDay', D1], ['x', null, '2026-11-09'], ['d', null, D2], ['e', 'sameDay', D2]]);
  // a linked task dropped outside its chain still takes the whole chain along
  P = load(plan([TH('t', chain()), TH('u', [T('y')])]));
  assert.ok(!P.dropSingle('b', false, { tid: 'u', refId: 'y', side: 'after' }));
  P.moveTasksTo('b', false, { tid: 'u', refId: 'y', side: 'after' }, true);
  assert.deepStrictEqual(ids(P, 'u'), ['y', 'a', 'b', 'c', 'd', 'e']);
  // where it already is: nothing to do
  P = load(plan([TH('t', chain())]));
  assert.ok(P.isNoopTasks('b', false, { tid: 't', refId: 'b', side: 'after' }, true));
  assert.ok(P.isNoopTasks('b', false, { tid: 't', refId: 'a', side: 'after' }, true));
  assert.ok(!P.isNoopTasks('b', false, { tid: 't', refId: 'c', side: 'after' }, true));
});

test('dropping a task where it already is changes nothing', () => {
  const P = load(plan([TH('t', [T('a'), T('b'), T('c')])]));
  assert.ok(P.isNoopTasks('b', false, { tid: 't', refId: 'b', side: 'before' }));
  assert.ok(P.isNoopTasks('b', false, { tid: 't', refId: 'c', side: 'before' }));
  assert.ok(!P.isNoopTasks('b', false, { tid: 't', refId: 'a', side: 'before' }));
});

test('moving threads: into another thread, out to the top level, never into itself', () => {
  const P = load(plan([TH('t', [T('a')], { color: '#2e9e6b', threads: [TH('s', [T('b')], { after: 'a' })] }), TH('u', [T('c')], { color: '#d9534f' })]));
  P.computeColors();
  const shown = P.colorOf(P.findThread('s').t);
  P.moveThreadTo('s', { pid: 'p', refId: 'u', side: 'after' });          // sub-thread -> top level keeps the color it showed
  assert.strictEqual(P.findThread('s').parent, null);
  assert.strictEqual(P.findThread('s').t.color, shown);
  P.moveThreadTo('u', { tid: 's', refId: 'b', side: 'after' });          // top level -> under s: takes a shade of s
  assert.strictEqual(P.findThread('u').parent.id, 's');
  assert.strictEqual(P.findThread('u').t.color, null);
  P.moveThreadTo('s', { tid: 'u' });                                      // into its own sub-thread: refused
  assert.strictEqual(P.findThread('s').parent, null);
});

test('archive and restore put things back where they were', () => {
  const P = load(plan([TH('t', [T('a'), T('b'), T('c')], { threads: [TH('s', [T('x')], { after: 'b' })] }), TH('u', [T('y')])]));
  P.archiveTask('b');
  assert.deepStrictEqual(ids(P, 't'), ['a', 'c']);
  assert.strictEqual(P.state.archive[0].kind, 'task');
  P.restoreEntry(P.state.archive[0].id);
  assert.deepStrictEqual(ids(P, 't'), ['a', 'b', 'c']);
  P.archiveThread('t');
  assert.strictEqual(P.findThread('t'), null);
  assert.strictEqual(P.findTask('x'), null);   // archived things leave the planner (and its scheduling)
  P.archiveProject('p');
  assert.strictEqual(P.state.projects.length, 0);
  const tEntry = P.state.archive.find(e => e.kind === 'thread');
  assert.strictEqual(P.restoreTarget(tEntry).ok, false);   // its project is archived: restore that first
  P.restoreEntry(P.state.archive.find(e => e.kind === 'project').id);
  P.restoreEntry(tEntry.id);
  assert.deepStrictEqual(j(P.state.projects[0].threads.map(t => t.id)), ['t', 'u']);
  assert.strictEqual(P.state.archive.length, 0);
});

test('restoring a sub-thread whose parent is gone puts it at the top level', () => {
  const P = load(plan([TH('t', [T('a')], { threads: [TH('s', [T('x')], { after: 'a' })] })]));
  P.computeColors();
  P.archiveThread('s');
  P.delThread('t');
  const e = P.state.archive[0];
  assert.match(P.restoreTarget(e).note, /top-level/);
  P.restoreEntry(e.id);
  assert.strictEqual(P.findThread('s').parent, null);
  assert.ok(P.findThread('s').t.color);   // a top-level thread needs its own color
});

test('every operation is one undo step', () => {
  const P = load(plan([TH('t', [T('a'), T('b')])]));
  P.addProject(); P.addThread('p'); P.archiveTask('a'); P.delTask('b');
  assert.strictEqual(P.undoStack.length, 4);
  P.undo(); P.undo(); P.undo(); P.undo();
  assert.deepStrictEqual(ids(P, 't'), ['a', 'b']);
  assert.strictEqual(P.state.projects.length, 1);
});

test('conflicts: changing dates keeps them valid, deleting removes them', () => {
  const P = load(plan([], { conflicts: [{ id: 'c', title: 'Trip', start: '2026-11-03', end: '2026-11-05' }] }));
  P.setConflictDates('c', '2026-11-10', '2026-11-01');   // an end before the start becomes a one-day conflict
  assert.deepStrictEqual(j(P.state.conflicts.map(c => [c.start, c.end])), [['2026-11-10', '2026-11-10']]);
  P.setConflictDates('c', null);
  assert.deepStrictEqual(j(P.state.conflicts.map(c => [c.start, c.end])), [[null, null]]);
  P.delConflict('c');
  assert.strictEqual(P.state.conflicts.length, 0);
});

test('scratch tasks: add (at the end or before one), tick, reorder, clear done, delete; undo', () => {
  const P = load(plan([TH('t', [T('a')])]));
  const titles = () => j(P.state.scratch.map(s => s.title));
  const [x] = P.addScratch(['  first ', '']);
  P.addScratch(['second', 'third']);
  assert.deepStrictEqual(titles(), ['first', 'second', 'third']);
  const third = P.state.scratch[2].id;
  P.addScratch(['before third'], third);
  assert.deepStrictEqual(titles(), ['first', 'second', 'before third', 'third']);
  P.moveScratch(x, null); assert.deepStrictEqual(titles(), ['second', 'before third', 'third', 'first']);
  P.moveScratch(x, P.state.scratch[0].id); assert.deepStrictEqual(titles(), ['first', 'second', 'before third', 'third']);
  P.setScratchDone(x, true); P.setScratchDone(third, true);
  assert.strictEqual(P.clearDoneScratch(), 2);
  assert.deepStrictEqual(titles(), ['second', 'before third']);
  P.undo(); assert.deepStrictEqual(titles(), ['first', 'second', 'before third', 'third']);
  P.delScratch(x); assert.deepStrictEqual(titles(), ['second', 'before third', 'third']);
  assert.strictEqual(P.findThread('t').t.tasks.length, 1);   // nothing to do with any project
});

test('task notes: set, trimmed, cleared when empty, one undo step each, and kept through archive / restore', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b')])]));
  P.setTaskNotes('a', '  use 2x buffer\nfreezer B, shelf 3 \n');
  assert.strictEqual(P.findTask('a').task.notes, 'use 2x buffer\nfreezer B, shelf 3');
  const n = P.undoStack.length;
  P.setTaskNotes('a', 'use 2x buffer\nfreezer B, shelf 3');   // unchanged: no undo step
  assert.strictEqual(P.undoStack.length, n);
  P.archiveTask('a');
  assert.strictEqual(P.state.archive[0].item.notes, 'use 2x buffer\nfreezer B, shelf 3');
  P.restoreEntry(P.state.archive[0].id);
  assert.strictEqual(P.findTask('a').task.notes, 'use 2x buffer\nfreezer B, shelf 3');
  P.setTaskNotes('a', '   ');
  assert.ok(!('notes' in P.findTask('a').task));
  P.undo();
  assert.strictEqual(P.findTask('a').task.notes, 'use 2x buffer\nfreezer B, shelf 3');
});

/* ---------- several tasks at once (a sidebar selection) ---------- */
test('several tasks dropped on a day: unscheduled ones all get that date, in one undo step', () => {
  const P = load(plan([TH('t', [T('a'), T('b'), T('c')]), TH('u', [T('x')])]));
  assert.ok(P.dateTasks(['x', 'a', 'c'], '2026-11-10'));
  assert.deepStrictEqual(dates(P, 'a', 'b', 'c', 'x'), { a: '2026-11-10', b: null, c: '2026-11-10', x: '2026-11-10' });
  P.undo();
  assert.deepStrictEqual(dates(P, 'a', 'c', 'x'), { a: null, c: null, x: null });
});

test('several scheduled tasks dropped on a day: earlier first, later tasks keep their spacing from the last one', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-04'), T('c', '2026-11-06')])]), { prefs: { shiftLater: true } });
  P.dateTasks(['b', 'a'], '2026-11-10');
  assert.deepStrictEqual(dates(P, 'a', 'b', 'c'), { a: '2026-11-10', b: '2026-11-10', c: '2026-11-12' });
});

test('a linked chain in the selection is placed by its first selected task, not dragged around by each one', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-03', { link: 'nextDay' }), T('c', '2026-11-04', { link: 'nextDay' })])]));
  P.dateTasks(['a', 'b', 'c'], '2026-11-10');
  assert.deepStrictEqual(dates(P, 'a', 'b', 'c'), { a: '2026-11-10', b: '2026-11-11', c: '2026-11-12' });
  P.dateTasks(['b'], '2026-11-20');   // one task of a chain: the chain comes along, as with a single drag
  assert.deepStrictEqual(dates(P, 'a', 'b', 'c'), { a: '2026-11-19', b: '2026-11-20', c: '2026-11-21' });
});

test('Option-drop of several tasks: only they move; links among them stay, links to others are cut', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-02', { link: 'sameDay' }), T('c', '2026-11-02', { link: 'sameDay' }), T('d', '2026-11-05')])]), { prefs: { shiftLater: true } });
  P.dateTasks(['b', 'c'], '2026-11-12', true);
  assert.deepStrictEqual(dates(P, 'a', 'b', 'c', 'd'), { a: '2026-11-02', b: '2026-11-12', c: '2026-11-12', d: '2026-11-05' });
  assert.deepStrictEqual(links(P, 't'), [null, null, 'sameDay', null]);
});

test('unscheduling several tasks at once', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-03')])]));
  P.dateTasks(['a', 'b'], null);
  assert.deepStrictEqual(dates(P, 'a', 'b'), { a: null, b: null });
});

test('linking several tasks same-day gathers them after the first one, per thread', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b'), T('c'), T('d', '2026-11-09')]), TH('u', [T('x'), T('y')]), TH('v', [T('z')])]));
  assert.strictEqual(P.linkTasks(['d', 'a', 'c', 'x', 'y', 'z'], 'sameDay'), 2);   // z: alone in its thread, left as is
  assert.deepStrictEqual(ids(P, 't'), ['a', 'c', 'd', 'b']);
  assert.deepStrictEqual(links(P, 't'), [null, 'sameDay', 'sameDay', null]);
  assert.deepStrictEqual(dates(P, 'a', 'c', 'd'), { a: '2026-11-02', c: '2026-11-02', d: '2026-11-02' });
  assert.deepStrictEqual(links(P, 'u'), [null, 'sameDay']);
  assert.strictEqual(P.linkTasks(['z'], 'sameDay'), 0);
  P.linkTasks(['a', 'c', 'd'], 'nextDay');
  assert.deepStrictEqual(dates(P, 'a', 'c', 'd'), { a: '2026-11-02', c: '2026-11-03', d: '2026-11-04' });
  P.unlinkTasks(['c', 'd']);
  assert.deepStrictEqual(links(P, 't'), [null, null, null, null]);
});

test('linking keeps sub-threads and other chains intact', () => {
  const P = load(plan([TH('t', [T('a'), T('b'), T('c'), T('d', null, { link: 'sameDay' })], { threads: [TH('s', [T('s1')], { after: 'a' })] })]));
  P.linkTasks(['a', 'c'], 'sameDay');
  const L = P.layout(P.findThread('t').t).map(x => x.obj.id);
  assert.deepStrictEqual(j(L), ['a', 'c', 's', 'b', 'd']);
  assert.deepStrictEqual(links(P, 't'), [null, 'sameDay', null, null]);   // c leaves its chain with d: d starts over
});

test('several tasks: done, archive, delete, each one undo step', () => {
  const P = load(plan([TH('t', [T('a'), T('b'), T('c'), T('d')])]));
  P.setTasksDone(['a', 'c'], true);
  assert.deepStrictEqual(j(P.findThread('t').t.tasks.map(k => k.done)), [true, false, true, false]);
  P.archiveTasks(['b', 'c']);
  assert.deepStrictEqual(ids(P, 't'), ['a', 'd']);
  assert.strictEqual(P.state.archive.length, 2);
  P.undo(); assert.deepStrictEqual(ids(P, 't'), ['a', 'b', 'c', 'd']);
  P.delTasks(['a', 'd']);
  assert.deepStrictEqual(ids(P, 't'), ['b', 'c']);
  P.undo(); assert.deepStrictEqual(ids(P, 't'), ['a', 'b', 'c', 'd']);
});

test('dragging several tasks in the sidebar: they land together in sidebar order, adjacent links kept', () => {
  const P = load(plan([TH('t', [T('a'), T('b', null, { link: 'sameDay' }), T('c'), T('d')]), TH('u', [T('x'), T('y')])]));
  P.moveManyTo(['d', 'x', 'b'], false, { tid: 'u', refId: 'y', side: 'before' });   // b brings its chain (a)
  assert.deepStrictEqual(ids(P, 't'), ['c']);
  assert.deepStrictEqual(ids(P, 'u'), ['a', 'b', 'd', 'x', 'y']);
  assert.deepStrictEqual(links(P, 'u'), [null, 'sameDay', null, null, null]);
  P.moveManyTo(['b', 'x'], true, { tid: 't', refId: null });                       // Option: just those two
  assert.deepStrictEqual(ids(P, 't'), ['c', 'b', 'x']);
  assert.deepStrictEqual(ids(P, 'u'), ['a', 'd', 'y']);
  assert.deepStrictEqual(links(P, 't'), [null, null, null]);
});

test('marking a task failed: its date becomes a failed attempt, it is unscheduled, links to others are cut', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-03', { link: 'nextDay', plan: { date: '2026-11-03', start: 600, dur: 90 } }),
    T('c', '2026-11-04', { link: 'nextDay' }), T('d', '2026-11-06', { done: true }), T('e', '2026-11-09')], { threads: [TH('s', [T('x', '2026-11-10')], { after: 'c' })] })]));
  const r = P.failTasks(['b']);
  const b = P.findTask('b').task;
  assert.strictEqual(b.date, null);
  assert.deepStrictEqual(j(b.fails.map(f => [f.date, f.start, f.dur])), [['2026-11-03', 600, 90]]);
  assert.ok(!b.plan);
  assert.deepStrictEqual(links(P, 't'), [null, null, null, null, null]);
  assert.deepStrictEqual(dates(P, 'a', 'c'), { a: '2026-11-02', c: '2026-11-04' });   // neighbours keep their dates
  assert.strictEqual(P.attemptNo(b), 2);
  // later tasks: not-done, scheduled, after it in the thread (a sub-thread after it too)
  assert.deepStrictEqual(j(r.later), ['c', 'x', 'e']);
  assert.deepStrictEqual(j(r.laterDone), ['d']);
  assert.deepStrictEqual(j(r.relink), [['c', 'nextDay', 'b']]);
  assert.strictEqual(P.dayFails('2026-11-03').length, 1);
  P.unscheduleLater(r.later, r.relink);
  assert.deepStrictEqual(dates(P, 'a', 'c', 'd', 'e', 'x'), { a: '2026-11-02', c: null, d: '2026-11-06', e: null, x: null });
  assert.deepStrictEqual(links(P, 't'), [null, null, 'nextDay', null, null]);   // b → c restored (both undated)
  // rescheduling keeps the failed attempt where it was
  P.moveTask('b', '2026-11-12');
  assert.strictEqual(P.findTask('b').task.date, '2026-11-12');
  assert.strictEqual(P.dayFails('2026-11-03')[0].k.id, 'b');
});

test('failing several tasks: links among them stay, later = after the last one; undated tasks are skipped', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02', { done: true }), T('b', '2026-11-03', { link: 'nextDay', done: true }), T('c', '2026-11-05'), T('n'), T('d', '2026-11-08')])]));
  const r = P.failTasks(['b', 'a', 'n']);
  assert.deepStrictEqual(j(r.failed), ['a', 'b']);
  assert.deepStrictEqual(j(r.later), ['c', 'd']);
  assert.deepStrictEqual(links(P, 't'), [null, 'nextDay', null, null, null]);
  assert.deepStrictEqual(dates(P, 'a', 'b'), { a: null, b: null });
  assert.ok(!P.findTask('a').task.done && !P.findTask('b').task.done);
  assert.ok(!P.findTask('n').task.fails);
  P.moveTask('a', '2026-11-16');                         // the failed chain is rescheduled as one
  assert.deepStrictEqual(dates(P, 'a', 'b'), { a: '2026-11-16', b: '2026-11-17' });
  assert.strictEqual(P.failTasks(['n']), null);
});

test('failed attempts: removing one, unordered threads ask nothing, migrate drops bad ones, undo', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-03')])]));
  P.run(`state.projects[0].threads[0].unordered = true; touch();`);
  const r = P.failTasks(['a']);
  assert.deepStrictEqual(j(r.later), []);
  P.moveTask('a', '2026-11-04'); P.failTasks(['a']);
  const fs = P.findTask('a').task.fails;
  assert.deepStrictEqual(j(fs.map(f => f.date)), ['2026-11-02', '2026-11-04']);
  P.removeFail(fs[0].id);
  assert.deepStrictEqual(j(P.findTask('a').task.fails.map(f => f.date)), ['2026-11-04']);
  P.undo();
  assert.strictEqual(P.findTask('a').task.fails.length, 2);
  const M = load(plan([TH('t', [{ ...T('a'), fails: [{ date: 'bad' }, { id: 'f1', date: '2026-11-02', start: 'x' }] }, { ...T('b'), fails: [] }])]));
  assert.deepStrictEqual(j(M.findTask('a').task.fails), [{ id: 'f1', date: '2026-11-02' }]);
  assert.ok(!('fails' in M.findTask('b').task));
});

// a day's list as [kind, id]: kind 'fail' for a failed attempt, else 'task'
const dayList = (P, d) => j(P.dayItems(d).map(it => [it.fl ? 'fail' : 'task', it.k.id]));
// prep 1, prep 2 and submit on Monday, review on Wednesday, all done; the review shows step 2 went wrong
const SEQ = () => [T('s1', '2026-11-02', { done: true }), T('s2', '2026-11-02', { done: true }), T('sub', '2026-11-02', { done: true }), T('rev', '2026-11-04', { done: true }), T('rep', '2026-11-04')];
const MON = '2026-11-02', WED = '2026-11-04', FRI = '2026-11-06';

test('a day keeps a thread in order, with a failed attempt above the retries it led to', () => {
  // rep: a later step nobody has tried yet, also on Wednesday - it stays after the retries
  const want = P => {
    assert.deepStrictEqual(dayList(P, MON), [['task', 's1'], ['fail', 's2'], ['fail', 'sub']]);
    assert.deepStrictEqual(dayList(P, WED), [['fail', 'rev'], ['task', 's2'], ['task', 'sub'], ['task', 'rep']]);
    assert.deepStrictEqual(dayList(P, FRI), [['task', 'rev']]);
  };
  // whichever order it's done in: fail everything, then reschedule ...
  let P = load(plan([TH('t', SEQ())]));
  P.failTasks(['s2', 'sub', 'rev']);
  P.moveTask('s2', WED); P.moveTask('sub', WED); P.moveTask('rev', FRI);
  want(P);
  // ... or reschedule step 2 and submit before marking the review failed
  P = load(plan([TH('t', SEQ())]));
  P.failTasks(['s2', 'sub']);
  P.moveTask('s2', WED); P.moveTask('sub', WED);
  P.failTasks(['rev']); P.moveTask('rev', FRI);
  want(P);
  // a retry that fails again is a second attempt: it stays with the other retries, in thread order
  P.failTasks(['sub']);
  assert.deepStrictEqual(dayList(P, WED), [['fail', 'rev'], ['task', 's2'], ['fail', 'sub'], ['task', 'rep']]);
  // and unmarking it puts the task back in that place
  P.unfailTask('sub');
  assert.deepStrictEqual(dayList(P, WED), [['fail', 'rev'], ['task', 's2'], ['task', 'sub'], ['task', 'rep']]);
});

test('a task retried on the day it failed comes after its failed attempt', () => {
  const P = load(plan([TH('t', [T('a', MON), T('b', MON)])]));
  P.failTasks(['b']); P.moveTask('b', MON);
  assert.deepStrictEqual(dayList(P, MON), [['task', 'a'], ['fail', 'b'], ['task', 'b']]);
  P.failTasks(['a']); P.moveTask('a', MON);   // a: retried too, so after b's first attempt
  assert.deepStrictEqual(dayList(P, MON), [['fail', 'a'], ['fail', 'b'], ['task', 'a'], ['task', 'b']]);
});

test('a day keeps threads together: a retry sits under its attempt, before later steps, inside its own thread', () => {
  const P = load(plan([TH('t', [T('a', MON), T('b', MON)]), TH('u', [T('x', MON)])]));
  P.failTasks(['a']); P.moveTask('a', MON);
  assert.deepStrictEqual(dayList(P, MON), [['fail', 'a'], ['task', 'a'], ['task', 'b'], ['task', 'x']]);
});

test('the gap a drag opens is where the day will really list the task (dayDropBefore)', () => {
  const P = load(plan([TH('t', SEQ()), TH('u', [T('z', WED)])]));
  P.failTasks(['s2', 'sub', 'rev']);
  // the review dropped back on the day of its own failed attempt: right below that attempt
  const before = j(P.dayItems(WED).map(it => it.fl ? it.fl.id : it.k.id));
  assert.strictEqual(P.dayDropBefore(WED, ['rev']), before[before.indexOf(P.findTask('rev').task.fails[0].id) + 1]);
  // step 2 + submit dropped on Wednesday: below the review's failed attempt, above rep (a later step, untried)
  const ids = ['s2', 'sub'], nx = P.dayDropBefore(WED, ids);
  P.moveTask('s2', WED); P.moveTask('sub', WED);
  const list = j(P.dayItems(WED).map(it => it.fl ? it.fl.id : it.k.id));
  assert.strictEqual(nx, list[list.indexOf('s2') + ids.length]);
  assert.strictEqual(nx, 'rep');
  P.failTasks(ids);
  assert.strictEqual(P.dayDropBefore(FRI, ids), null);   // nothing after it: the end of the day
});

test('attempts that failed same-day linked stay one group (joined, dayFailRuns)', () => {
  const runs = (P, d) => j(P.dayFailRuns(d).map(g => g.map(it => it.k.id)));
  const chain = () => [T('a', MON), T('b', MON, { link: 'sameDay' }), T('c', MON, { link: 'sameDay' }), T('x', MON)];
  // the whole chain at once: one group, x (not linked) on its own
  let P = load(plan([TH('t', chain())]));
  P.failTasks(['a', 'b', 'c', 'x']);
  assert.deepStrictEqual(runs(P, MON), [['a', 'b', 'c'], ['x']]);
  // part of it: b's link to a was cut, so only b + c group
  P = load(plan([TH('t', chain())]));
  P.failTasks(['b', 'c']);
  assert.deepStrictEqual(runs(P, MON), [['b', 'c']]);
  // the follow-up prompt's "mark failed too" (failLater): still linked when they failed, so still one group
  P = load(plan([TH('t', [T('a', MON, { done: true }), T('b', MON, { link: 'sameDay', done: true })])]));
  const r = P.failTasks(['a']); P.failLater(r.laterDone, r.relink);
  assert.deepStrictEqual(runs(P, MON), [['a', 'b']]);
  // they stay grouped after the chain is rescheduled, and its retries come after them
  P.moveTask('a', WED);
  assert.deepStrictEqual(runs(P, MON), [['a', 'b']]);
  // removing one attempt leaves the other on its own
  P.removeFail(P.findTask('a').task.fails[0].id);
  assert.deepStrictEqual(runs(P, MON), [['b']]);
  // an older (version 4) file didn't record it: inferred from the links still in place
  const L = load(plan([TH('t', [{ ...T('a'), fails: [{ id: 'f1', date: MON }] }, { ...T('b', null, { link: 'sameDay' }), fails: [{ id: 'f2', date: MON }] },
    { ...T('c'), fails: [{ id: 'f3', date: MON }] }])]));
  assert.deepStrictEqual(runs(L, MON), [['a', 'b'], ['c']]);
  assert.strictEqual(L.state.version, 5);
});

test('failing late: the later done tasks can be marked failed too, links among them put back', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02', { done: true }), T('b', '2026-11-03', { link: 'nextDay', done: true }), T('c', '2026-11-04', { link: 'nextDay', done: true }), T('d', '2026-11-09')])]));
  const r = P.failTasks(['a']);
  assert.deepStrictEqual(j(r.laterDone), ['b', 'c']);
  assert.deepStrictEqual(j(r.later), ['d']);
  P.failLater(r.laterDone, r.relink);
  assert.deepStrictEqual(dates(P, 'a', 'b', 'c', 'd'), { a: null, b: null, c: null, d: '2026-11-09' });
  assert.deepStrictEqual(links(P, 't'), [null, 'nextDay', 'nextDay', null]);
  assert.ok(['a', 'b', 'c'].every(id => P.findTask(id).task.fails.length === 1 && !P.findTask(id).task.done));
  P.undo();
  assert.deepStrictEqual(dates(P, 'b', 'c'), { b: '2026-11-03', c: '2026-11-04' });
});

test('unmarking failed puts the task back on that day (slot, done, links), and its chain-mates that failed with it', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-03', { link: 'nextDay', done: true, plan: { date: '2026-11-03', start: 600, dur: 60 } }),
    T('c', '2026-11-03', { link: 'sameDay' }), T('d', '2026-11-04', { link: 'nextDay' })])]));
  P.failTasks(['b', 'c']);
  assert.deepStrictEqual(links(P, 't'), [null, null, 'sameDay', null]);
  P.moveTask('b', '2026-11-10');                         // rescheduled since: unmarking moves it back
  P.unfailTask('c');
  const b = P.findTask('b').task;
  assert.deepStrictEqual(dates(P, 'a', 'b', 'c', 'd'), { a: '2026-11-02', b: '2026-11-03', c: '2026-11-03', d: '2026-11-04' });
  assert.ok(b.done && !b.fails && !P.findTask('c').task.fails);
  assert.deepStrictEqual(j(P.planOf(b)), { date: '2026-11-03', start: 600, dur: 60 });
  assert.deepStrictEqual(links(P, 't'), [null, 'nextDay', 'sameDay', 'nextDay']);
  // a neighbour that has moved on doesn't get linked back
  const Q = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-03', { link: 'nextDay' })])]));
  Q.failTasks(['b']); Q.moveTask('a', '2026-11-05'); Q.unfailTask('b');
  assert.deepStrictEqual(links(Q, 't'), [null, null]);
  assert.deepStrictEqual(dates(Q, 'a', 'b'), { a: '2026-11-05', b: '2026-11-03' });
});

test('"Keep day-view times": a rescheduled task (and the later ones it shifts) keeps its slot; a failed one takes its attempt\'s', () => {
  const pl = (d, start) => ({ plan: { date: d, start, dur: 60 } });
  const mk = prefs => load(plan([TH('t', [T('a', '2026-11-02', pl('2026-11-02', 540)), T('b', '2026-11-03', pl('2026-11-03', 600)), T('c', '2026-11-04')])]), { prefs });
  let P = mk({});
  P.moveTask('a', '2026-11-05');
  assert.strictEqual(P.planOf(P.findTask('a').task), null);                  // off: the slot stays behind (dormant)
  P = mk({ keepTimes: true });
  P.moveTask('a', '2026-11-05');                                            // b shifts along (+3)
  assert.deepStrictEqual(j(P.planOf(P.findTask('a').task)), { date: '2026-11-05', start: 540, dur: 60 });
  assert.deepStrictEqual(j(P.planOf(P.findTask('b').task)), { date: '2026-11-06', start: 600, dur: 60 });
  assert.strictEqual(P.planOf(P.findTask('c').task), null);
  P.failTasks(['b']); P.moveTask('b', '2026-11-12');
  assert.deepStrictEqual(j(P.planOf(P.findTask('b').task)), { date: '2026-11-12', start: 600, dur: 60 });
  P.moveTask('a', null); P.moveTask('a', '2026-11-20');                     // unscheduled and back: its last slot
  assert.deepStrictEqual(j(P.planOf(P.findTask('a').task)), { date: '2026-11-20', start: 540, dur: 60 });
});
