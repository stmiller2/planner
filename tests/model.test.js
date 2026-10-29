// The data model: loading files (old formats too), sub-thread placement, order and conflict warnings, the index.
const test = require('node:test'), assert = require('node:assert');
const { load, T, TH, plan, dates } = require('./load');
const j = x => JSON.parse(JSON.stringify(x));   // sandbox objects -> plain ones, for deepStrictEqual

test('loading upgrades old files: links, sub-thread anchors, colors, bad dates', () => {
  const P = load({ projects: [{ name: 'Old', threads: [
    { name: 'A', tasks: [{ title: 'one', date: '2026-11-02' }, { title: 'two', date: 'soon', sameDayAsPrev: true, doneOn: '2026-01-01' }],
      threads: [{ name: 'sub', tasks: [] }] },
    { name: 'B', color: 'red', tasks: [] },
  ] }], conflicts: [{ title: 'Trip', start: '2026-11-10', end: '2026-11-05' }, 'junk'], archive: [{ kind: 'nonsense', item: {} }] });
  const s = P.state, [A, B] = s.projects[0].threads, [one, two] = A.tasks;
  assert.strictEqual(s.version, 4);
  assert.strictEqual(two.linkToPrev, 'sameDay');
  assert.strictEqual(two.date, '2026-11-02');            // unreadable date, then lined up with its chain
  assert.ok(!('sameDayAsPrev' in two) && !('doneOn' in two));
  assert.strictEqual(A.threads[0].afterTask, two.id);   // old files: sub-threads came after all of the parent's tasks
  assert.strictEqual(A.color, P.PALETTE[0]);            // top-level threads get their own color…
  assert.strictEqual(B.color, P.PALETTE[1]);            // …including ones with an invalid color
  assert.strictEqual(A.threads[0].color, null);         // sub-threads take a shade of their parent's
  assert.deepStrictEqual(j(s.conflicts.map(c => [c.title, c.start, c.end])), [['Trip', '2026-11-10', '2026-11-10']]);
  assert.strictEqual(s.archive.length, 0);
  assert.ok(one.id && A.id && s.projects[0].id);
});

test('a sub-thread can never sit inside a linked chain', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-02', { link: 'sameDay' }), T('c', '2026-11-04')],
    { threads: [TH('s', [], { after: 'a' })] })]));
  assert.strictEqual(P.findThread('s').t.afterTask, 'b');
  assert.deepStrictEqual(j(P.layout(P.findThread('t').t).map(x => x.obj.id)), ['a', 'b', 's', 'c']);
});

test('layout / writeLayout keep tasks and sub-threads interleaved', () => {
  const P = load(plan([TH('t', [T('a'), T('b'), T('c')], { threads: [TH('s0', [], { after: null }), TH('s1', [], { after: 'b' })] })]));
  const t = P.findThread('t').t, L = P.layout(t);
  assert.deepStrictEqual(j(L.map(x => x.obj.id)), ['s0', 'a', 'b', 's1', 'c']);
  L.reverse(); P.writeLayout(t, L);
  assert.deepStrictEqual(j(t.tasks.map(k => k.id)), ['c', 'b', 'a']);
  assert.deepStrictEqual(j(t.threads.map(x => [x.id, x.afterTask])), [['s1', 'c'], ['s0', 'a']]);
});

test('order warnings follow fork / join: parallel sub-threads wait for what is above, and what is below waits for them', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-05'), T('z', '2026-11-08')], {
    threads: [TH('s1', [T('x', '2026-11-04')], { after: 'a' }), TH('s2', [T('y', '2026-11-09')], { after: 'a' })],
  })]));
  const v = j(P.violations().map(w => `${w.task.id}<${w.prev.id}`).sort());
  assert.deepStrictEqual(v, ['x<a', 'z<y']);   // x starts before a is done; z comes before y (in a parallel block) finishes
});

