# Planner — architecture

Code map for whoever edits this next. Read it, then open only the files the change needs. Update it when you add
a file, a feature that spans views, or a new rule.

## Overview

- Plain HTML / CSS / JS: no framework, build step or npm packages.
- `Planner.html` is markup plus `<link>` / `<script>` tags. Scripts are non-module and share one global scope,
  run in tag order, so the page also works opened from `file://`.
- Every change to the plan goes through `mutate()` (js/core/model.js).
- Run `node --test tests/*.test.js` after any change to `js/core/`.

## Files

```
Planner.html            markup; loads css/ and js/ in order; sets the theme before first paint
serve_planner.py        server on localhost:47823: app files, GET/PUT /api/data (planner.json), daily backups,
                        conflict check, GET/PUT /api/folder (Settings > Data file; change_folder)
mac/install-server.sh   start the server at login (fills in mac/local.planner.server.plist.template)
windows/install-server.cmd   same for Windows (runs install-server.ps1; errors to server-errors.log in data folder)
README.md               user-facing setup and troubleshooting
tests/                  see Testing

css/  (one file per area; later files override earlier ones)
  base.css              color tokens (light, then [data-theme="dark"]), layout, header, buttons, switches, guide lines
  sidebar.css           projects, threads, task rows, chain numbers, rename boxes, link menu, selection
  conflicts.css         conflict rows, add form, calendar bars, date boxes, chip close button
  calendar.css          grid, days, chips, same-day groups, highlight, #linkline
  dayview.css           list, timeline, blocks, conflict strip, tooltip, time popover
  scratch.css           scratch board, its collapsed tab and resize edge
  dialogs.css           warning bar, toast, modals, Settings, Archive, task notes
  timeline.css          Timeline view and its hover list

js/core/  (no DOM; also loaded by the unit tests)
  util.js               esc, ids, date strings, formatting, colors, plural, clamp
  parse.js              typed dates ("fri", "11/26", "+3", "td" / "tm") and times ("2pm", "930")
  prefs.js              `ui`: per-browser prefs (UI_PREFS) + new-task-box state
  model.js              `state`, migrate, the index (findTask / findThread / dayTasks / dayFails / findFail), chains and links, sub-thread
                        layout, order + conflict warnings, memo, mutate / undo / redo
  ops.js                every edit (tasks, threads, projects, conflicts, scratch), archive / restore; multi-task ops
                        (dateTasks, linkTasks, unlinkTasks, setTasksDone, archiveTasks, delTasks, moveManyTo);
                        failed attempts (failTasks, failLater, unscheduleLater, unfailTask, removeFail);
                        sidebar drops into a chain (moveTasksTo(…, inChain), dropSingle)

js/ui/  (each view draws its part of the page and handles its own events)
  dom.js                $ / $$, icons, menus, inline text + date boxes, rename, warning bar, toast, modals, guide
                        lines, tween, wheelSteps, hover-tip warm-up (hoverDelay / hoverShown / hoverGone, HOVER_WARM);
                        drag motion: makeGap (a gap opening where a dragged item would land), snapRects + flipTo
                        (slide elements to their new places after a redraw), softSnap, MOTION (reduced-motion check)
  dragdrop.js           HTML5 drag state `drag` (drag.ids = a dragged selection), shared by sidebar and calendar;
                        Option-drop; gapH, drag.h / drag.ch (gap heights), dragSrc (dimmed source rows / chips)
  archive.js            Archive window
  sidebar.js            tree, gear menus (task / thread / project / failed attempt), link menu, new-task boxes,
                        click-to-insert, drag and drop, quickAct; markFailed + its follow-up prompt (#ask, hideAsk); multi-select `sel` (⌘ / Shift-click, revealChips) and #selbar
                        (renderSelBar / selAct)
  calendar.js           renderCal, fitRows, week scrolling, day drops, selRuns, next-day link lines; failChip, tryBadge
  conflicts.js          sidebar conflicts + form, dragging conflict bars, conflict hover
  dialogs.js            Help and Settings
  timeline-data.js      admireData(): lanes, spans, per-day counts. Unordered threads are `loose` lanes drawn on
                        L.host's row (nearest ordered thread above; null = project ribbon row); vs..ve = span a row
                        shows. No ordered work = no ribbon (p.s null; p.as..p.ae = full span)
  timeline.js           renderAdmire, hover lists (admTipHTML / admTipList), folding, resizing; packs each week-row's
                        project blocks into the highest free spot (label widths via admTW)
  dayview.js            renderDay (list + hour timeline), adding tasks to a day, day swiping
  dayview-edit.js       time popover, dragging / resizing blocks, conflict drag, thread-heading tooltip
  notes.js              noteMark, the hover note (after 1 s), which is also the note editor (editInTip, editNotes);
                        ntWants: short day-view blocks get the note too
  scratch.js            scratch board (third column of #app): edits, resize, open / close (prefs scratchCal,
                        scratchDay, scratchRemember, scratchOpen), width ui.scw / --scw
  app.js                render(), header (view switcher, ‹ Today ›, weekShift / daySlide), sidebar width, theme,
                        global click / change / dblclick / keydown dispatch (data-act="…"), contextmenu → task menu
js/storage.js           start(), loading + saving in the three storage modes, conflicts, backups
js/main.js              calls start(); loaded last
```

