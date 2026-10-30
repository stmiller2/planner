'use strict';
/* The Help and Settings windows. Settings are stored in `ui` (core/prefs.js). */
function showHelp() {
  const ui_ = l => `<span class="hui">${l}</span>`;   // a button's label, as it appears in the app
  const body = framedModal('How it works', `
  <h4>Projects, (sub)threads, and tasks</h4>
  <p><b>Tasks</b> (e.g., “purify GoldenGate reaction”) are organized into <b>threads</b> (e.g., “cloning”), which are organized into <b>projects</b> (e.g., “build library”). To get started, create a project with ${ui_('+ Project')} and make a thread with ${ui_('+ thread')}. You can then add tasks to your thread, or create subthreads to any depth with ${ui_('+ sub')}.</p>
  <p>Tasks, threads, projects, and the planner itself can be renamed by double-clicking the title in calendar or day view.</p>
  <h4>Scheduling</h4>
  <p>To schedule a task, drag it onto the calendar, or click the date box and type e.g. “fri”, “11/26”, “+3”. Tasks can also be scheduled relative to one another: click the link icon <span class="hic">${ICON.link}</span> to link two tasks to the <b>same day</b> (e.g., “do transformation” and “plate cells”) or <b>next day</b> (e.g., “start overnights” and “miniprep plasmids”).</p>
  <p>Tasks are expected to be ordered based on their number in the sidebar. If scheduled out of order, a warning will display. This can be turned off in Settings.</p>
  <h4>Rescheduling</h4>
  <p>When rescheduling tasks, linked tasks move too, unless holding <kbd>⌥ Option</kbd> while dropping the task (this breaks links and moves only the dragged task).</p>
  <p>By default, all tasks within a thread get shifted relative to each other when rescheduling. This can be turned off in Settings, or bypassed by holding <kbd>⌥ Option</kbd>.</p>
  <h4>Day view</h4>
  <p>To plan the timing of tasks within a single day, enter day view with the view switcher, pressing <kbd>d</kbd>, or by clicking the date number from calendar view. Drag tasks onto the timeline, then drag or click blocks to set their times. Swipe sideways or use the arrow keys to move between days.</p>
  <h4>Timeline</h4>
  <p>Press <kbd>-</kbd> or use the view switcher to enter timeline view, where you can view everything you’ve finished over time. No functionality here, it just looks nice.</p>
  <h4>Conflicts</h4>
  <p>Add holidays or travel with ${ui_('+ Conflict')} in the <b>Conflicts</b> section of the sidebar. Tasks can still be scheduled over conflicts but will display a warning, which can be turned off in Settings.</p>
  <h4>Scratch board</h4>
  <p>One-off tasks that don’t deserve their own project or scheduling (e.g., “clean tubes”) can be added to the scratch board, on the right of the calendar and day view. These tasks can’t be scheduled; they stay on the board until you delete them. Add them with ${ui_('+ Add task')} (or click between two tasks to add one there), check them off as you go, and remove all finished ones at once with the <span class="hic">${ICON.clearDone}</span> button at the top. Press <kbd>x</kbd> to open or close the board, or drag its edge to resize it. The board is off until you turn it on in Settings; it then stays open or closed the way you left it, or can open and close by itself for calendar and day view.</p>
  <h4>Archive</h4>
  <p>To remove a task, thread, or project from the sidebar without deleting it, it can be archived with the archive icon <span class="hic">${ICON.archive}</span>. Archived tasks still appear in the timeline and calendar.</p>
  <h4>Your data</h4>
  <p>Your plan is saved to ${dataWhereHTML()}${MODE === 'fallback' ? '' : ' as you go, with a dated copy each day in <code>backups/</code> next to it (last 14 days)'}. You can change where in Settings, under <b>Data file</b>.</p>
  <div class="hkeys"><h4>Keyboard shortcuts</h4><div class="keys">${shortcutsHTML()}</div></div>
  <div class="row"><button class="btn primary" id="mClose">Close</button></div>`);
  body.parentElement.classList.add('help'); $('#modal').dataset.kind = 'help';
  $('#mClose').onclick = hideModal;
}

