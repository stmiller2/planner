# Planner — architecture

A map of the code for whoever changes it next (a person or a Claude session). Read this first, then open only
the files a change needs. Keep it current: when you add a file, a feature that spans views, or a new rule,
update the matching section here.

## The short version

- Plain HTML, CSS and JavaScript. No framework, no build step, no npm packages.
- `Planner.html` is a shell: the page markup plus `<link>` / `<script>` tags. The code lives in `css/` and `js/`.
- The scripts are ordinary (non-module) scripts that share one global scope, loaded in the order listed in
  `Planner.html`. That keeps the app working when `Planner.html` is opened straight from disk (`file://`), not just
  through the server.
- `serve_planner.py` serves the app at http://localhost:47823/ and reads / writes `planner.json` for it, in a data
  folder outside the code (`~/PlannerData` unless told otherwise). Opened straight from disk instead, the page saves
  to a folder you pick (Chrome / Edge) or keeps the data in the browser with Export / Import (Safari, Firefox): see
  "Storage modes". Nobody's data is ever part of the repository (`.gitignore`).
- Every change to the plan goes through `mutate()` (js/core/model.js): one undo step, then redraw, save, warnings.
- `node --test tests/*.test.js` checks the scheduling rules and operations in a few seconds. Run it after any
  change to `js/core/`.

## Files

```
Planner.html            page markup; loads css/*.css and js/**/*.js in order; sets the theme before first paint
serve_planner.py        local server: app files, GET/PUT /api/data (planner.json), daily backups/, conflict check;
                        GET/PUT /api/folder (Settings > Data file: which folder; move the plan / open another).
                        Data folder: --data / $PLANNER_DATA (this run only), else ~/.config/planner/data-folder.txt
                        (--set-data, install scripts, Settings), else planner.json next to it, else ~/PlannerData
README.md               for people using the app: the ways to run it, setup, updating, troubleshooting
LICENSE                 MIT
mac/install-server.sh   macOS: start the server at login (fills in mac/local.planner.server.plist.template)
windows/install-server.cmd   Windows: start the server now and at login (runs install-server.ps1: a Startup-folder
                        shortcut to pythonw; errors to server-errors.log in the data folder)
.gitattributes          keeps Windows line endings in windows/
tests/                  automated tests (see Testing)
.gitignore              keeps data (planner.json, backups/) and personal files out of the repository

data folder (~/PlannerData by default; never inside the repository)
  planner.json          the data (never edit while the app has unsaved changes)
  backups/              daily copies of planner.json (last 14)
css/  (one file per area, loaded in this order; later files can override earlier ones)
  base.css              color tokens (light + dark), page layout, header, buttons, switches, guide lines
  sidebar.css           sidebar: projects, threads, task rows, chain number boxes, rename boxes, link menu
  conflicts.css         conflicts: sidebar rows, the add form, calendar bars; date boxes; chip close button
  calendar.css          calendar grid, days, chips, same-day groups, highlight
  dayview.css           day view: list, timeline, blocks, conflict strip, tooltip, time popover
  scratch.css           the scratch board (right of the calendar / day view), its collapsed tab and resize edge
  dialogs.css           warning bar, toast, modal windows, Settings, Archive window
  timeline.css          Timeline view ("admire") and its hover list

js/core/  (no DOM: the data and its rules; loaded by the unit tests too)
  util.js               escaping, ids, date strings, formatting (dates, times, durations), colors, plural, clamp
  parse.js              reading typed dates ("fri", "11/26", "+3") and times ("2pm", "930")
  prefs.js              `ui`: this browser's preferences (UI_PREFS table) + shared new-task-box state
  model.js              `state`, migrate (loading old files), the index (findTask / findThread / dayTasks),
                        chains and links, sub-thread layout, order + conflict warnings, mutate / undo / redo
  ops.js                every edit: move / link / add / delete / reorder tasks, threads and projects,
                        archive / restore, conflict dates

js/ui/  (views; each draws its part of the page and handles its own events)
  dom.js                shared building blocks: $ / $$, icons, menu, inline text + date boxes, rename,
                        warning bar, toast, modals, guide lines, tween(), wheelSteps() scroll gestures
  dragdrop.js           HTML5 drag state (`drag`) shared by sidebar and calendar; Option-drop
  archive.js            the Archive window
  sidebar.js            the sidebar tree, link menu, new-task boxes, click-to-insert, sidebar drag & drop
  calendar.js           the calendar: renderCal, row heights (fitRows), week scrolling, dropping on days
  conflicts.js          conflicts in the sidebar (+ form), dragging conflict bars, conflict hover
  dialogs.js            Help and Settings windows
  timeline-data.js      Timeline data: admireData() (lanes, spans, per-day counts), cached per change
  timeline.js           Timeline drawing (renderAdmire), hover lists, folding, resizing
  dayview.js            day view: list + hour timeline (renderDay), adding tasks to a day, day swiping
  dayview-edit.js       day view editing: time popover, dragging / resizing blocks, conflict drag, tooltips
  scratch.js            the scratch board, #app's third column beside the calendar and day view: scratch tasks
                        (add / insert / tick / rename / reorder / clear done), resizing, opening / closing it (X;
                        per-view defaults in Settings: scratchCal / scratchDay, or scratchRemember + scratchOpen;
                        width now = ui.scw, --scw)
  app.js                render() (redraws everything), header (view switcher, ‹ Today › stepping with the same
                        slide as scrolling: weekShift / daySlide), sidebar width, theme, global click /
                        change / dblclick / keyboard dispatch (data-act="…")
js/storage.js           loading + saving: server / Chrome folder / browser-only modes, conflicts, backups
js/main.js              start()
```