## The data (planner.json)

```
state    = { version: 4, title?, projects: [project], archive: [entry], conflicts: [conflict], scratch: [scratch] }
project  = { id, name, threads: [thread], unordered? }
thread   = { id, name, color, tasks: [task], threads: [sub-thread], afterTask, unordered? }
task     = { id, title, date: 'YYYY-MM-DD' | null, done, linkToPrev: null | 'sameDay' | 'nextDay', plan?, notes?, fails? }
fail     = { id, date, start?, dur?, done?, prev?, next? }   a failed attempt: the date (and day-view slot) the task had
           when marked failed; done / prev / next (it was done, links cut from it) let unfailTask undo it
entry    = { id, kind: 'task' | 'thread' | 'project', at, item, from }   at = date archived, from = where it was
conflict = { id, title, start, end }   end inclusive; start null = undated
scratch  = { id, title, done }         one-off to-dos outside projects; no dates
```

- `color`: '#rrggbb' on top-level threads; null on a sub-thread = a shade of its parent's.
- `afterTask`: on sub-threads, the parent task it follows (null = before all tasks). `layout(t)` gives a thread's
  interleaved tasks + sub-threads; `writeLayout(t, list)` stores one. Consecutive sub-threads run in parallel
  (fork / join; see `violations`).
- `unordered` (thread or project): `isLoose(p, t)` is true → no order warnings, no shifting later tasks, no
  numbers, loose dots on the Timeline.