/* ---------- keyboard shortcuts (listed at the end of Help) ---------- */
function shortcutsHTML() {
  return [
    ['<kbd>⌥ Option</kbd> + drop', 'Move only the task you dragged, unlinking from other tasks if applicable'],
    ['<kbd>←</kbd> / <kbd>→</kbd> or <kbd>↑</kbd> / <kbd>↓</kbd>', 'Previous / next week (previous / next day in day view)'],
    ['<kbd>T</kbd>', 'Jump to today'],
    ['<kbd>C</kbd> / <kbd>D</kbd> / <kbd>-</kbd>', 'Switch to the calendar / day view / timeline'],
    ['<kbd>⌘Z</kbd>', 'Undo'],
    ['<kbd>⇧⌘Z</kbd> or <kbd>⌘Y</kbd>', 'Redo'],
    ['<kbd>S</kbd> or <kbd>⌃⇧,</kbd>', 'Open Settings'],
    ['<kbd>H</kbd>', 'Open Help'],
    ['<kbd>1</kbd> – <kbd>5</kbd>', 'Show that many weeks (days in day view)'],
    ['<kbd>X</kbd>', 'Open / close the scratch board (if it’s turned on)'],
    ['<kbd>N</kbd>', 'New task on the scratch board (while it’s open)'],
    ['<kbd>Esc</kbd>', 'Close day view, a menu, or a window'],
    ['<kbd>Enter</kbd> / <kbd>Esc</kbd>', 'In a new-task box: add the task / stop adding'],
    ['Double-click', 'Rename a project, thread, task or the planner'],
  ].map(([k, d]) => `<div class="kd">${k}</div><div>${d}</div>`).join('');
}