## The data (planner.json)

```
state = { version: 4, title?, projects: [project], archive: [entry], conflicts: [conflict], scratch: [scratch] }
project  = { id, name, threads: [thread] }
thread   = { id, name, color, tasks: [task], threads: [sub-thread], afterTask }
             color: '#rrggbb' for top-level threads; null on a sub-thread = a shade of its parent's color
             afterTask: on sub-threads, the id of the parent's task it comes after (null = before all tasks)
task     = { id, title, date: 'YYYY-MM-DD' | null, done, linkToPrev: null | 'sameDay' | 'nextDay', plan? }
             linkToPrev ties a task to the one before it; a run of linked tasks is a "chain" and moves together
             plan = { date, start, dur } (minutes from midnight): its slot in day view, valid only while
             plan.date === date (see planOf)
entry    = { id, kind: 'task' | 'thread' | 'project', at (date archived), item (the thing itself), from (where it was) }
conflict = { id, title, start, end }   (end inclusive; start null = no date yet)
scratch  = { id, title, done }          the scratch board: one-off to-dos outside every project; no dates
```

Display order in a thread interleaves tasks and sub-threads: `layout(t)` gives it, `writeLayout(t, list)` stores
one. Consecutive sub-threads run in parallel (fork / join): see `violations()`.

`ui` (js/core/prefs.js) holds per-browser view state and settings (localStorage `planner.ui`), never the plan.

## How a change flows

1. A click / key / drop reaches a handler: most clicks go through the `data-act` dispatcher in `js/ui/app.js`;
   drags and view-specific events are handled in that view's file.
2. The handler calls an operation in `js/core/ops.js` (or calls `mutate(fn)` itself for something small).
3. `mutate(fn)` runs `fn`, normalizes every thread (chains line up, sub-threads stay outside chains), and if
   anything changed: pushes an undo step, calls `render()`, schedules a save (`scheduleSave`, js/storage.js) and
   shows warnings that the change newly caused.
4. `render()` (js/ui/app.js) redraws the header, sidebar, calendar (skipped while day view / the Timeline covers
   it), day view and Timeline from `state`. Views never keep their own copy of the data.

Caching: anything derived from `state` (the index, colors, warnings, the saved JSON, Timeline data, archived
chips) is computed once per change with `memo()` (js/core/model.js), keyed on `stateGen`. `mutate()` bumps it.
If you ever change `state` in place outside `mutate()` (only conflict dragging does, for live preview), call
`touch()` right after.

## Where to make a change