- `linkToPrev` ties a task to the previous one; a run of linked tasks is a chain and moves together.
- `plan = { date, start, dur }` (minutes from midnight): day-view slot, valid only while plan.date === date
  (`planOf`). With the "Keep day-view times" setting (`ui.keepTimes`), `mutate` calls `keepTimes` (core/model.js)
  after every change to move the slot with a task that changed day (or give a rescheduled failed task its attempt's).
- `notes`: non-empty when present; set with `setTaskNotes`.
- `fails`: non-empty when present, oldest first. `failTasks` moves the task's date into it and unschedules the task;
  each one is drawn on its day (calendar `failChip`, day-view `.dv-item.failed` / `.dv-blk.failed`, Timeline `fail`
  dots) as an element with `data-fid` / `data-kid` and no `data-id`, so the task handlers (selection, notes, day-view
  drags, TASK_EL) skip it. `attemptNo(k)` = fails + 1.

`ui` (js/core/prefs.js, localStorage `planner.ui`) holds view state and settings, never plan data.

## How a change flows

1. An event reaches a handler: most clicks go through the `data-act` dispatcher in ui/app.js; drags and
   view-specific events are handled in that view's file.
2. The handler calls an operation in core/ops.js (or `mutate(fn)` directly for something small).
3. `mutate(fn)` runs `fn` and normalizes every thread; if anything changed it pushes an undo step, calls
   `render()`, schedules a save (`scheduleSave`) and shows newly caused warnings.
4. `render()` redraws everything from `state` (calendar skipped while day view / Timeline covers it). Views keep
   no copy of the data.

Derived data (index, colors, warnings, saved JSON, Timeline data, archived chips) is cached with `memo()`, keyed
on `stateGen`, which `mutate()` bumps. Anything that changes `state` outside `mutate()` (only conflict dragging,
for live preview) must call `touch()`.

## Where to make a change

| Change | Go to |
|---|---|
| how moving a task shifts others, links, chains | `applyMove`, `shiftSubtree`, `offsets`, `normalize` (core/model.js, core/ops.js) |
| what counts as out of order / a conflict | `violations`, `conflictHits` (core/model.js); message text in `showWarn` (ui/dom.js) |
| a sidebar row | `renderTaskRow`, `renderThread`, `renderTree` (ui/sidebar.js) |
| a calendar chip or day cell | `chip`, `renderCal` (ui/calendar.js) |
| lines between next-day-linked chips | `showLinkLines` / `linkRoute` / `drawLinkLines` (ui/calendar.js) |
| day view list or blocks | `renderDayList`, `renderDayTimeline` (ui/dayview.js) |
| scratch board edits | `addScratch` … `moveScratch` (core/ops.js) |
| Timeline | `admireData` (ui/timeline-data.js), `renderAdmire`, `admTipHTML` (ui/timeline.js) |
| multi-select, selection bar | end of ui/sidebar.js; ops under "several tasks at once" in core/ops.js |
| task notes | ui/notes.js, `setTaskNotes`, task menu `openTaskMenu` (ui/sidebar.js) |
| drag motion | sidebar: `treeGap` / `gapPlace`, drop → `treeRectsFor` + `flipTo` (ui/sidebar.js); calendar: `calGap` / `calGapAt`, drop → `flipTo` (ui/calendar.js); day view: `dvAim` / `dvFrame` (eased ghost), `dvLane` (its lane while moving), `dvRest` → `dvReflow` (columns make room once the pointer pauses), `dvGap`, `dvUp` → `flipTo` (ui/dayview-edit.js); gap heights: `gapH` (what lands at that spot: `treeMoving`, `calLanding`, listTarget.ids); helpers in ui/dom.js |
| failed attempts | `failTasks` / `failLater` / `unscheduleLater` / `unfailTask` / `removeFail` (core/ops.js), `markFailed`, `openFailMenu` (ui/sidebar.js), `failChip` (ui/calendar.js), `renderDayList` / `renderDayTimeline`, `admireData` (`fail` kind) |
| header, date range, 1–5 weeks / days | Planner.html; `renderHeader`, `setRange`, `navStep` / `navToday` (ui/app.js) |
| keyboard shortcuts | keydown handler at end of ui/app.js, `switchView`; list them in `shortcutsHTML` (ui/dialogs.js) |
| a button's action | its `data-act` case (ui/app.js) |
| help text | `showHelp` (ui/dialogs.js) |
| where the data lives (Help, Settings) | `dataWhereHTML` (js/storage.js), `dataFileRows` / `moveDataFolder` (ui/dialogs.js), `change_folder` (serve_planner.py) |
| reading old files | `migrate` / `migThread` (core/model.js) |

Styles for each are in the matching css/ file.

### Checklist: a new task property

1. Data: `migThread` (accept and validate; older files lack it).
2. Rules, if it affects dates: `offsets` / `normalize`, `applyMove` / `shiftSubtree`, `violations`; link-like →
   add to `LINKS`.
3. Edits: `addTasks`, `detachTask`, `moveTasksTo` (core/ops.js), `addDayTasks` (ui/dayview.js); a UI to set it.
4. Sidebar: `renderTaskRow` (`openLinkMenu` if link-like).
5. Calendar: `chip`; archived chips via `archivedByDate`.
6. Day view: `renderDayList`, `renderDayTimeline`, ui/dayview-edit.js.
7. Timeline: `admireData`, `renderAdmire`, `admTipHTML`.
8. Archive: `archOutline` (ui/archive.js).
9. Text: `showWarn`, `showHelp`, settings text.
10. CSS, light and dark.
11. Tests in tests/scheduling.test.js or tests/model.test.js.

### Checklist: a new setting

Add to `UI_PREFS` (default, allowed values, `setting: true`), a row in `renderSettings`, any number conversion in
`applySetting`, then read `ui.yourSetting`.

### Checklist: a new file

Add its tag to `Planner.html` in order: code that runs at load can only use files above it (calls made later can
reach any file). New js/core/ files also go in `CORE` in tests/load.js. The server already serves js/ and css/.

## Docs

Four places can need text when something changes. Update them only where the change calls for it.

1. **ARCHITECTURE.md** (this file): for future editors (Claude sessions), so they find what to change quickly. Say how
   the project works and where to go for a given change: files, functions, data shape, rules, gotchas. No
   descriptions of how a feature looks or feels to use, and no repeated or padded prose.
2. **Help** (`showHelp`, js/ui/dialogs.js): match how short the existing entries are. Most features are intuitive and
   need no help text at all. Say how to reach a feature and what it's for, not what it looks like or which options
   it then presents. Add or change help only when how the app is used has meaningfully changed.
3. **Settings** (`renderSettings`, js/ui/dialogs.js; settings themselves in `UI_PREFS`, js/core/prefs.js): the same
   rules as Help, for each setting's label and note.
4. **Hover hints** (`title`, `data-hint` (dom.js), `data-tip` (header)): a short label for what the thing is or does,
   not a description. E.g. a mark-as-failed button: "Mark failed", not "Mark failed (unschedules them; their dates
   stay as failed attempts)". (A disabled button's hint may say briefly why it's off.)