test('conflict warnings: unfinished scheduled tasks on blocked days', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-03'), T('b', '2026-11-04', { done: true }), T('c', '2026-11-06')])],
    { conflicts: [{ id: 'c1', title: 'Trip', start: '2026-11-03', end: '2026-11-05' }, { id: 'c2', title: 'Someday', start: null, end: null }] }));
  assert.deepStrictEqual(j(P.conflictHits().map(h => h.key)), ['a@c1@2026-11-03']);
  const Y = new Date().getFullYear();   // dates in the current year show without one
  assert.strictEqual(P.cfSpan({ start: `${Y}-11-03`, end: `${Y}-11-05` }), 'Nov 3 – Nov 5');
  assert.strictEqual(P.cfSpan({ start: `${Y}-11-03`, end: `${Y}-11-03` }), 'Nov 3');
});

test('a change shows only the warnings it newly causes', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-05'), T('b', '2026-11-06')])], { conflicts: [{ id: 'c', title: 'Trip', start: '2026-11-10', end: '2026-11-12' }] }),
    { prefs: { shiftLater: false } });
  P.moveTask('b', '2026-11-11');
  assert.strictEqual(P.calls.warn.length, 1);
  assert.deepStrictEqual(j(P.calls.warn[0].map(w => w.kind || 'order')), ['cf']);
  P.moveTask('a', '2026-11-20');                        // now out of order (the conflict was already there)
  assert.deepStrictEqual(j(P.calls.warn[1].map(w => w.kind || 'order')), ['order']);
});

test('the index follows every change (lookups, numbering, tasks by day)', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-02')]), TH('u', [T('c', '2026-11-02')])]));
  assert.deepStrictEqual(j(P.dayTasks('2026-11-02').map(x => x.k.id)), ['a', 'b', 'c']);
  P.moveTasksTo('c', false, { tid: 't', refId: 'a', side: 'before' });
  assert.strictEqual(P.findTask('c').t.id, 't');
  assert.strictEqual(P.findTask('a').i, 1);
  assert.deepStrictEqual(j(P.dayTasks('2026-11-02').map(x => x.k.id)), ['c', 'a', 'b']);
  P.undo();
  assert.strictEqual(P.findTask('c').t.id, 'u');
  P.mutate(() => { P.findThread('u').t.name = 'renamed'; });
  assert.deepStrictEqual(j(P.findTask('c').path), ['renamed']);
});

test('a change that changes nothing adds no undo step', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02')])]));
  assert.strictEqual(P.mutate(() => {}), false);
  assert.strictEqual(P.undoStack.length, 0);
  assert.strictEqual(P.mutate(() => { P.findTask('a').task.done = true; }), true);
  assert.strictEqual(P.undoStack.length, 1);
});

test('day-view slots only count on the day they were made for', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02', { plan: { date: '2026-11-02', start: 540, dur: 60 } }), T('b', '2026-11-03', { plan: { date: '2026-11-01', start: 600, dur: 30 } })])]));
  assert.ok(P.planOf(P.findTask('a').task));
  assert.strictEqual(P.planOf(P.findTask('b').task), null);
  P.moveTask('a', '2026-11-04');
  assert.strictEqual(P.planOf(P.findTask('a').task), null);   // dormant until the task comes back
  P.moveTask('a', '2026-11-02');
  assert.ok(P.planOf(P.findTask('a').task));
});

test('colors: sub-threads without their own color take shades of the parent', () => {
  const P = load(plan([TH('t', [], { color: '#2e9e6b', threads: [TH('s1', [], { after: null }), TH('s2', [], { after: null, color: '#123456' })] })]));
  P.computeColors();
  assert.strictEqual(P.colorOf(P.findThread('t').t), '#2e9e6b');
  assert.strictEqual(P.colorOf(P.findThread('s1').t), P.shade('#2e9e6b', 0));
  assert.strictEqual(P.colorOf(P.findThread('s2').t), '#123456');
});

test('loading scratch tasks: kept in order, bad entries dropped; files without them get an empty list', () => {
  const P = load({ projects: [], scratch: [{ id: 's1', title: 'buy tips', done: true }, null, { title: '  ' }, { title: 'email Bob' }, 'x'] });
  const s = JSON.parse(JSON.stringify(P.state.scratch));
  assert.deepStrictEqual(s.map(x => [x.title, x.done]), [['buy tips', true], ['email Bob', false]]);
  assert.strictEqual(s[0].id, 's1'); assert.ok(s[1].id);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(load({ projects: [] }).state.scratch)), []);
});