| You want to change… | Go to |
|---|---|
| how moving a task shifts other tasks, links, chains | `applyMove`, `shiftSubtree`, `offsets`, `normalize` (core/model.js, core/ops.js) |
| what counts as out of order / a conflict | `violations`, `conflictHits` (core/model.js); message text in `showWarn` (ui/dom.js) |
| a sidebar row (task / thread / project) | `renderTaskRow`, `renderThread`, `renderTree` (ui/sidebar.js) + css/sidebar.css |
| a calendar chip or day cell | `chip`, `renderCal` (ui/calendar.js) + css/calendar.css |
| the dotted lines between next-day-linked chips | `showLinkLines` / `linkRoute` / `drawLinkLines` (ui/calendar.js) + `#linkline` in css/calendar.css |
| day view list or blocks | `renderDayList`, `renderDayTimeline` (ui/dayview.js) + css/dayview.css |
| dragging / resizing in day view, the time popover | ui/dayview-edit.js |
| the scratch board | ui/scratch.js + css/scratch.css; its edits are `addScratch` … `moveScratch` (core/ops.js) |
| the Timeline view | `admireData` (ui/timeline-data.js), `renderAdmire`, `admTipHTML` (ui/timeline.js) + css/timeline.css |
| a setting | `UI_PREFS` (core/prefs.js), `renderSettings` / `applySetting` (ui/dialogs.js) |
| the header: view switcher, ‹ Today ›, the dates in view, 1–5 days | markup in Planner.html; `renderHeader`, `setRange`, `navStep` / `navToday` (ui/app.js) + css/base.css |
| keyboard shortcuts | the keydown handler at the end of ui/app.js, `switchView` for C / D / - (and list them in `shortcutsHTML` in ui/dialogs.js, shown at the end of Help) |
| a button's action | its `data-act` case in the click dispatcher (ui/app.js) |
| help text | `showHelp` (ui/dialogs.js) |
| colors, theme | tokens at the top of css/base.css (light, then `[data-theme="dark"]`) |
| loading / saving, backups | js/storage.js (browser side), serve_planner.py (server side) |
| where the data lives (Help, Settings > Data file) | `dataWhereHTML` (js/storage.js), `dataFileRows` / `moveDataFolder` (ui/dialogs.js), `change_folder` (serve_planner.py) |
| reading old planner.json files | `migrate` / `migThread` (core/model.js) |

### Checklist: a new property on tasks (e.g. a "wait time" between tasks)

A property that shows everywhere touches every view. Go through all of these:

1. **Data**: `migThread` in core/model.js (accept and validate it when loading; older files won't have it).
2. **Rules**: if it affects dates, `offsets` / `normalize` (chains), `applyMove` / `shiftSubtree` (shifting),
   `violations` (order warnings); if it's a kind of link, add it to `LINKS` (core/model.js).
3. **Edits**: the operations that create, split or join tasks in core/ops.js (`addTasks`, `detachTask`,
   `moveTasksTo`) and `addDayTasks` (ui/dayview.js); a way to set it (menu, popover or inline box).
4. **Sidebar**: `renderTaskRow` (and `openLinkMenu` for link-like things) in ui/sidebar.js.
5. **Calendar**: `chip` in ui/calendar.js; archived chips come from `archivedByDate` (same file).
6. **Day view**: `renderDayList` and `renderDayTimeline` (ui/dayview.js); dragging in ui/dayview-edit.js.
7. **Timeline**: `admireData` (ui/timeline-data.js) if it should be counted or drawn; `renderAdmire` and the
   hover list `admTipHTML` (ui/timeline.js).
8. **Archive window**: `archOutline` (ui/archive.js) shows what archived threads contained.
9. **Words**: warning text (`showWarn`, ui/dom.js), help (`showHelp`) and settings text (ui/dialogs.js).
10. **Styles** in the matching css/ files, light and dark.
11. **Tests**: add cases to tests/scheduling.test.js or tests/model.test.js, run `node --test tests/*.test.js`.

### Checklist: a new setting

Add it to `UI_PREFS` (default, allowed values, `setting: true`), add a row in `renderSettings`, handle any
number conversion in `applySetting` (ui/dialogs.js), and read it as `ui.yourSetting` where it matters.

### Checklist: a new file

Add its `<script>` / `<link>` tag to `Planner.html` in the right place (scripts run top to bottom: a file may
*call* functions from any file once the page has loaded, but code that runs immediately at load can only use
files above it). A new js/core/ file also goes in the `CORE` list in tests/load.js. The server already serves
any .js / .css file inside js/ and css/.

## Naming you'll meet in the code

- **admire / adm…** = the Timeline view (third icon in the header's view switcher). **cf…** = conflicts. **dv…** = day view.
  **tpop** = the start / end time popover. **hl** = highlighted task. **PPM** = pixels per minute in day view.
- **thread / sub-thread** = `t.threads` nesting; **chain** = tasks joined by `linkToPrev`; **spot** = a drop
  position `{ tid, refId, side }` or `{ pid, refId, side }`.
- `f = findTask(id)` gives `{ p, t, parent, siblings, path, i, task }`; `findThread(id)` the same without task.

## Things to keep in mind

- Order of event listeners matters where several handle the same event on `document` (capture-phase listeners in
  dom.js, conflicts.js and dayview-edit.js deliberately run before the click dispatcher). Keep script order.
- Text from the data is put into HTML with `esc()`; keep doing that for anything a user typed.
- Scrolling lists (`#tree`, calendar `.items`, `.dv-list`, `.dv-scroll`) have `isolation: isolate`, so macOS overlay
  scrollbars draw in front of their rows. Give any new scrolling list the same.
- A non-passive `wheel` listener makes the browser wait for JavaScript before scrolling what's under it. Only the
  calendar (`main`) and the day-view timeline (`.dv-main`) have one; the day list's listener is passive. Keep lists
  that scroll natively free of non-passive wheel listeners.
- After a change, redraws keep each calendar day's own scroll position (renderCal) and the lists' scroll positions.
- Don't change ids or the shape of saved data without handling the old shape in `migrate`.

## Storage modes

`start()` (js/storage.js) picks one: **server** (normal: page served by serve_planner.py), **fs** (opened from
disk in Chrome: a folder chosen with the File System Access API, remembered in IndexedDB) or **fallback**
(opened from disk elsewhere: localStorage plus Export / Import). The shared parts (reading, refusing invalid JSON,
saving 350 ms after a change, "changed on disk" choice, reloading on focus) are written once; the `server` and
`folder` objects only implement read / write / poll for outside changes.

## Testing

- `node --test tests/*.test.js` — unit tests of the rules and operations (js/core/ loaded by tests/load.js,
  no browser needed, a few seconds). Covered: chain moves, shift-later, Option-drop, unscheduling, links,
  undo / redo, loading old files, sub-thread placement, order + conflict warnings, the index after changes,
  day-view slots, colors, adding / deleting / moving tasks and threads, archive / restore, conflicts, typed
  dates and times, saved preferences.
- `node tests/browser/smoke.js` — opens the real app in a headless browser against tests/fixtures/sample.json
  and checks every view and the main interactions, with no page errors. Needs Playwright with Chromium
  (`npm install playwright && npx playwright install chromium`, outside this folder or with node_modules/ ignored).
- When you fix a bug in the rules, add a test that would have caught it.

### How much checking a change needs

Match the checking to the size of the change; don't over-verify small edits.

- **Small, contained change** (a shortcut, a label, a style, one function): edit the files in place, run
  `node --test tests/*.test.js` (about a second), and run the browser check only if the change is visual or
  interactive. Skip full replays.
- **Change to scheduling rules or data** (`js/core/`): unit tests always, plus a new test for the new behavior.
- **Broad restructuring** (moving code between files, renaming across the app): commit first, then
  compare the app before and after in a browser across many interactions.
- To reproduce a bug that depends on the data, use a copy of a real `planner.json` rather than the sample fixture
  (`python3 serve_planner.py --data /tmp/somecopy` serves the app on a copy without touching the real one).

## Versions and backups

- **Data**: the data folder's `backups/` holds a copy of `planner.json` per day (last 14), made by the server or,
  in Chrome's folder mode, by the page.
- **Code**: git. Commit before a risky change; restart the server after going back to an older commit if
  serve_planner.py changed.