/* ---------- settings ---------- */
function showSettings() {
  closeMenu();
  framedModal('Settings', ''); $('#modal').dataset.kind = 'settings';
  const card = $('#modal .card'); card.classList.add('wide', 'set');
  card.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'sClose') return hideModal();
    if (b.id === 'sReset') return applySetting(null);
    if (b.id === 'dfGo') return moveDataFolder('check');
    if (b.id === 'dfOpen') return moveDataFolder('open');
    if (b.id === 'dfCancel') { $('#modal .dfmsg').innerHTML = ''; return; }
    if (b.id === 'dfChoose') return chooseFolder(true);
    if (b.id === 'dfExport') return $('#exportBtn').click();
    const g = b.closest('.seg[data-set]'); if (g) applySetting(g.dataset.set, b.dataset.v);
  };
  card.onchange = e => { const k = e.target.dataset.set; if (k) applySetting(k, e.target.checked); };
  renderSettings();
}
function applySetting(key, v) {
  if (key === null) {                                    // restore defaults
    resetSettings();
    ui.viewStart = weekStartOf(addDays(ui.viewStart, 3));   // mid-week anchor, so the view stays on the same week
  } else if (key === 'weekStart') { ui.weekStart = +v; ui.viewStart = weekStartOf(addDays(ui.viewStart, 3)); }   // mid-week anchor keeps the view on the same week
  else if (key === 'snap' || key === 'dayHours') ui[key] = +v;
  else ui[key] = v;
  // the scratch board in the view you're in follows at once (scratchForView does nothing while remembering)
  if (key === null || key === 'scratchOn' || key === 'scratchRemember' || (key === 'scratchDay') === !!ui.dayView && /^scratch(Cal|Day)$/.test(key)) scratchForView();
  if (!warnings().length) hideWarn();
  saveUI(); render(); renderSettings();
}
function renderSettings() {
  const body = $('#modal .mbody'); if (!body) return;
  const top = body.scrollTop;
  const sw = (key, off) => `<label class="switch"><input type="checkbox" data-set="${key}" ${ui[key] ? 'checked' : ''} ${off ? 'disabled' : ''}><span class="track"></span></label>`;
  const seg = (key, opts) => `<div class="seg" data-set="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(ui[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const row = (title, desc, ctl) => `<div class="srow"><div class="sl"><b>${title}</b><div class="sd">${desc}</div></div>${ctl ? `<div class="sc">${ctl}</div>` : ''}</div>`;
  // little before/after strip: task 2 dragged from Tue to Thu
  const strip = (label, cells, cur) => `<div class="erl ${cur ? 'cur' : ''}">${label}</div>` +
    [0, 1, 2, 3, 4].map(i => `<div class="ec">${cells[i] ? `<div class="ek ${cells[i][1] || ''}">${cells[i][0]}</div>` : ''}</div>`).join('');
  const example = `<div class="ex"><div></div>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => `<div class="eh">${d}</div>`).join('')}
    ${strip('Before', { 0: [1], 1: [2, 'mv'], 2: [3] })}
    ${strip('Shift on', { 0: [1], 3: [2, 'mv'], 4: [3] }, ui.shiftLater)}
    ${strip('Shift off', { 0: [1], 2: ['3 !', 'bad'], 3: [2, 'mv'] }, !ui.shiftLater)}</div>`;
  body.innerHTML = `
    <h4>Scheduling</h4>
    ${row('Shift later tasks', `<p>When you drag a scheduled task to a different day, every scheduled task <i>after</i> it in the same thread moves by the same number of days, so the rest of the thread keeps its spacing. That includes later sub-threads and everything in them.</p>
      <p>Fully completed chains never move. Hold <b>⌥ Option</b> while dropping to just move that task.</p>
      <div>Dragging task 2 from Tue to Thu (+2 days):</div>${example}`, sw('shiftLater'))}
    <h4>Calendar view</h4>
    ${row('Narrow weekends', 'Make the Saturday and Sunday columns narrower, leaving more room for weekdays.', sw('narrowWe'))}
    ${row('Week starts on', 'The first column of the calendar.', seg('weekStart', [[1, 'Monday'], [0, 'Sunday']]))}
    ${row('Sidebar dates', 'How the date button on each task in the sidebar reads.', seg('dateLabels', [['relative', 'Tues, Next Wed'], ['absolute', 'Oct 22']]))}
    ${row('Collapse completed tasks', 'In the sidebar, two or more completed tasks in a row fold into one “+ N completed” line (click it to show them). Threads that are fully completed stay as they are.', sw('collapseDone'))}
    <h4>Day view</h4>
    ${row('Hours in view', 'How many hours of the timeline fit in the window.', seg('dayHours', DAY_HOURS.map(h => [h, h === 24 ? '24 h' : String(h)])))}
    ${row('Time steps', 'Blocks snap to this grid when you place, move or resize them.', seg('snap', [[5, '5'], [10, '10'], [15, '15'], [30, '30 min']]))}
    ${row('Time format', 'Hours and block times.', seg('clock', [['12', '12-hour (2pm)'], ['24', '24-hour (14:00)']]))}
    <h4>Scratch board</h4>
    ${row('Enable scratch board', 'A panel on the right of the calendar and day view for quick one-off tasks that don’t belong to a project and don’t need a date.', sw('scratchOn'))}
    <div class="sgrp ${ui.scratchOn ? '' : 'off'}">
    ${row('Remember open / closed', 'Keep the scratch board open or closed the way you left it, in every view and the next time you open the planner.', sw('scratchRemember', !ui.scratchOn))}
    <div class="ssub ${ui.scratchOn && ui.scratchRemember ? 'off' : ''}">
      <div class="sh">${ui.scratchRemember ? 'Not used while remembering. Otherwise, open' : 'Open'} the scratch board when you go to:</div>
      <div class="sline"><span>Calendar view</span>${sw('scratchCal', !ui.scratchOn || ui.scratchRemember)}</div>
      <div class="sline"><span>Day view</span>${sw('scratchDay', !ui.scratchOn || ui.scratchRemember)}</div>
    </div>
    <p class="sub snote">Either way, you can always open or close it by clicking its » / tab or pressing <kbd>X</kbd>.</p>
    </div>
    <h4>Warnings</h4>
    ${row('Confirm before deleting', 'Ask before deleting a project or thread that still has tasks.', sw('confirmDelete'))}
    ${row('Out-of-order warning', 'Show a warning when a change puts a task before an earlier task in its thread.', sw('orderWarn'))}
    ${row('Conflict warning', 'Show a warning when an uncompleted task lands on the same day as a Conflict.', sw('conflictWarn'))}
    <h4>Data file</h4>
    ${dataFileRows(row)}
    <p class="sub" style="margin-top:18px">Settings are saved in this browser, so Chrome and Safari each keep their own.</p>
    <div class="row"><button class="btn primary" id="sClose">Done</button><button class="btn" id="sReset">Restore defaults</button></div>`;
  body.scrollTop = top;
}

/* ---------- Settings > Data file ---------- */
// where the plan is saved, and how to move it: with the server, type a folder (the server moves the plan there and
// remembers it); with a folder chosen in Chrome, pick another one; in a browser without file access, Export
function dataFileRows(row) {
  if (MODE === 'server') {
    const move = server.fixed
      ? `<p>The server was started with a data folder for that run only (<code>--data</code> or <code>PLANNER_DATA</code>), so it can’t be changed here. Restart it without that, or run <code>serve_planner.py --set-data FOLDER</code>.</p>`
      : `<p>Type a folder’s full path (for example <code>~/Dropbox/PlannerData</code>) to copy your <code>planner.json</code> there and save to that location from now on. The old file is not automatically deleted.</p>
         <div class="dfrow"><input class="dfin" spellcheck="false" placeholder="Folder path"><button class="btn" id="dfGo">Move</button></div>
         <p class="dfnote">If a <code>planner.json</code> already exists in the new folder, you may use that instead.</p><div class="dfmsg"></div>`;
    return row('Saved to', `<p>${dataWhereHTML()}</p><p>One copy per day is kept in <code>backups/</code> next to it (last 14).</p>`) +
      row('Move it to another folder', move);
  }
  if (MODE === 'fs') return row('Saved to', `<p>${dataWhereHTML()}.</p>`, `<button class="btn" id="dfChoose">Choose another folder…</button>`) +
    `<p class="sub snote">In a folder without a <code>planner.json</code>, your plan is saved there from now on; in one that has one, that plan opens instead. The old file stays where it was.</p>`;
  if (MODE === 'fallback') return row('Saved in', `<p>${dataWhereHTML()}. Clearing this browser’s website data deletes it.</p><p>To save to a file automatically, run the Planner server (works in this browser too) or open Planner in Chrome. See README.md.</p>`, `<button class="btn" id="dfExport">Export</button>`);
  return row('Saved to', `<p>${dataWhereHTML()}</p>`);
}
// Move: check the folder first; an empty one gets the plan copied in, one with a planner.json asks before opening it
async function moveDataFolder(action) {
  const inp = $('#modal .dfin'), msg = $('#modal .dfmsg'); if (!inp || !msg) return;
  const folder = inp.value.trim(); if (!folder) { inp.focus(); return; }
  const say = (html, bad) => { msg.innerHTML = html; msg.classList.toggle('bad', !!bad); };
  try {
    if (dirty) await flushSave();
    if (action === 'check') {
      const c = await server.setFolder(folder, 'check');
      if (c.same) return say('That’s already where your plan is saved.');
      if (c.has) return say(`<b>${esc(c.folder)}</b> already has a <code>planner.json</code> (last changed ${esc(c.modified)}). Open that plan instead of this one? This one stays where it is.
        <div class="row"><button class="btn primary" id="dfOpen">Open that plan</button><button class="btn" id="dfCancel">Cancel</button></div>`);
      await server.setFolder(folder, 'move');
      renderSettings(); toast('Moved. Your plan is now saved in ' + server.file);
    } else {
      await server.setFolder(folder, 'open');
      await server.reload(); toast('Opened ' + server.file);
    }
  } catch (e) { say(esc(e.message), true); }
}
// (Enter in the folder box = Move)
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('dfin')) moveDataFolder('check'); });