## Naming

- `admire` / `adm…` = Timeline view, `cf…` = conflicts, `dv…` = day view, `tpop` = time popover, `hl` =
  highlighted task, `PPM` = pixels per minute (day view).
- chain = tasks joined by `linkToPrev`; spot = drop position `{ tid | pid, refId, side }`.
- `findTask(id)` → `{ p, t, parent, siblings, path, i, task }`; `findThread(id)` the same without `task`.

## Gotchas

- Capture-phase `document` listeners in dom.js, conflicts.js and dayview-edit.js must run before the click
  dispatcher; keep script order.
- Put user text into HTML with `esc()`.
- Day-view drags use pointer events, not HTML5 drag: right / Ctrl-click never starts one, and a drag whose release
  never arrives (context menu) is cancelled by `dvCancel` on the next press.
- Scrolling lists (`#tree`, calendar `.items`, `.dv-list`, `.dv-scroll`) need `isolation: isolate` so macOS overlay
  scrollbars draw above rows.
- Non-passive `wheel` listeners only on the calendar (`main`) and day-view timeline (`.dv-main`); keep natively
  scrolling lists free of them.
- Redraws preserve each calendar day's and list's scroll position (renderCal).
- A drag gap (`.dgap`) sits under the pointer: the `dragenter` on it must be accepted (dragdrop.js) or the drop never
  fires, and each list's dragover keeps the target the gap stands for while the pointer is on it (`gap.over(e)`).
  Code that walks a list's children skips `.dgap`. Day-view blocks carry `data-s` / `data-d` (start / duration) for
  `dvReflow`.
- Animations after a drop (flipTo) run after the op's synchronous render; take the "before" rects first.
- Option during an HTML5 drag: read it with `splitHeld(e)`, never `e.altKey` (stale mid-drag in Chrome on macOS), and set
  `dropEffect` to 'copy' while it's held: an effect outside effectAllowed cancels the drop.
- Don't change ids or saved-data shape without handling the old shape in `migrate`.
- Don't edit planner.json while the app has unsaved changes.

## Storage

Data is never in the repo (.gitignore). `start()` (js/storage.js) picks a mode:

- **server**: page served by serve_planner.py, which reads / writes planner.json in the data folder: `--data` /
  `$PLANNER_DATA` (this run only), else ~/.config/planner/data-folder.txt (`--set-data`, install scripts,
  Settings), else planner.json next to the script, else ~/PlannerData.
- **fs**: opened from disk in Chrome / Edge; folder chosen via the File System Access API, handle kept in IndexedDB.
- **fallback**: opened from disk elsewhere; localStorage plus Export / Import.

Shared logic (read, reject invalid JSON, save 350 ms after a change, "changed on disk" prompt, reload on focus) is
written once; the `server` and `folder` objects only implement read / write / poll. `backups/` in the data folder
keeps one copy per day (last 14), made by the server or, in fs mode, the page.

## Testing

- `node --test tests/*.test.js`: unit tests of js/core/ (loaded by tests/load.js; no browser, ~1 s).
- `node tests/browser/smoke.js`: headless run of every view and the main interactions against
  tests/fixtures/sample.json, failing on page errors. Needs `npm install playwright && npx playwright install
  chromium`, run outside this folder (or with node_modules/ ignored).
- Bug fix in the rules → add a test that would have caught it.

Scale checking to the change:

- Small change (label, style, shortcut, one function): unit tests; smoke test only if visual or interactive.
- `js/core/` change: unit tests plus a new test for the new behavior.
- Broad restructuring: ask the user to commit first, then compare the app before and after in a browser.
- Data-dependent bugs: reproduce on a copy of a real planner.json with `python3 serve_planner.py --data /tmp/copy`.
- After checking out an older commit that changed serve_planner.py, restart the server.
