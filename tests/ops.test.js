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
