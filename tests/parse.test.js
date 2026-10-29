// Reading typed dates and times, and the saved view preferences.
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./load');

test('typed dates', () => {
  const P = load(), base = '2026-10-28';   // a Wednesday
  const cases = {
    'Nov 26': '2026-11-26', '26 nov': '2026-11-26', '11/26': '2026-11-26', '11/26/27': '2027-11-26', "nov 26 '27": '2027-11-26',
    '2026-02-03': '2026-02-03', 'Thu Nov 26': '2026-11-26', 'november 3rd': '2026-11-03',
    'jan 5': '2027-01-05',               // more than two months ago this year: next year
    'oct 1': '2026-10-01',               // within two months: this year
    'today': base, 'tomorrow': '2026-10-29', 'yesterday': '2026-10-27',
    'fri': '2026-10-30', 'next fri': '2026-11-06', 'wed': base,
    '+3': '2026-10-31', '+2w': '2026-11-11', '-1': '2026-10-27',
    '30': '2026-10-30', '5': '2026-11-05',   // a day number: this month, or next if it has passed
    '2/30': null, 'soon': null, '': '',
  };
  for (const [typed, want] of Object.entries(cases)) assert.strictEqual(P.parseDateText(typed, base), want, typed);
});

test('typed times on a 12-hour clock pick am / pm nearest the current time', () => {
  const P = load(null, { prefs: { clock: '12' } });
  assert.strictEqual(P.parseTime('9', 720), 540);
  assert.strictEqual(P.parseTime('2', 720), 840);
  assert.strictEqual(P.parseTime('2', 300), 120);
  assert.strictEqual(P.parseTime('930', 600), 570);
  assert.strictEqual(P.parseTime('2:15 pm', 0), 855);
  assert.strictEqual(P.parseTime('14:00', 0), 840);
  assert.strictEqual(P.parseTime('noon'), 720);
  assert.strictEqual(P.parseTime('midnight', 0, true), 1440);
  assert.strictEqual(P.parseTime('0', 0, true), 1440);
  assert.strictEqual(P.parseTime(''), null);
  assert.ok(Number.isNaN(P.parseTime('25')));
  assert.ok(Number.isNaN(P.parseTime('9:75')));
  assert.strictEqual(P.fmtTime(870), '2:30pm');
});

test('typed times on a 24-hour clock', () => {
  const P = load(null, { prefs: { clock: '24' } });
  assert.strictEqual(P.parseTime('9', 720), 540);
  assert.strictEqual(P.parseTime('21', 0), 1260);
  assert.strictEqual(P.fmtTime(870), '14:30');
  assert.strictEqual(P.fmtDur(95), '1 h 35 min');
});

test('saved preferences: bad values fall back to defaults; settings reset', () => {
  const P = load(null, { prefs: { weeks3: 7, weekStart: 0, theme: 'purple', snap: 10, confirmDelete: false, sbw: 'wide' } });
  assert.strictEqual(P.ui.weeks, 3);
  assert.strictEqual(P.ui.weekStart, 0);
  assert.strictEqual(P.ui.theme, 'auto');
  assert.strictEqual(P.ui.snap, 10);
  assert.strictEqual(P.ui.confirmDelete, false);
  assert.strictEqual(P.ui.sbw, 330);
  P.ui.weeks = 4; P.ui.sbw = 200; P.saveUI();
  const saved = JSON.parse(P.store['planner.ui']);
  assert.strictEqual(saved.weeks3, 4);
  assert.strictEqual(saved.sbw, 200);
  P.resetSettings();
  assert.strictEqual(P.ui.weeks, 4);   // not a setting (header buttons): kept
  assert.strictEqual(P.ui.snap, 15);
  assert.strictEqual(P.ui.sbw, 200);   // not a setting: kept
});
