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
      await page.click('.views [data-view="c"]');
      assert.deepStrictEqual(await page.evaluate(() => [ui.dayView, admOpen]), [null, false]);
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
    await check('↑ / ↓ step like ← / →, and Ctrl+Shift+, opens Settings', async () => {
      const v0 = await page.evaluate(() => ui.viewStart);
      await page.keyboard.press('ArrowDown'); await sleep(400);
      assert.strictEqual(await page.evaluate(() => ui.viewStart), await page.evaluate(v => addDays(v, 7), v0));
      await page.keyboard.press('ArrowUp'); await sleep(400);
      assert.strictEqual(await page.evaluate(() => ui.viewStart), v0);
      await page.keyboard.press('d'); await page.keyboard.press('ArrowDown'); await sleep(450);
      assert.strictEqual(await page.evaluate(() => ui.dayView), '2026-10-29');
      await page.keyboard.press('ArrowUp'); await sleep(450); await page.keyboard.press('c');
      await page.keyboard.press('Control+Shift+Comma'); assert.ok(await page.locator('#modal .srow').count() > 5); await page.click('#sClose');
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
