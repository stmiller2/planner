// Moving tasks in time: linked chains, "Shift later tasks", Option-drop, unscheduling.
const test = require('node:test'), assert = require('node:assert');
const { load, T, TH, plan, dates } = require('./load');

// a thread: a1 –(same day)– a2 –(next day)– a3, then b1 (alone), then c1 (done) –(next day)– c2 (done), then d1 unscheduled
const writing = () => plan([TH('t', [
  T('a1', '2026-11-02'), T('a2', '2026-11-02', { link: 'sameDay' }), T('a3', '2026-11-03', { link: 'nextDay' }),
  T('b1', '2026-11-05'),
  T('c1', '2026-11-06', { done: true }), T('c2', '2026-11-07', { done: true, link: 'nextDay' }),
  T('d1'),
])]);

test('moving a task moves its whole linked chain, keeping the spacing', () => {
  const P = load(writing(), { prefs: { shiftLater: false } });
  P.moveTask('a2', '2026-11-04');
  assert.deepStrictEqual(dates(P, 'a1', 'a2', 'a3', 'b1'), { a1: '2026-11-04', a2: '2026-11-04', a3: '2026-11-05', b1: '2026-11-05' });
});

test('"Shift later tasks" moves every later chain by the same amount, but not finished chains or unscheduled tasks', () => {
  const P = load(writing());
  assert.strictEqual(P.ui.shiftLater, true);
  P.moveTask('a1', '2026-11-04');   // +2 days
  assert.deepStrictEqual(dates(P, 'a1', 'a2', 'a3', 'b1', 'c1', 'c2', 'd1'),
    { a1: '2026-11-04', a2: '2026-11-04', a3: '2026-11-05', b1: '2026-11-07', c1: '2026-11-06', c2: '2026-11-07', d1: null });
});

test('moving earlier shifts later tasks earlier too', () => {
  const P = load(writing());
  P.moveTask('a3', '2026-11-02');   // a3 −1 day drags its chain: a1/a2 to Nov 1
  assert.deepStrictEqual(dates(P, 'a1', 'a2', 'a3', 'b1'), { a1: '2026-11-01', a2: '2026-11-01', a3: '2026-11-02', b1: '2026-11-04' });
});

test('later sub-threads shift as a whole (with their own sub-threads)', () => {
  const P = load(plan([TH('t', [T('x1', '2026-11-02'), T('x2', '2026-11-03')], {
    threads: [TH('s', [T('s1', '2026-11-04')], { after: 'x1', threads: [TH('ss', [T('ss1', '2026-11-05')], { after: null })] })],
  })]));
  P.moveTask('x1', '2026-11-03');
  assert.deepStrictEqual(dates(P, 'x1', 'x2', 's1', 'ss1'), { x1: '2026-11-03', x2: '2026-11-04', s1: '2026-11-05', ss1: '2026-11-06' });
});

test('Option-drop (split) moves only that task, unlinking it; nothing else moves', () => {
  const P = load(writing());
  P.moveTask('a2', '2026-11-10', true);
  assert.deepStrictEqual(dates(P, 'a1', 'a2', 'a3', 'b1'), { a1: '2026-11-02', a2: '2026-11-10', a3: '2026-11-03', b1: '2026-11-05' });
  assert.strictEqual(P.findTask('a2').task.linkToPrev, null);
  assert.strictEqual(P.findTask('a3').task.linkToPrev, null);   // the rest of the chain keeps its dates
});

test('giving an unscheduled task a date shifts nothing else', () => {
  const P = load(writing());
  P.moveTask('d1', '2026-11-20');
  assert.deepStrictEqual(dates(P, 'a1', 'b1', 'd1'), { a1: '2026-11-02', b1: '2026-11-05', d1: '2026-11-20' });
});

test('unscheduling a task unschedules its whole chain', () => {
  const P = load(writing());
  P.moveTask('a3', null);
  assert.deepStrictEqual(dates(P, 'a1', 'a2', 'a3', 'b1'), { a1: null, a2: null, a3: null, b1: '2026-11-05' });
});

test('a chain always lines up with its first dated task', () => {
  const P = load(plan([TH('t', [T('a'), T('b', '2026-11-10', { link: 'nextDay' }), T('c', '2026-01-01', { link: 'sameDay' })])]));
  assert.deepStrictEqual(dates(P, 'a', 'b', 'c'), { a: '2026-11-09', b: '2026-11-10', c: '2026-11-10' });
});

test('linking a task to the one before puts it on that day (or the next)', () => {
  const P = load(plan([TH('t', [T('a', '2026-11-02'), T('b', '2026-11-09')])]));
  P.setLink('b', 'nextDay');
  assert.strictEqual(P.findTask('b').task.date, '2026-11-03');
  P.setLink('b', 'sameDay');
  assert.strictEqual(P.findTask('b').task.date, '2026-11-02');
  P.setLink('b', '');
  assert.strictEqual(P.findTask('b').task.linkToPrev, null);
});

test('each move is one undo step', () => {
  const P = load(writing());
  P.moveTask('a1', '2026-11-04');
  P.moveTask('b1', '2026-11-20');
  P.undo();
  assert.strictEqual(P.findTask('b1').task.date, '2026-11-07');
  P.undo();
  assert.deepStrictEqual(dates(P, 'a1', 'b1'), { a1: '2026-11-02', b1: '2026-11-05' });
  P.redo();
  assert.deepStrictEqual(dates(P, 'a1', 'b1'), { a1: '2026-11-04', b1: '2026-11-07' });
});
