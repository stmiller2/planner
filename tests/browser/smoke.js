// Browser smoke test: runs the real app (served by serve_planner.py from a temporary copy, with
// tests/fixtures/sample.json as its data) and checks that every view opens and the main interactions work,
// with no errors in the page. Needs Playwright with Chromium (npm install playwright; npx playwright install chromium):
//   node tests/browser/smoke.js            (exit code 0 = all good)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..', '..'), PORT = 47823, URL = `http://localhost:${PORT}/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-smoke-'));
  for (const n of ['Planner.html', 'serve_planner.py', 'manifest.webmanifest', 'icon-192.png', 'css', 'js']) fs.cpSync(path.join(ROOT, n), path.join(dir, n), { recursive: true });
  // the server runs with HOME = the temporary folder, so its data folder is <tmp>/PlannerData (and Settings can move it)
  const DATA = path.join(dir, 'PlannerData', 'planner.json');
  fs.mkdirSync(path.dirname(DATA)); fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'sample.json'), DATA);
  const server = spawn('python3', ['serve_planner.py'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, HOME: dir, USERPROFILE: dir } });
  const browser = await chromium.launch();
  const errors = [], results = [];
  const check = async (name, fn) => { try { await fn(); results.push('ok   ' + name); } catch (e) { results.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); } };
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(URL + 'api/data'); break; } catch (e) { await sleep(100); } }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/412/.test(m.text())) errors.push(m.text()); });
    await page.clock.install({ time: new Date('2026-10-28T12:00:00') });
    await page.goto(URL);
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(state)));
    const task = id => page.evaluate(id => { const f = findTask(id); return f && { ...f.task, thread: f.t.id }; }, id);

    await check('loads the data and shows the calendar', async () => {
      await page.waitForFunction(() => document.querySelector('#status').textContent === 'Saved');
      assert.strictEqual(await page.locator('#grid .day').count(), 21);
      assert.ok(await page.locator('#grid .chip').count() > 10);
      assert.ok(await page.locator('#tree .task').count() > 10);
    });
    await check('ticking a task off saves planner.json', async () => {
      await page.click('.chip[data-id="a3"] input[type=checkbox]');
      await sleep(800);
      const saved = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      assert.strictEqual(saved.projects[0].threads[0].tasks.find(k => k.id === 'a3').done, true);
    });
    await check('dragging a chip to another day moves it (and later tasks)', async () => {
      const before = await task('a6');
      const s = await page.locator('.chip[data-id="a6"]').boundingBox(), d = await page.locator('#grid .day[data-date="2026-11-10"]').boundingBox();
      await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x + (d.x + 20 - s.x) * i / 10, s.y + (d.y + 30 - s.y) * i / 10); await sleep(20); }
      await page.mouse.up(); await sleep(300);
      assert.strictEqual(before.date, '2026-11-02');
      assert.strictEqual((await task('a6')).date, '2026-11-10');
    });
    await check('undo', async () => { await page.keyboard.press('Control+z'); assert.strictEqual((await task('a6')).date, '2026-11-02'); });
    await check('sidebar: dragging inside linked chains (reorder a same-day group, join one, split a next-day link)', async () => {
      const order = () => page.evaluate(() => findThread('t1').t.tasks.map(k => [k.id, k.linkToPrev]));
      const dragRow = async (id, onto, half) => {
        const s = await page.locator(`.task[data-id="${id}"] .title`).boundingBox(), d = await page.locator(`.task[data-id="${onto}"]`).boundingBox();
        const y = d.y + (half === 'top' ? d.height * .25 : d.height * .75);
        await page.mouse.move(s.x + 10, s.y + s.height / 2); await page.mouse.down();
        for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x + 10 + (d.x + 40 - s.x - 10) * i / 10, s.y + s.height / 2 + (y - s.y - s.height / 2) * i / 10); await sleep(20); }
        await page.mouse.up(); await sleep(300);
      };
      const was = await order();   // a3 = a4 +1d a5
      await dragRow('a4', 'a3', 'top');
      assert.deepStrictEqual((await order()).slice(2, 5), [['a4', null], ['a3', 'sameDay'], ['a5', 'nextDay']]);
      await page.keyboard.press('Control+z'); assert.deepStrictEqual(await order(), was);
      await dragRow('a7', 'a3', 'bottom');   // between a3 and a4 (same day): joins them, on their day
      assert.deepStrictEqual((await order()).slice(2, 6), [['a3', null], ['a7', 'sameDay'], ['a4', 'sameDay'], ['a5', 'nextDay']]);
      assert.strictEqual((await task('a7')).date, '2026-10-28');
      await page.keyboard.press('Control+z'); assert.deepStrictEqual(await order(), was);
      await dragRow('a7', 'a5', 'top');      // between a4 and a5 (next day): unlinks them
      assert.deepStrictEqual((await order()).slice(2, 6), [['a3', null], ['a4', 'sameDay'], ['a7', null], ['a5', null]]);
      assert.strictEqual((await task('a5')).date, '2026-10-29');
      await page.keyboard.press('Control+z'); assert.deepStrictEqual(await order(), was);
    });
    await check('typing a date in the sidebar', async () => {
      await page.click('.task[data-id="l2"] .date'); await page.keyboard.type('nov 20'); await page.keyboard.press('Enter');
      assert.strictEqual((await task('l2')).date, '2026-11-20');
    });
    await check('adding tasks in the sidebar', async () => {
      await page.hover('.trow[data-tdrag="t3"]'); await page.click('.trow[data-tdrag="t3"] [data-act="add-task"]');
      await page.keyboard.type('Smoke task'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
      assert.ok((await state()).projects[1].threads[0].tasks.some(k => k.title === 'Smoke task'));
    });
    await check('day view opens with the day\'s tasks and timeline', async () => {
      await page.click('.dn .n[data-date="2026-10-28"]');
      assert.ok(await page.locator('#dayview .dv-item').count() >= 2);
      assert.ok(await page.locator('#dayview .dv-blk').count() >= 1);
      await page.click('.dvcount button[data-n="3"]');
      assert.strictEqual(await page.locator('#dayview .dv-col').count(), 3);
      await page.click('.dvcount button[data-n="1"]');
    });
    await check('typing a time for a block', async () => {
      const b = await page.locator('.dv-blk[data-id="a4"] .tm').boundingBox();
      await page.mouse.click(b.x + 20, b.y + 4); await sleep(100);
      await page.fill('#tpop .tp-s', '1pm'); await page.fill('#tpop .tp-e', '2pm'); await page.keyboard.press('Enter');
      const k = await task('a4'); assert.deepStrictEqual([k.plan.start, k.plan.dur], [780, 60]);
      await page.keyboard.press('Escape');
    });
    await check('sliding to the next day: the day list glides all the way and lands without a jump', async () => {
      for (const days of [1, 3]) {
        await page.evaluate(n => { ui.dayCount = n; openDay('2026-11-05'); }, days);
        for (let i = 0; i < 6; i++) {   // includes short and empty days, where the list used to stall and then snap
          const r = await page.evaluate(() => new Promise(done => {
            const L = document.querySelector('#dayview .dv-list'), next = addDays(ui.dayView, 1);
            const firstTask = () => { const sec = L.querySelector(`.dv-day[data-date="${next}"]`), it = (sec || L).querySelector('.dv-item');
              return it ? Math.round(it.getBoundingClientRect().top - L.getBoundingClientRect().top) : null; };
            const g = glide; let want, before;
            window.glide = (x1, ms, land, list) => { want = list[1]; return g(x1, ms, () => { before = [Math.round(L.scrollTop), firstTask()]; land(); done({ want: Math.round(want), before, after: firstTask() }); }, list); };
            daySlide(1); window.glide = g;
          }));
          assert.ok(Math.abs(r.before[0] - r.want) <= 1, `list stopped at ${r.before[0]} of ${r.want}`);
          if (r.after !== null) assert.ok(Math.abs(r.before[1] - r.after) <= 1, `jumped ${r.before[1]} → ${r.after} on landing`);
        }
      }
      await page.evaluate(() => { ui.dayCount = 1; closeDay(); });
    });
    await check('timeline opens and draws', async () => {
      await page.click('.views [data-view="-"]'); await sleep(300);
      assert.ok(await page.locator('#admire .adm-dot').count() > 3);
      // a dot's list opens after resting on it a second; once one has, the next dot's opens at once
      const dots = page.locator('#admire .adm-dot[data-tip]'), tipped = () => page.evaluate(() => getComputedStyle(admTip).display === 'block' && admTipFor && admTipFor.dataset.tip);
      const specs = await dots.evaluateAll(ds => ds.map(d => d.dataset.tip)), j = specs.findIndex(t => t !== specs[0]);
      assert.ok(j > 0);
      await dots.nth(0).hover(); await sleep(500); assert.strictEqual(await tipped(), false);
      await sleep(800); assert.strictEqual(await tipped(), specs[0]);
      await dots.nth(j).hover(); await sleep(150); assert.strictEqual(await tipped(), specs[j]);
      await page.mouse.move(5, 5); await page.mouse.down(); await page.mouse.up();   // a press: back to waiting
      await dots.nth(0).hover(); await sleep(500); assert.strictEqual(await tipped(), false);
      await page.mouse.move(5, 5);
      await page.click('.views [data-view="c"]');
      assert.deepStrictEqual(await page.evaluate(() => [ui.dayView, admOpen]), [null, false]);
    });
    await check('timeline: resting on "+N finished tasks without a date" lists them', async () => {
      await page.evaluate(() => mutate(() => { findTask('a1').task.date = null; }));
      await page.click('.views [data-view="-"]'); await sleep(300);
      const foot = page.locator('#admire .adm-foot [data-tip="undated"]');
      assert.match(await foot.textContent(), /^\+\d+ finished tasks? without a date$/);
      await foot.hover(); await sleep(1300);
      assert.strictEqual(await page.evaluate(() => getComputedStyle(admTip).display), 'block');
      const txt = await page.locator('#admtip').textContent();
      assert.ok(/Without a date/.test(txt) && txt.includes((await task('a1')).title) && /Writing/.test(txt), txt);
      await page.mouse.move(5, 5); await sleep(300);
      await page.click('.views [data-view="c"]');
      await page.keyboard.press('Control+z'); assert.strictEqual((await task('a1')).date, '2026-10-26');
    });
    await check('archive window', async () => {
      await page.click('#archBtn');
      assert.ok(await page.locator('#modal .ar').count() >= 3);
      await page.click('[data-arch="close"]');
    });
    await check('settings window and theme', async () => {
      await page.click('#setBtn'); assert.ok(await page.locator('#modal .srow').count() > 5); await page.click('#sClose');
      await page.click('#themeBtn'); await page.click('#themeBtn');
      assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    });
    await check('keyboard: D / - / C switch between day view, timeline and calendar', async () => {
      const view = () => page.evaluate(() => [ui.dayView, admOpen]);
      await page.keyboard.press('d'); assert.deepStrictEqual(await view(), ['2026-10-28', false]);
      await page.keyboard.press('-'); assert.deepStrictEqual(await view(), ['2026-10-28', true]);
      await page.keyboard.press('c'); assert.deepStrictEqual(await view(), [null, false]);
      await page.keyboard.press('-'); await page.keyboard.press('d'); assert.deepStrictEqual(await view(), ['2026-10-28', false]);
      await page.keyboard.press('c');
    });
    await check('view switcher: icons switch views and show which one is open', async () => {
      const on = () => page.evaluate(() => $$('.views .on').map(b => b.dataset.view));
      assert.deepStrictEqual(await on(), ['c']);
      await page.click('.views [data-view="d"]'); assert.strictEqual(await page.evaluate(() => ui.dayView), '2026-10-28'); assert.deepStrictEqual(await on(), ['d']);
      assert.strictEqual(await page.textContent('#range'), 'Wed, Oct 28');
      await page.click('.views [data-view="-"]'); assert.deepStrictEqual(await on(), ['-']);
      await page.click('.views [data-view="d"]'); assert.deepStrictEqual(await page.evaluate(() => [ui.dayView, admOpen]), ['2026-10-28', false]);
      await page.click('.views [data-view="c"]'); assert.deepStrictEqual(await on(), ['c']);
    });
    await check('‹ › and arrow keys slide the calendar a week and day view a day', async () => {
      const v0 = await page.evaluate(() => ui.viewStart);
      await page.click('#next'); assert.ok(await page.evaluate(() => !!weekAnim), 'calendar should be sliding');
      await sleep(400); assert.strictEqual(await page.evaluate(() => ui.viewStart), await page.evaluate(v => addDays(v, 7), v0));
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await sleep(400);   // a step mid-slide lands the first one
      assert.strictEqual(await page.evaluate(() => ui.viewStart), await page.evaluate(v => addDays(v, -7), v0));
      await page.click('#todayBtn'); await sleep(400); assert.strictEqual(await page.evaluate(() => ui.viewStart), v0);
      await page.keyboard.press('d');
      await page.click('#next'); assert.ok(await page.evaluate(() => !!dayAnim), 'day view should be sliding');
      assert.strictEqual(await page.textContent('#range'), 'Thu, Oct 29');
      await sleep(450); assert.strictEqual(await page.evaluate(() => ui.dayView), '2026-10-29');
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await sleep(450);
      assert.strictEqual(await page.evaluate(() => ui.dayView), '2026-10-31');
      await page.keyboard.press('ArrowLeft'); await sleep(450);
      await page.keyboard.press('t'); await sleep(450); assert.strictEqual(await page.evaluate(() => ui.dayView), '2026-10-28');
      await page.keyboard.press('c');
    });
    await check('header: view switcher and ‹ sit the same distance either side of the sidebar edge', async () => {
      const r = await page.evaluate(() => [$('.views').getBoundingClientRect().right, $('#prev').getBoundingClientRect().left, $('aside').getBoundingClientRect().right]);
      assert.ok(Math.abs((r[2] - r[0]) - (r[1] - r[2])) <= 2, JSON.stringify(r));
    });
    await check('resting on either chip of a next-day link draws a line between them', async () => {
      const k = await page.evaluate(() => { const c = $('#grid .chip[data-links]'); return c && c.dataset.links.split(' ')[0]; });
      assert.ok(k, 'no next-day-linked chip in view');
      const pair = await page.evaluate(id => { const f = findTask(id), t = f.t, i = f.i; return t.tasks[i].linkToPrev === 'nextDay' ? [t.tasks[i - 1].id, id] : [id, t.tasks[i + 1].id]; }, k);
      const labels = await page.evaluate(p => p.map(id => $(`#grid .chip[data-id="${id}"] .nd`).textContent), pair);
      assert.ok(/later/.test(labels[0]) && /prior/.test(labels[1]), labels.join(' / '));
      for (const [from, to] of [pair, [...pair].reverse()]) {
        await page.locator(`#grid .chip[data-id="${from}"] .tt`).hover(); await sleep(400);
        assert.ok(!(await page.evaluate(() => $('#linkline').classList.contains('on'))), 'too early');
        await sleep(1700);
        const r = await page.evaluate(() => [$('#linkline').classList.contains('on'), $$('#linkline .ln').map(p => p.getAttribute('d')), $$('#grid .chip.linkfrom').map(x => x.dataset.id)]);
        assert.ok(r[0] && r[1].length && /^M.+L/.test(r[1][0]), 'line not drawn'); assert.ok(r[2].includes(to), `${to} not marked`);
        await page.mouse.move(5, 5); await sleep(50);
        assert.ok(!(await page.evaluate(() => $('#linkline').classList.contains('on'))), 'line should hide');
      }
    });
    await check('H and S open Help and Settings', async () => {
      await page.keyboard.press('h'); assert.ok(/How it works/.test(await page.textContent('#modal .mhead'))); await page.click('#modal .mx');
      await page.keyboard.press('s'); assert.ok(await page.locator('#modal .srow').count() > 5); await page.click('#sClose');
    });
    await check('↑ / ↓ step like ← / →', async () => {
      const v0 = await page.evaluate(() => ui.viewStart);
      await page.keyboard.press('ArrowDown'); await sleep(400);
      assert.strictEqual(await page.evaluate(() => ui.viewStart), await page.evaluate(v => addDays(v, 7), v0));
      await page.keyboard.press('ArrowUp'); await sleep(400);
      assert.strictEqual(await page.evaluate(() => ui.viewStart), v0);
      await page.keyboard.press('d'); await page.keyboard.press('ArrowDown'); await sleep(450);
      assert.strictEqual(await page.evaluate(() => ui.dayView), '2026-10-29');
      await page.keyboard.press('ArrowUp'); await sleep(450); await page.keyboard.press('c');
    });
    await check('a shortcut pressed in Help or Settings closes it and runs', async () => {
      await page.keyboard.press('h'); await page.keyboard.press('d');
      assert.ok(!(await page.isVisible('#modal'))); assert.strictEqual(await page.evaluate(() => ui.dayView), '2026-10-28');
      await page.keyboard.press('s'); await page.keyboard.press('h');
      assert.ok(/How it works/.test(await page.textContent('#modal .mhead')));
      await page.keyboard.press('h'); assert.ok(!(await page.isVisible('#modal')), 'H in Help closes it');
      await page.keyboard.press('c');
    });
    await check('collapsed completed tasks: the "+ N completed" line\'s number column lines up with the task rows\'', async () => {
      const x = await page.evaluate(() => {
        const t = state.projects[0].threads[0], k = t.tasks, keep = JSON.stringify(k), cd = ui.collapseDone;
        k[0].done = k[1].done = true; k[1].linkToPrev = k[2].linkToPrev = 'nextDay'; k[2].done = false; ui.collapseDone = true; render();
        const dr = $('#tree .drun'), out = [dr.className, dr.querySelector('.drn').getBoundingClientRect().left, $(`.task[data-id="${k[2].id}"] .num`).getBoundingClientRect().left];
        t.tasks = JSON.parse(keep); ui.collapseDone = cd; render();
        return out;
      });
      assert.ok(/\bd-n\b/.test(x[0]), x[0]); assert.strictEqual(x[1], x[2]);
    });
    await check('scratch board: off for a new install (remember open / closed on, if turned on)', async () => {
      assert.deepStrictEqual(await page.evaluate(() => [ui.scratchOn, ui.scratchRemember, ui.scratchCal, ui.scratchDay]), [false, true, false, true]);
      assert.ok(!(await page.isVisible('#scratch')));
      await page.keyboard.press('x'); assert.ok(!(await page.isVisible('#scratch')), 'X does nothing while off');
      // on, and per view, for the checks below
      await page.keyboard.press('s'); await page.click('#modal input[data-set="scratchOn"] + .track');
      await page.click('#modal input[data-set="scratchRemember"] + .track'); await page.click('#sClose');
      assert.ok(await page.isVisible('#scratch .sc-tab'));
    });
    await check('scratch board (per view): closed in calendar view, open in day view; X opens / closes it', async () => {
      const open = () => page.isVisible('#scratch .sc-head');
      assert.ok(!(await open()) && await page.isVisible('#scratch .sc-tab'), 'closed in calendar view');
      const g0 = (await page.locator('main').boundingBox()).width;
      await page.keyboard.press('x'); await sleep(100);
      assert.ok(await open()); assert.strictEqual(await page.textContent('#scratch .sc-head h2'), 'Scratch board');
      assert.ok((await page.locator('main').boundingBox()).width < g0, 'calendar makes room');
      await page.keyboard.press('s'); await page.keyboard.press('x'); assert.ok(!(await page.isVisible('#modal'))); assert.ok(!(await open()));
      await page.keyboard.press('d'); assert.ok(await open(), 'open in day view');
      await page.keyboard.press('x'); assert.ok(!(await open()));
      await page.keyboard.press('c'); assert.ok(!(await open()));
      // Settings: open in calendar view too (takes effect right away in the view you're in)
      await page.keyboard.press('s'); await page.click('#modal input[data-set="scratchCal"] + .track'); await page.click('#sClose');
      assert.ok(await open());
      await page.keyboard.press('s'); await page.click('#modal input[data-set="scratchCal"] + .track'); await page.click('#sClose');
      assert.ok(!(await open()));
      // Remember: the per-view switches grey out, and the board stays as you left it across views
      await page.keyboard.press('s'); await page.click('#modal input[data-set="scratchRemember"] + .track');
      assert.ok(await page.evaluate(() => $('#modal .ssub').classList.contains('off') && $('#modal input[data-set="scratchDay"]').disabled));
      await page.click('#sClose');
      await page.keyboard.press('d'); assert.ok(!(await open()), 'stays closed in day view');
      await page.keyboard.press('x'); await page.keyboard.press('c'); assert.ok(await open(), 'stays open in the calendar');
      assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('planner.ui')).scratchOpen), true);
      await page.keyboard.press('s'); await page.click('#modal input[data-set="scratchRemember"] + .track'); await page.click('#sClose');
      assert.ok(!(await open()), 'back to per view: closed in the calendar');
    });
    await check('scratch board turned off in Settings: no panel or tab, X does nothing, the calendar takes the room', async () => {
      const g0 = (await page.locator('main').boundingBox()).width;
      await page.keyboard.press('s'); await page.click('#modal input[data-set="scratchOn"] + .track');
      assert.ok(await page.evaluate(() => $('#modal .sgrp').classList.contains('off') && $('#modal input[data-set="scratchRemember"]').disabled));
      await page.click('#sClose');
      assert.ok(!(await page.isVisible('#scratch')) && !(await page.isVisible('.sc-rz')));
      assert.ok((await page.locator('main').boundingBox()).width > g0, 'no collapsed tab column');
      await page.keyboard.press('x'); assert.ok(!(await page.isVisible('#scratch')));
      await page.keyboard.press('d'); assert.ok(!(await page.isVisible('#scratch')), 'not in day view either');
      await page.keyboard.press('s'); await page.click('#modal input[data-set="scratchOn"] + .track'); await page.click('#sClose');
      assert.ok(await page.isVisible('#scratch .sc-head'), 'back on: open in day view, as set');
      await page.keyboard.press('c'); assert.ok(await page.isVisible('#scratch .sc-tab'));
    });
    await check('day view: scratch board (add, insert, tick, rename, clear done, delete, collapse)', async () => {
      await page.keyboard.press('d');
      const titles = () => page.evaluate(() => (state.scratch || []).map(s => s.title + (s.done ? ' ✓' : '')));
      assert.ok(await page.isVisible('#scratch .sc-head'));
      await page.click('#scratch .sc-add.idle'); await page.keyboard.type('Order tips'); await page.keyboard.press('Enter');
      await page.keyboard.type('Call facilities'); await page.keyboard.press('Enter');
      assert.ok(await page.evaluate(() => document.activeElement.classList.contains('sc-add')), 'box stays open for the next one');
      await page.keyboard.press('Escape');
      assert.deepStrictEqual(await titles(), ['Order tips', 'Call facilities']);
      assert.strictEqual(await page.evaluate(() => ui.dayView), '2026-10-28', 'Esc in the box should not close day view');
      // click the seam between the two rows: a box right there
      const r = await page.locator('#scratch .sc-row').nth(1).boundingBox();
      await page.mouse.move(r.x + 40, r.y + 1); await page.mouse.down(); await page.mouse.up();
      await page.keyboard.type('Between'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
      assert.deepStrictEqual(await titles(), ['Order tips', 'Between', 'Call facilities']);
      await page.click('#scratch .sc-row:nth-child(1) input[type=checkbox]');
      await page.dblclick('#scratch .sc-row:nth-child(3) .title'); await page.keyboard.press('Meta+a'); await page.keyboard.press('Control+a');
      await page.keyboard.type('Call EHS'); await page.keyboard.press('Enter');
      assert.deepStrictEqual(await titles(), ['Order tips ✓', 'Between', 'Call EHS']);
      await page.click('#scratch [data-act="sc-clear"]');
      assert.deepStrictEqual(await titles(), ['Between', 'Call EHS']);
      await page.hover('#scratch .sc-row:nth-child(1)'); await page.click('#scratch .sc-row:nth-child(1) [data-act="sc-del"]');
      assert.deepStrictEqual(await titles(), ['Call EHS']);
      // the 1–5 days buttons line up 16px left of the panel's edge
      const al = await page.evaluate(() => [$('#dvcount').getBoundingClientRect().right, $('#scratch').getBoundingClientRect().left]);
      assert.ok(Math.abs(al[1] - al[0] - 16) <= 2, JSON.stringify(al));
      await page.click('#scratch [data-act="sc-hide"]');
      assert.ok(await page.isVisible('#scratch .sc-tab')); assert.strictEqual(await page.evaluate(() => ui.scw), 0);
      await page.click('#scratch .sc-tab'); assert.ok(await page.evaluate(() => ui.scw > 0));
      await sleep(600);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(DATA, 'utf8')).scratch.map(s => s.title), ['Call EHS']);
      await page.keyboard.press('c');
    });
    await check('task gear menu: notes (shown after resting on a task), delete, and the delete button staying 2 s', async () => {
      await page.keyboard.press('Escape'); await page.keyboard.press('c'); await sleep(300);
      const row = id => `#tree .task[data-id="${id}"]`, visible = sel => page.locator(sel).isVisible();
      assert.strictEqual(await visible(`${row('l3')} [data-act="del-k"]`), false);   // archive / delete live in the menu
      await page.hover(row('l3')); await page.click(`${row('l3')} [data-act="kmenu"]`);
      await page.click('#menu [data-act="k-notes"]');   // opens the hover note beside the task, already editing
      assert.ok(await visible('#ntip .nt-ed')); assert.strictEqual(await page.locator('#modal').isVisible(), false);
      await page.keyboard.type('Freezer B, shelf 3'); await page.keyboard.press('Enter');
      assert.strictEqual((await task('l3')).notes, 'Freezer B, shelf 3');
      assert.ok(await visible(`${row('l3')} .nti`));
      await page.mouse.move(5, 5); await sleep(400); assert.strictEqual(await visible('#ntip'), false);
      await page.hover(`${row('l3')} .title`);
      await sleep(600); assert.strictEqual(await visible('#ntip'), false);
      await sleep(700); assert.ok(await visible('#ntip')); assert.match(await page.locator('#ntip').textContent(), /Freezer B, shelf 3/);
      // the note stays while the pointer moves onto it, and can be edited there (double-click; Enter saves, Shift+Enter is a new line)
      const nb = await page.locator('#ntip .nt-b').boundingBox();
      await page.mouse.move(nb.x + 5, nb.y + nb.height / 2, { steps: 8 }); await sleep(400); assert.ok(await visible('#ntip'));
      await page.dblclick('#ntip .nt-b'); assert.ok(await visible('#ntip .nt-ed'));
      await page.keyboard.press('End'); await page.keyboard.type(', left'); await page.keyboard.press('Enter');
      assert.strictEqual((await task('l3')).notes, 'Freezer B, shelf 3, left');
      assert.ok(await visible('#ntip .nt-b')); assert.match(await page.locator('#ntip').textContent(), /shelf 3, left/);
      await page.dblclick('#ntip .nt-b'); await page.keyboard.type(' (moved)'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('top');
      await page.mouse.click(5, 300);   // a press elsewhere saves and closes
      assert.strictEqual((await task('l3')).notes, 'Freezer B, shelf 3, left (moved)\ntop'); assert.strictEqual(await visible('#ntip'), false);
      await page.hover(`${row('l3')} .title`); await sleep(1200); assert.ok(await visible('#ntip'));
      // web addresses are links (trailing punctuation left out); text around them stays plain and escaped
      await page.evaluate(() => setTaskNotes('l3', 'See https://example.com/a_(b). Or www.example.org, <b>x</b>'));
      await page.mouse.move(5, 5); await page.hover(`${row('l3')} .title`); await sleep(1200);
      assert.deepStrictEqual(await page.$$eval('#ntip .nt-b a', as => as.map(a => [a.getAttribute('href'), a.textContent, a.target])),
        [['https://example.com/a_(b)', 'https://example.com/a_(b)', '_blank'], ['https://www.example.org', 'www.example.org', '_blank']]);
      assert.strictEqual(await page.locator('#ntip .nt-b b').count(), 0);
      await page.mouse.move(5, 5); await sleep(400); assert.strictEqual(await visible('#ntip'), false);
      // once a note has shown, another task's opens at once, for 2 s after the last one went
      await page.evaluate(() => setTaskNotes('l2', 'Second note'));
      await page.hover(`${row('l2')} .title`); await sleep(150); assert.match(await page.locator('#ntip').textContent(), /Second note/);
      await page.mouse.move(5, 5); await sleep(2400);
      await page.hover(`${row('l3')} .title`); await sleep(500); assert.strictEqual(await visible('#ntip'), false);
      await sleep(700); assert.ok(await visible('#ntip'));
      await page.mouse.move(5, 5); await page.evaluate(() => setTaskNotes('l2', '')); await sleep(400);
      await page.hover(row('l4')); await page.click(`${row('l4')} [data-act="kmenu"]`); await page.click('#menu [data-act="del-k"]');
      assert.ok(!(await task('l4')));
      await page.hover(row('l1')); assert.ok(await visible(`${row('l1')} [data-act="del-k"]`));
      assert.strictEqual(await visible(`${row('l1')} [data-act="arch-k"]`), false);   // only the one just used
      await page.click(`${row('l1')} [data-act="del-k"]`); assert.ok(!(await task('l1')));
      await sleep(1500); await page.hover(row('l2')); assert.ok(await visible(`${row('l2')} [data-act="del-k"]`));   // the timer restarted
      await sleep(700); assert.strictEqual(await visible(`${row('l2')} [data-act="del-k"]`), false);
      await page.mouse.move(5, 5); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
      assert.ok(await task('l1')); assert.ok(await task('l4'));
    });
    await check('right-clicking a task (sidebar, calendar, day view) opens its menu at the pointer', async () => {
      await page.keyboard.press('Escape'); await page.keyboard.press('c'); await sleep(300);
      const shown = () => page.evaluate(() => getComputedStyle(document.querySelector('#menu')).display === 'block' && document.querySelector('#menu').textContent);
      await page.click('#grid .chip[data-id="a5"] .tt', { button: 'right' });
      assert.match(await shown(), /notes.*Archive.*Delete/);
      await page.click('#menu [data-act="del-k"]'); assert.ok(!(await task('a5')));
      await page.keyboard.press('Control+z'); assert.ok(await task('a5'));
      await page.click('#tree .task[data-id="a5"] .title', { button: 'right' }); assert.ok(await shown());
      await page.keyboard.press('Escape'); assert.strictEqual(await shown(), false);
      // Add notes from a chip's menu: the note opens beside that chip, editing; Esc on an empty one leaves no notes
      await page.click('#grid .chip[data-id="a5"] .tt', { button: 'right' }); await page.click('#menu [data-act="k-notes"]');
      assert.ok(await page.locator('#ntip .nt-ed').isVisible());
      const [cr, tr] = await page.evaluate(() => [document.querySelector('#grid .chip[data-id="a5"]').getBoundingClientRect(), document.querySelector('#ntip').getBoundingClientRect()].map(r => ({ l: r.left, t: r.top, b: r.bottom })));
      assert.ok(Math.abs(tr.l - cr.l - 10) <= 2 && (Math.abs(tr.t - cr.b - 4) <= 2 || tr.b <= cr.t), JSON.stringify([cr, tr]));
      await page.keyboard.type('x'); await page.keyboard.press('Escape');
      assert.strictEqual((await task('a5')).notes, undefined); assert.strictEqual(await page.locator('#ntip').isVisible(), false);
      // the thread menu stays open while its switch redraws everything
      await page.hover('.trow[data-tdrag="t1"]'); await page.click('.trow[data-tdrag="t1"] [data-act="tmenu"]');
      await page.click('#menu .mtog'); await sleep(200); assert.ok(await shown());
      await page.click('#menu .mtog'); await page.keyboard.press('Escape');
      // a Mac Ctrl-click: the menu opens on the press, then the release sends a plain click, which must do nothing
      const ctrlClick = async sel => {
        const bb = await page.locator(sel).first().boundingBox(), x = bb.x + 30, y = bb.y + 8;
        await page.mouse.move(x, y); await page.keyboard.down('Control'); await page.mouse.down();
        await page.evaluate(([x, y]) => document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, ctrlKey: true })), [x, y]);
        await page.mouse.up(); await page.keyboard.up('Control'); await sleep(400);
      };
      await ctrlClick('#grid .chip[data-id="a5"] .tt');
      assert.ok(await shown(), 'menu stays open after a Ctrl-click on a chip');
      await ctrlClick('#tree .task[data-id="a5"] .title'); assert.ok(await shown(), '… and on a sidebar row');
      await page.click('#range'); assert.strictEqual(await shown(), false);   // the next ordinary click closes it as usual
      await page.keyboard.press('d'); await sleep(400);
      await ctrlClick('#dayview .dv-item');
      assert.ok(await shown(), '… and in day view'); assert.strictEqual(await page.evaluate(() => !!tpop), false, 'no time box');
      await page.keyboard.press('Escape');
      const it = page.locator('#dayview .dv-item').first(), id = await it.getAttribute('data-id');
      await it.click({ button: 'right' }); assert.ok(await shown());
      assert.strictEqual(await page.evaluate(() => dv), null);
      await page.keyboard.press('Escape');
    });
    await check('day view: Ctrl-click (a Mac right-click) never leaves a task stuck to the pointer; a drop that changes nothing leaves no faded block', async () => {
      assert.ok(await page.evaluate(() => !!ui.dayView));   // (Escape closed only the menu)
      const b = page.locator('#dayview .dv-blk').first(), bb = await b.boundingBox();
      await page.mouse.move(bb.x + 30, bb.y + 8); await page.keyboard.down('Control'); await page.mouse.down();
      await page.mouse.move(bb.x + 80, bb.y + 80, { steps: 5 });
      assert.strictEqual(await page.evaluate(() => dv), null);
      assert.strictEqual(await page.locator('.dv-ghost').count(), 0);
      await page.mouse.up(); await page.keyboard.up('Control'); await sleep(300); await page.evaluate(() => { closeMenu(); closeTimePop(false); });   // (on Linux a Ctrl-click is a click: the time box)
      // a drag whose release is lost (e.g. to a context menu) is called off by the next press, putting things back
      await page.mouse.move(bb.x + 30, bb.y + 8); await page.mouse.down(); await page.mouse.move(bb.x + 30, bb.y + 60, { steps: 5 });
      assert.strictEqual(await page.locator('.dv-ghost').count(), 1);
      await page.evaluate(() => document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
      assert.strictEqual(await page.locator('.dv-ghost').count(), 0);
      await page.mouse.up(); await sleep(100);
      assert.strictEqual(await page.evaluate(() => [...document.querySelectorAll('#dayview .dv-blk')].filter(x => x.style.opacity).length), 0);
      // drag a block and put it back where it was: it isn't left faded
      await page.mouse.move(bb.x + 30, bb.y + 8); await page.mouse.down(); await page.mouse.move(bb.x + 30, bb.y + 40, { steps: 4 }); await page.mouse.move(bb.x + 30, bb.y + 8, { steps: 4 }); await page.mouse.up(); await sleep(100);
      assert.strictEqual(await page.evaluate(() => [...document.querySelectorAll('#dayview .dv-blk')].filter(x => x.style.opacity).length), 0);
      await page.keyboard.press('Escape');
    });
    await check('day view: a short block shows its hover note with a checkbox, kept open while the pointer is on it', async () => {
      if (!(await page.evaluate(() => !!ui.dayView))) { await page.keyboard.press('d'); await sleep(400); }
      const id = await page.locator('#dayview .dv-blk').first().getAttribute('data-id');
      await page.evaluate(id => { const f = findTask(id); mutate(() => { delete f.task.notes; f.task.done = false; f.task.plan.dur = Math.max(5, Math.floor(30 / PPM)); }); }, id);   // (under 38 px tall: short)
      const blk = page.locator(`#dayview .dv-blk[data-id="${id}"]`);
      assert.ok(await blk.evaluate(b => b.classList.contains('short')));
      await page.mouse.move(5, 5); const bb = await blk.boundingBox(); await page.mouse.move(bb.x + bb.width - 20, bb.y + bb.height / 2);
      await sleep(1200); assert.ok(await page.locator('#ntip').isVisible());
      assert.strictEqual(await page.locator('#dvtip').isVisible(), false);
      const ck = page.locator(`#ntip input[data-act="done"][data-id="${id}"]`);
      const cb = await ck.boundingBox(); await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 8 }); await page.mouse.down(); await page.mouse.up();
      assert.strictEqual((await task(id)).done, true);
      await sleep(400); assert.ok(await page.locator('#ntip').isVisible()); assert.ok(await ck.isChecked());
      await page.mouse.move(5, 5); await sleep(400); assert.strictEqual(await page.locator('#ntip').isVisible(), false);
      await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Escape');
    });
    await check('day view list: the task gear menu (notes, archive, delete) and the quick delete button after using it', async () => {
      if (!(await page.evaluate(() => !!ui.dayView))) { await page.keyboard.press('d'); await sleep(400); }
      const items = page.locator('#dayview .dv-item'), n = await items.count(); assert.ok(n >= 2);
      const id = await items.nth(0).getAttribute('data-id'), id2 = await items.nth(1).getAttribute('data-id');
      assert.strictEqual(await items.nth(0).locator('[data-act="kmenu"]').isVisible(), false);
      await items.nth(0).hover(); await items.nth(0).locator('[data-act="kmenu"]').click();
      assert.deepStrictEqual(await page.$$eval('#menu button', bs => bs.map(b => b.dataset.act)), ['k-notes', 'k-fail', 'arch-k', 'del-k']);
      assert.strictEqual(await page.evaluate(() => tpop), null);   // (the gear doesn't open the time box)
      await page.click('#menu [data-act="del-k"]'); assert.ok(!(await task(id)));
      const it2 = page.locator(`#dayview .dv-item[data-id="${id2}"]`);
      await it2.hover(); assert.ok(await it2.locator('[data-act="del-k"]').isVisible());
      assert.strictEqual(await it2.locator('[data-act="arch-k"]').isVisible(), false);
      await page.mouse.move(5, 5); await page.keyboard.press('Control+z'); assert.ok(await task(id));
      await page.keyboard.press('Escape');
    });
    await check('selecting several sidebar tasks: ⌘-click, Shift-click range, the bar, Esc', async () => {
      await page.keyboard.press('Escape'); await page.keyboard.press('c'); await sleep(300);
      await page.click('.task[data-id="m3"] .title', { modifiers: ['Meta'] });
      await page.click('.task[data-id="m5"] .title', { modifiers: ['Shift'] });
      assert.deepStrictEqual(await page.$$eval('#tree .task.sel', rs => rs.map(r => r.dataset.id)), ['m3', 'm4', 'm5']);
      assert.ok(await page.locator('#selbar.on').isVisible());
      assert.match(await page.locator('#selbar .sb-n').textContent(), /3 tasks selected/);
      assert.ok(await page.locator('#grid .chip.sel[data-id="m4"]').count() === 1);
      await page.click('.task[data-id="m4"] .title', { modifiers: ['Meta'] });   // ⌘-click again: out
      assert.strictEqual(await page.locator('#tree .task.sel').count(), 2);
      await page.keyboard.press('Escape');
      assert.strictEqual(await page.locator('#tree .task.sel').count(), 0);
      assert.strictEqual(await page.locator('#selbar.on').count(), 0);
    });
    await check('several selected tasks dragged onto a calendar day all get that date (one undo step)', async () => {
      const was = [(await task('a7')).date, (await task('l3')).date];
      for (const id of ['a7', 'l3', 'l4']) await page.click(`.task[data-id="${id}"] .title`, { modifiers: ['Meta'] });
      const s = await page.locator('.task[data-id="l3"] .title').boundingBox(), d = await page.locator('#grid .day[data-date="2026-11-10"]').boundingBox();
      await page.mouse.move(s.x + 10, s.y + s.height / 2); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x + (d.x + 20 - s.x) * i / 10, s.y + (d.y + 30 - s.y) * i / 10); await sleep(20); }
      await page.mouse.up(); await sleep(300);
      for (const id of ['a7', 'l3', 'l4']) assert.strictEqual((await task(id)).date, '2026-11-10', id);
      assert.strictEqual(await page.locator('#tree .task.sel').count(), 3);   // still selected
      await page.keyboard.press('Control+z');
      assert.deepStrictEqual([(await task('a7')).date, (await task('l3')).date], was);
      await page.click('.task[data-id="l3"] .title');   // a plain click on a selected task keeps the selection
      assert.strictEqual(await page.locator('#tree .task.sel').count(), 3);
      await page.click('#prev'); await sleep(400); await page.click('#next'); await sleep(400);   // the header: kept too
      assert.strictEqual(await page.locator('#tree .task.sel').count(), 3);
      const day = await page.locator('#grid .day[data-date="2026-11-13"]').boundingBox();
      await page.mouse.click(day.x + day.width / 2, day.y + day.height - 6);   // clicking away (an empty spot on the calendar) clears it
      assert.strictEqual(await page.locator('#tree .task.sel').count(), 0);
      assert.strictEqual(await page.locator('#tree .task.sel').count(), 0);
    });
    await check('⌘ / Shift-click on calendar chips selects; dragging a selected chip takes the whole selection', async () => {
      await page.click('#grid .chip[data-id="a4"] .tt', { modifiers: ['Meta'] });
      await page.click('#grid .chip[data-id="m2"] .tt', { modifiers: ['Meta'] });
      assert.deepStrictEqual(await page.$$eval('#tree .task.sel', rs => rs.map(r => r.dataset.id)).then(x => x.sort()), ['a4', 'm2']);
      await sleep(100); assert.strictEqual(await page.locator('#grid .selrun .chip[data-id="m2"]').count(), 1);
      const s = await page.locator('#grid .chip[data-id="m2"] .tt').boundingBox(), d = await page.locator('#grid .day[data-date="2026-11-13"]').boundingBox();
      await page.mouse.move(s.x + 10, s.y + s.height / 2); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x + (d.x + 20 - s.x) * i / 10, s.y + (d.y + 30 - s.y) * i / 10); await sleep(20); }
      await page.mouse.up(); await sleep(300);
      assert.deepStrictEqual([(await task('a4')).date, (await task('m2')).date], ['2026-11-13', '2026-11-13']);
      await page.keyboard.press('Control+z'); await page.keyboard.press('Escape');
    });
    await check('selecting in the sidebar scrolls a chip hidden in its day\'s list into view', async () => {
      await page.setViewportSize({ width: 1440, height: 700 }); await sleep(300);
      const it = page.locator('#grid .day[data-date="2026-11-09"] .items');
      await it.evaluate(x => { x.scrollTop = 0; });
      assert.ok(await it.evaluate(x => x.scrollHeight > x.clientHeight + 20), 'the day overflows');
      await page.click('.task[data-id="m11"] .title', { modifiers: ['Meta'] }); await sleep(500);
      const vis = await page.evaluate(() => { const c = document.querySelector('#grid .chip[data-id="m11"]'), it = c.closest('.items');
        const r = c.getBoundingClientRect(), ir = it.getBoundingClientRect(); return r.top >= ir.top - 1 && r.bottom <= ir.bottom + 1; });
      assert.ok(vis, 'm11 in view');
      await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1440, height: 1600 }); await sleep(300);
    });
    await check('the selection bar: link same day, date typed as "tm", unlink, done', async () => {
      await page.click('.task[data-id="m3"] .title', { modifiers: ['Meta'] });
      await page.click('.task[data-id="m6"] .title', { modifiers: ['Meta'] });
      await page.click('#selbar [data-act="sel-link"][data-v="sameDay"]');
      const ids = await page.evaluate(() => findThread('t2').t.tasks.map(k => k.id + ':' + (k.linkToPrev || '')));
      assert.deepStrictEqual(ids.slice(2, 5), ['m3:', 'm6:sameDay', 'm4:']);
      assert.strictEqual((await task('m6')).date, (await task('m3')).date);
      await page.click('#selbar [data-act="sel-date"]'); await page.keyboard.type('tm'); await page.keyboard.press('Enter');
      assert.deepStrictEqual([(await task('m3')).date, (await task('m6')).date], ['2026-10-29', '2026-10-29']);
      assert.ok(await page.locator('#selbar [data-act="sel-date"]').isVisible());   // the bar is back (not left with a dead date box)
      await page.click('#selbar [data-act="sel-unlink"]');
      assert.strictEqual((await task('m6')).linkToPrev, null);
      await page.click('#selbar [data-act="sel-done"]');
      assert.ok((await task('m3')).done && (await task('m6')).done);
      for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
      assert.strictEqual((await task('m3')).date, '2026-11-06');
      await page.keyboard.press('Escape');
    });
    await check('failed tasks: mark failed (right-click), unschedule later tasks, reschedule by dragging, remove', async () => {
      const d0 = (await task('l2')).date, d1 = await page.evaluate(d => addDays(d, 1), d0);
      const view0 = await page.evaluate(d => { const v = [ui.viewStart, ui.weeks]; if (admOpen) closeAdmire(); if (ui.dayView) closeDay(); clearSel(); ui.viewStart = weekStartOf(addDays(d, -7)); ui.weeks = 3; render(); return v; }, d0);
      await page.click('.chip[data-id="l2"]', { button: 'right' });
      await page.click('#menu [data-act="k-fail"]'); await sleep(200);
      const l2 = await task('l2');
      assert.strictEqual(l2.date, null);
      assert.deepStrictEqual(l2.fails.map(f => f.date), [d0]);
      assert.strictEqual(await page.locator(`#grid .day[data-date="${d0}"] .chip.failed[data-kid="l2"]`).count(), 1);
      assert.ok(await page.locator('#ask.on').isVisible(), 'prompt shown');
      const later = await page.$$eval('#ask .ak-s[data-s="later"] li .nm', ls => ls.map(l => l.textContent));
      assert.deepStrictEqual(later, [(await task('l3')).title, (await task('l4')).title]);
      await page.click('#ask .ak-s[data-s="later"] .ak-b'); await sleep(200);
      assert.strictEqual((await task('l3')).date, null); assert.strictEqual((await task('l4')).date, null);
      assert.ok(await page.locator('#ask.on').isVisible(), 'prompt stays open');
      await page.click('#ask .ak-x'); await sleep(200);
      assert.strictEqual(await page.locator('#ask.on').count(), 0);
      assert.ok(/try 2/.test(await page.textContent('#tree .task[data-id="l2"]')));
      // dragging the failed attempt reschedules the task; the attempt stays
      const s = await page.locator('.chip.failed[data-kid="l2"]').boundingBox(), d = await page.locator(`#grid .day[data-date="${d1}"]`).boundingBox();
      await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x + (d.x + 20 - s.x) * i / 10, s.y + (d.y + 30 - s.y) * i / 10); await sleep(20); }
      await page.mouse.up(); await sleep(300);
      assert.strictEqual((await task('l2')).date, d1);
      assert.strictEqual(await page.locator(`#grid .day[data-date="${d0}"] .chip.failed`).count(), 1);
      assert.ok(/try 2/.test(await page.textContent('.chip[data-id="l2"]')));
      // day view and the Timeline show it; no errors
      await page.evaluate(d => openDay(d), d0); await sleep(200);
      assert.strictEqual(await page.locator('#dayview .dv-item.failed[data-kid="l2"]').count(), 1);
      await page.evaluate(() => closeDay()); await page.keyboard.press('-'); await sleep(400);
      assert.ok(await page.locator('#admire .adm-dot.fail').count() >= 1, 'timeline dot');
      await page.keyboard.press('-'); await sleep(200);
      // right-click the failed attempt: remove it
      await page.click('.chip.failed[data-kid="l2"]', { button: 'right' });
      await page.click('#menu [data-act="fail-rm"]'); await sleep(200);
      assert.ok(!(await task('l2')).fails);
      assert.strictEqual(await page.locator('#grid .chip.failed').count(), 0);
      // several selected: later tasks are the ones after the last of them
      await page.evaluate(d => { moveTask('l3', addDays(d, 2)); moveTask('l4', addDays(d, 3)); }, d0);
      await page.click('#tree .task[data-id="l3"] .title', { modifiers: ['Meta'] });
      await page.click('#tree .task[data-id="l4"] .title', { modifiers: ['Meta'] });
      await page.click('#selbar [data-act="sel-fail"]'); await sleep(200);
      assert.strictEqual((await task('l3')).fails.length, 1); assert.strictEqual((await task('l4')).fails.length, 1);
      assert.ok(!(await page.locator('#ask.on').count()), 'no later tasks after l4: no prompt');
      // right-click a failed attempt: unmark it (back on its day)
      const d4 = (await task('l4')).fails[0].date;
      await page.click('.chip.failed[data-kid="l4"]', { button: 'right' });
      await page.click('#menu [data-act="k-unfail"]'); await sleep(200);
      assert.strictEqual((await task('l4')).date, d4); assert.ok(!(await task('l4')).fails);
      for (let i = 0; i < 8; i++) await page.keyboard.press('Control+z');   // (fail, unschedule, drag, remove, 2 moves, fail 2, unmark)
      assert.strictEqual((await task('l2')).date, d0);
      await page.evaluate(v => { clearSel(); ui.viewStart = v[0]; ui.weeks = v[1]; render(); }, view0);
    });
    await check('dragging opens a gap where the task would land (sidebar, calendar day); dropping on the gap works', async () => {
      const c = async sel => { const r = await page.locator(sel).first().boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r }; };
      const was = await page.evaluate(() => findThread('t2').t.tasks.map(k => k.id));
      let s = await c('.task[data-id="m5"] .title'), t = await c('.task[data-id="m3"]');
      await page.mouse.move(s.x, s.y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x, s.y + (t.r.y + 6 - s.y) * i / 10); await sleep(30); }
      await sleep(250);
      const g = await page.locator('#tree .dgap:not(.closing)').boundingBox(); assert.ok(g && g.height > 20, 'sidebar gap');
      await page.mouse.move(s.x, g.y + g.height / 2); await sleep(100); await page.mouse.up(); await sleep(300);
      const now = await page.evaluate(() => findThread('t2').t.tasks.map(k => k.id));
      assert.strictEqual(now.indexOf('m5'), now.indexOf('m3') - 1, 'dropped on the gap: before m3');
      await page.keyboard.press('Control+z');
      assert.deepStrictEqual(await page.evaluate(() => findThread('t2').t.tasks.map(k => k.id)), was);
      // a chip over another day: a gap in that day's list; dropped on it
      const d0 = (await task('m3')).date, d1 = await page.evaluate(d => addDays(d, -1), d0);
      s = await c('.chip[data-id="m3"] .tt'); t = await c(`#grid .day[data-date="${d1}"]`);
      await page.mouse.move(s.x, s.y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x + (t.x - s.x) * i / 10, s.y + (t.r.y + 40 - s.y) * i / 10); await sleep(30); }
      await sleep(250);
      const cg = await page.locator(`#grid .day[data-date="${d1}"] .dgap:not(.closing)`).boundingBox(); assert.ok(cg, 'calendar gap');
      await page.mouse.move(cg.x + cg.width / 2, cg.y + cg.height / 2); await sleep(100); await page.mouse.up(); await sleep(300);
      assert.strictEqual((await task('m3')).date, d1);
      await page.keyboard.press('Control+z'); assert.strictEqual((await task('m3')).date, d0);
    });
    await check('Help shows where the data is; Settings > Data file moves it to another folder', async () => {
      await page.keyboard.press('h');
      assert.ok((await page.textContent('#modal .mbody')).includes(DATA), 'full path in Help');
      await page.keyboard.press('s');
      const moved = path.join(dir, 'Moved here');
      await page.fill('#modal .dfin', moved); await page.click('#dfGo'); await sleep(400);
      assert.ok(fs.existsSync(path.join(moved, 'planner.json')), 'copied');
      assert.ok((await page.textContent('#modal .mbody')).includes(path.join(moved, 'planner.json')), 'Settings shows the new place');
      await page.click('#sClose');
      await page.click('.chip[data-id="a4"] input[type=checkbox]'); await sleep(800);
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(moved, 'planner.json'), 'utf8')).projects[0].threads[0].tasks.find(k => k.id === 'a4').done, true, 'saves go to the new place');
      // a folder that already has a plan: asks, then opens that one
      const other = path.join(dir, 'Other'); fs.mkdirSync(other);
      fs.writeFileSync(path.join(other, 'planner.json'), JSON.stringify({ version: 4, title: 'Other plan', projects: [] }));
      await page.keyboard.press('s'); await page.fill('#modal .dfin', other); await page.keyboard.press('Enter'); await sleep(300);
      assert.ok(/already has/.test(await page.textContent('#modal .dfmsg')));
      await page.click('#dfOpen'); await sleep(500);
      assert.strictEqual(await page.evaluate(() => state.title), 'Other plan');
      assert.strictEqual(fs.readFileSync(path.join(dir, '.config', 'planner', 'data-folder.txt'), 'utf8').trim(), other);
    });
    await check('no errors in the page', async () => assert.deepStrictEqual(errors, []));
  } finally {
    await browser.close(); server.kill();
  }
  console.log(results.join('\n'));
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})();
