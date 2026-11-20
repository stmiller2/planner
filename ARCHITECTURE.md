# Planner — architecture

Code map for whoever edits this next. Read it, then open only the files the change needs. Update it when you add
a file, a feature that spans views, or a new rule.

## Overview

- Plain HTML / CSS / JS: no framework, build step or npm packages in the app itself.
- The same files run two ways: on the user's computer (serve_planner.py, or Planner.html opened from disk) and online
  at https://planner.stmiller2.workers.dev (Cloudflare; see Online). Changes to the app reach both.
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
wrangler.jsonc          the online version on Cloudflare (see Online): Worker, D1 database, Access settings
worker/index.js         Cloudflare Worker: /api/data like serve_planner.py, per signed-in person, from D1;
                        verifies the Cloudflare Access token (DEV_USER stands in on localhost under wrangler dev)
worker/build.js         copies the app files into dist/ (what Cloudflare serves); run by wrangler dev / deploy
migrations/             D1 schema (plans, backups)
.dev.vars               DEV_USER for `wrangler dev` only (never uploaded)
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
  mobile.css            mobile mode (all under body.mobile; loaded last): one column, 60px header, drawer, day view's
                        bottom sheet (--sheet-h), chips of up to two lines, "…"

js/core/  (no DOM; also loaded by the unit tests)
  util.js               esc, ids, date strings, formatting, colors, plural, clamp
  parse.js              typed dates ("fri", "11/26", "+3", "td" / "tm"; NO_DATE words — "none", "na",
                        "unschedule" — read as '', i.e. no date) and times ("2pm", "930")
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
  mobile.js             mobile mode (a phone-sized window, MOBILE_MQ → `MOBILE`, body.mobile): drawer (`mDrawer`,
                        `mDrawerEl`: the sidebar, or the Timeline's list; none in day view) from ☰ or a swipe in from
                        the left edge, swiped back to close (`mEdge` / `mClose`, `mDrawerAt` / `mDrawerLet`); in day
                        view a back button (#mBack) in ☰'s place, and the edge swipe goes back to the calendar
                        (`mBackMove` / `mBackEnd`, the calendar drawn under it: #app.m-backing); the sidebar's top bar
                        (.m-bar) stands in for the header's right side; the sidebar's own tree (`mTree`: rows fold in
                        place, no redraw); week heights (`mFit`: what each week needs, as desktop's fitSizes; the
                        weeks built ahead sized to match, `mNbFit`) and "…" for full days (`mClip`, chip by chip; on a
                        day already shown, what comes and goes fades: `mNote` / `mWas`, copies fading out, `mFadeOut`,
                        .m-fade); a tap on "…" opens up its week (`mFocus` / `mFocusSet`: that week as tall as it needs
                        or as there's room for, the others down to M_CRUSH, each week's foot moving at one speed with a
                        "…" riding it (.m-moving, .m-ride, `mFocusEnd`); "Show less" at its foot, `mFocusBar`; a day
                        there that still can't show everything ends in a "+N more" chip (.m-plus) → that day in day
                        view; a swipe or a step to other weeks puts it back); conflicts: a tap on one (calendar bar,
                        day view's, the drawer's row) → `openConflictMenu` (Change dates…: `mCfDates`, Rename…, Delete),
                        a long press on a calendar bar moves it (`mCfLift` / `mCfDrag` / `mCfDrop`); the task menu's
                        title a block like the task's chip (`mTaskHead`, also the notes card's); one "Add task" at the
                        drawer's foot (.m-foot) and one in day view's sheet heading (`mDayAddBtn`, put there by
                        renderDay), and Add task in a thread's menu (`mAddTask`: opens on the name, just above the
                        keyboard, #mAsk.m-low placed on the visual viewport by `mAskFit`; the thread is a best guess,
                        `mGuessThread`: last added to on this device in the last few hours, localStorage
                        planner.mLastAdd, else the thread busiest around the day, else the one whose next unfinished
                        task is soonest; tapping it lists every thread and sub-thread, `mThreadRows`, day view's only
                        those on that day until "Show all threads" (.mp-off), Cancel returning to the name; threads in the
                        drawer end in a `.mt-end` marker, where a lifted task can be dropped), linked tasks drawn as on desktop but without the chain bar (`mTask`: number boxes), a long press on a
                        project or thread → its menu (with Add…, Rename… via `mRenameAny`; naming a new one cancelled: `mDropNew`), on a task → reorder
                        (let go in place after a long press: put back, no menu) (`mTreeLift` / `mTreeGhost` / `mTreeDrag` / `mTreeAim` / `mTreeDrop` → moveTasksTo, #mTreeLine; the copy that
                        follows the finger holds every row that moves); tap a chip → its menu (with Open day),
                        elsewhere in a day → openDay; a tap on any task gets a little press (`mTapFx`); a long press
                        lifts a task (`mLift`; held still M_PEEL ms longer it peels off, as Option does: `mPeel`,
                        `s.split`, passed as split / single / altKey to the drops below, only where `mSplitMatters`):
                        calendar chips by touch (a same-day group lifts whole) (`mCalLift` / `mCalGhost` / `mCalDrag` /
                        `mCalDrop` →
                        calGapAt / calDropOn; over the header: unschedule, #mDropOff; at the edges: weekShift), day
                        view through the desktop's drag (`mDvLift` sets `dv`, then dvMove / dvUp with the touch
                        positions: `mDvE`); the task menu's Reschedule… / Rename… (`mAsk`, a box at the top; Reschedule's "Only this task" switch, `toggle`,
                        moves it as Option would) and Set a
                        time… (openTimePop: a number pad, inputmode, and taps for :00 / :15 / :30 / :45 and AM / PM
                        acting on the field last focused, `mTpBtns`), opened over the menu, which stays open and is drawn again when they close
                        (`mPopOpen`, `mMenuBack`; menu.dataset.kid: its task); an Undo bar after touch changes (`mUndo`, in #toast); the task menu as
                        a sheet with a title bar (`mMenuHead`), swiped down to close, and while it's open a tap
                        outside it only closes it (`mMenuEat`); notes in a card of their own (`mNotes`); swipe up / down → setPull / weekShift (`mSw`,
                        one week per swipe; R, the pull before resistance, is a week's usual share, not an opened
                        week's height; a step needs M_WTURN of it or an M_WFLICK flick); day-view touch swipes over the timeline or the list (enterStrip / setStripX /
                        daySlide; the list holds the same days side by side and moves with it: `.m-lrow`); day view's list as a bottom sheet (`mSheetSet`, set per day on entering
                        day view by `mSheetAuto`, dragged by .m-grab / its heading; a tap on the timeline's blank
                        space puts it down);
                        tap a day-view task → its menu; Timeline: the list (.adm-side) is the drawer, a tap opens a
                        dot's / day's list at once and picks out its thread (`mAdmSpot`), a name in the drawer jumps
                        to its lane, and opening it brings today into view (`mAdmToday`); the warning bar kept short
                        (each warning two lines, a tap shows all: m-over / m-open); the header pulled down refreshes (#mPtr, `mPtMove` / `mPtEnd` → refreshPage in
                        storage.js). Loaded right after dom.js
  dragdrop.js           HTML5 drag state `drag` (drag.ids = a dragged selection), shared by sidebar and calendar;
                        Option-drop; gapH, drag.h / drag.ch (gap heights), dragSrc (dimmed source rows / chips)
  archive.js            Archive window
  sidebar.js            tree, gear menus (task / thread / project / failed attempt), link menu, new-task boxes,
                        click-to-insert, drag and drop, quickAct; markFailed + its follow-up prompt (#ask, hideAsk); multi-select `sel` (⌘ / Shift-click, revealChips) and #selbar
                        (renderSelBar / selAct)
  calendar.js           renderCal (calWeeksHTML), fitRows (weekNeeds + fitSizes), week scrolling (weekShift), day drops, selRuns, next-day link lines;
                        failChip, tryBadge
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
  app.js                render(), renderWeeks() (header + calendar only), header (view switcher, ‹ Today ›, weekShift / daySlide), sidebar width, theme,
                        global click / change / dblclick / keydown dispatch (data-act="…"), contextmenu → task menu
js/storage.js           start(), loading + saving in the three storage modes, conflicts, backups
apple-touch-icon.png    the iOS home-screen icon (Planner.html; iOS ignores the manifest's icons and fills transparency
                        black, so it's icon-512's square, full bleed, 180 px); served like the other icons
js/main.js              calls start(); loaded last
```

## The data (planner.json)

```
state    = { version: 5, title?, projects: [project], archive: [entry], conflicts: [conflict], scratch: [scratch] }
project  = { id, name, threads: [thread], unordered? }
thread   = { id, name, color, tasks: [task], threads: [sub-thread], afterTask, unordered? }
task     = { id, title, date: 'YYYY-MM-DD' | null, done, linkToPrev: null | 'sameDay' | 'nextDay', plan?, notes?, fails? }
fail     = { id, date, start?, dur?, done?, prev?, next?, joined? }   a failed attempt: the date (and day-view slot)
           the task had when marked failed; done / prev / next (it was done, links cut from it) let unfailTask undo
           it; joined: the id of the attempt it failed same-day linked to (failInto), so the calendar keeps the
           two one bubble (dayFailRuns) whatever is put between their tasks later. Version-4 files didn't record
           it (migrate infers it from the links); early version-5 ones say `true` (migrate finds the attempt).
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
- A day's list mixes its live tasks and its failed attempts: `dayItems(d)` → `orderDay` (core/model.js), thread by
  thread. Live tasks keep thread order; each failed attempt goes just above the first live task that comes after it
  (a later attempt, `attemptOf`, or further down the thread). So a failed step picked up again on the day of the
  attempt that showed it lists under that attempt, what worked stays above what failed after it, and untried later
  steps stay after the retries. It depends only on what each item is, never on the order things were marked.
  `dayOrder(d)` gives the same order as a lookup by task / attempt id (calendar). Don't order a day by `n` alone.

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
| drag motion | sidebar: `treeGap` / `gapPlace`, drop → `treeRectsFor` + `flipTo` (ui/sidebar.js); calendar: `calGap` / `calGapAt` (where it lands: `dayDropBefore`, core/model.js), drop → `flipTo` (ui/calendar.js); day view: `dvAim` / `dvFrame` (eased ghost), `dvLane` (its lane while moving), `dvRest` → `dvReflow` (columns make room once the pointer pauses), `dvGap`, `dvUp` → `flipTo` (ui/dayview-edit.js); gap heights: `gapH` (what lands at that spot: `treeMoving`, `calLanding`, listTarget.ids); helpers in ui/dom.js |
| failed attempts | `failTasks` / `failLater` / `unscheduleLater` / `unfailTask` / `removeFail` (core/ops.js), `dayItems` / `dayOrder` / `dayDropBefore` (core/model.js), `markFailed`, `openFailMenu` (ui/sidebar.js), `failChip` (ui/calendar.js), `renderDayList` / `renderDayTimeline`, `admireData` (`fail` kind) |
| header, date range, 1–5 weeks / days | Planner.html; `renderHeader`, `setRange`, `navStep` / `navToday` (ui/app.js) |
| keyboard shortcuts | keydown handler at end of ui/app.js, `switchView`; list them in `shortcutsHTML` (ui/dialogs.js) |
| a button's action | its `data-act` case (ui/app.js) |
| help text | `showHelp` (ui/dialogs.js) |
| where the data lives (Help, Settings) | `dataWhereHTML` (js/storage.js), `dataFileRows` / `moveDataFolder` (ui/dialogs.js), `change_folder` (serve_planner.py); online: the `server.hosted` branches of the same |
| loading / saving online, accounts | `load` / `save` / `signedInEmail` (worker/index.js), `server` (js/storage.js); keep /api/data the same as serve_planner.py |
| which files go online | `FILES` / `DIRS` in worker/build.js |
| reading old files | `migrate` / `migThread` (core/model.js) |
| mobile layout or touch | ui/mobile.js, css/mobile.css; hooks that check `MOBILE`: `renderTree` (→ `mTree`), `openThreadMenu` / `openProjectMenu` (title bar, Add task / Add thread, Rename…: `m-add-k`, `m-ren-t`, `m-ren-p` in app.js), `startRename` (dom.js: no row to type in → `mRenameAny`, so new threads and projects ask for a name; `fresh` from addProject / addThread / addSubThread: Cancel removes them), `renderDayList` (the days side by side while `dayStrip` is set), `renderDay` (`mDayAddBtn` in the sheet's heading), `enterStrip` / `setStripX` / `daySlide` (dayview.js: the list moves sideways with the timeline), `openTaskMenu` (title bar, Mark done, Open day, Reschedule…, Set a time…, Rename…, View/edit notes: `k-day` / `k-resched` / `k-time` / `k-rename`, and `k-notes` → mNotes, in app.js, none of which close the menu; menu.dataset.kid), the document click handler (app.js) and the menu's scroll close (dom.js) leaving the menu open under #mAsk / #tpop, `closeTimePop` (→ mMenuBack), conflicts.js (the bars' pointerdown left to mobile.js), app.js (`m-cf-dates`, `m-ren-c`, `del-c` closing the menu; no inline rename of a conflict on a double tap), `placeMenu` (menu.dataset.cid), `weekShift` (`mFocusEnd`), `setPull` (pulls "Show less" too), `buildNeighbours` (→ mNbFit), `renderDay` (the sheet's count), dvMove / dvAutoScroll (the list is a sheet along the bottom: `overSide` by y), the calendar's hover highlight, `chip` / `failChip` / archived chips (`mChip`), `fitRows`, `buildNeighbours`, `weekShift` (equal rows, "…" on arriving weeks) (calendar.js), `dayN` (dayview.js, one day), `openDay` (`mSheetAuto` when entering day view), the sheet's handle in `buildDaySkeleton`, the day-view click / pointerdown handlers (dayview-edit.js), `setSbw`, `setRange` (app.js: months only; "Timeline"), `openTaskMenu` (Mark done), the notes hover (notes.js), `renderAdmire` (no list column, wider days), the Timeline's hover handlers and fold arrows (timeline.js) |

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
reach any file). New js/core/ files also go in `CORE` in tests/load.js. The server already serves js/ and css/, and
worker/build.js already copies them online. A new file outside js/ and css/ that the page loads (an image, say) also
goes in `FILES` in serve_planner.py and in worker/build.js.

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
- Week steps (weekShift, navToday): the slide works like the day view's. It adds only the arriving weeks to the days
  already shown (`calWeeksHTML`, each week self-contained: its conflicts get their lines within the week), lays the
  strip out once, and moves days and conflict bars into place with transforms each frame (days and bars are kept as
  layers: css `#grid .day`). Only days of rows changing height get a new height. Landing drops the weeks that left
  and renumbers grid rows (no redraw); if anything changed mid-slide (renderCal waits: `weekAnim.stale`) it redraws
  in full. The result must equal a full redraw (labels via `firstLabels`). The new view's heights come from the strip
  (`weekNeeds` -> `fitSizes`, the sizing fitRows uses), so the landing matches the slide's last frame. Keep it that
  way: no full redraw or reflowing resize per frame, and row sizing only in fitSizes. Heights must not depend on the
  row's own height: in a day only `.items` may shrink (`.dn` / `.cf-gap` are flex: none), `.items` keeps its
  scrollbar room (scrollbar-gutter), and the grid is measured with overflow hidden. Other week changes use
  `renderWeeks()` (header + calendar, not the sidebar).
- The weeks just before and after the view are built ahead (`buildNeighbours`, shortly after each redraw or slide):
  `.day.nb` / `.cfb.nb`, `.above` / `.below`, positioned out of the layout just past the grid's clipped edges. A step
  turns the arriving week into an ordinary one instead of building it. Anything reading the view's days must skip `.nb` (`viewDays()`, which also sorts them by
  date: page order isn't date order after a slide). Days give an explicit column span (`c / c+1`): a positioned
  grid item with only a start line stretches to the grid's edge.
- Mobile (`MOBILE`): no HTML5 drag and drop and no hover; dragging is a long press (mobile.js), which reuses the
  drop code: the calendar's drop is `calDropOn(day, split)` for both, and day view's `dv` drag takes plain
  `{ clientX, clientY, target, altKey }` objects, so keep dvMove / dvUp to those fields. While a task is lifted,
  mobile.js swallows contextmenu and pointercancel (window, capture), which would otherwise cancel the `dv` drag.
  Conflict bars on the mobile calendar take taps and long presses (conflicts.js leaves their pointerdown to mobile.js),
  so finding the day under a finger there goes through `elementsFromPoint` (calDayAt, mCalDrag), not elementFromPoint.
  Notes on mobile never use #ntip: it closes on any page scroll, which an iPhone's keyboard causes as it opens. Any
  box typed into on mobile must be 16px or more (mobile.css does it for all), or iPhones zoom the page on focus. Week heights come from `mFit` both in fitRows and in weekShift's
  newRows, so a slide lands where a redraw would; it measures with the "…" taken off (`mUnclip`), so call mClip after.
  The weeks built ahead get an inline height (and, above, top) from mNbFit; weekShift clears both when one joins the
  view, as a leftover top shifts its days out of their row. With a week opened up (`mFocus`), fitRows also adds
  "Show less" (`mFocusBar`, a grid item in that week's row; one already there is kept, a new one fades in once the rows
  have eased, css .m-less) and its days carry `.m-foc` (32px kept at their foot,
  M_BAR in mFit); weekShift lands any ease under way (`mFocusEnd`) and clears mFocus (and the bar) first; a swipe on
  the calendar while a week is opened up only puts it back. What days show is worked out for where rows end up, before
  they move: mFocusSet lays the end rows out (fitRows with `mClipMode` 'quiet'), keeps that on growing days, puts the
  previous state back on shrinking ones, then puts the old rows back and eases (.m-anim, during which fitRows skips
  mClip; in-flow "…" hidden, a .m-ride per day with more than shows); `mFocusEnd` clips the shrunk days ('more': only
  the "…" fades in) and fades the riders. weekShift gives each day of a row changing height its end height for mClip
  before frame(0), so nothing is hidden or shown when it lands. mClip fades only on a day it has clipped before (`mSeen`); the fading copies (.m-fade) sit in the day, outside `.items`, so look for a
  day's "…" as `.items > .m-more`. Day view's list in its strip (`.m-lstrip` / `.m-lrow`) is drawn by renderDayList
  whenever `dayStrip` is set (mobile), the days beside the current one offset down by its scroll; their timeline
  columns have no "other day" tint on mobile (.dv-col.other).
  The sidebar's tree on mobile is `mTree`, not renderTree's: code reaching for `#tree .task` rows finds none there. Day view always shows one day: read `dayN()`, never
  `ui.dayCount`, for what's on screen. Touch gestures attach their move / end listeners to the touched element
  (`mFollow`), because a redraw mid-gesture (enterStrip) removes it from the page and its events stop bubbling.
  The drawer's touches are claimed in the capture phase: the calendar's and day view's touchstart handlers skip while
  `mEdge` is set. `#admire` has no z-index on mobile (so its list drawer can sit above #mScrim), nor `#dayview` (its
  sheet, z 30, sits under the drawer); what's under them is hidden instead. The Timeline ignores mouseover on mobile: a tap's emulated mouse events would undo what the tap picked out.
  Conflict bars' top (CF_TOP) assumes a day's padding and `.dn` height, which mobile.css keeps.
- Calendar swipes: the swipe pulls the days along with resistance (`setPull`, 0.35: the days and the week built
  beyond move, not the grid, so the coming week shows; let go early and they spring back). Past WEEK_PULL px it
  takes the same step as ‹ › and the arrow keys (`weekShift(dir)`, plain ease-out), on from where the pull got to.
- Calendar wheel: a gesture starting over a day's list that can scroll scrolls the list; once the list is at its end,
  the gesture is taken over (`reclaim` in wheelSteps, ui/dom.js), locked like after a step: only a fresh push (speed
  rising, not the swipe's momentum) and one more pull then change the week.
- A conflict bar's room (`.cf-gap`, `daySlots` in renderCal) is kept only on the days the bar covers, tall enough
  for the lowest bar over that day.
- The calendar's gap must open where the drop would actually land, which for a day holding failed attempts is not
  index order: ask `dayDropBefore(day, ids)` (core/model.js), never work it out from the chips on screen.
- A failed attempt's chip is draggable only while its task is unscheduled, and dropping it back on itself cancels
  (`failBail`, ui/calendar.js): it's the only way out over the day the task would land on anyway.
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

Other windows and devices: a window picks up a newer saved plan when it regains focus (`pullLatest`, unless it has
unsaved changes); on mobile also when it comes back into view (visibilitychange / pageshow), and it saves at once
when it goes out of view. A save over a plan changed elsewhere gets the conflict prompt (`changedOnDisk`).
`refreshPage` (mobile's pull-down on the header) saves what's waiting, checks the server answers, then reloads.

The online version is `server` mode too: worker/index.js speaks the same /api/data protocol and adds
`X-Planner-Hosted` / `X-Planner-User`, read into `server.hosted` / `server.user`. Code that differs online checks
`MODE === 'server' && server.hosted` (Help, Settings > Data file: account, Export / Import, Sign out; the conflict
prompt's wording; the account button in the header, `#acctBtn`, shown by `server.open`, its menu `openAccount` in
ui/app.js). Online only, changes that couldn't be saved (signed out: Access answers with a redirect, seen
as `opaqueredirect`; offline; tab closed) are kept in localStorage `planner.pending` and offered back on the next
load (`keepPending` / `offerPending`). Version tags come from `X-Planner-Version` when present (`server.tagOf`).

Shared logic (read, reject invalid JSON, save 350 ms after a change, "changed on disk" prompt, reload on focus) is
written once; the `server` and `folder` objects only implement read / write / poll. `backups/` in the data folder
keeps one copy per day (last 14), made by the server or, in fs mode, the page.

## Settings

The Settings-window preferences (`setting: true` in UI_PREFS, js/core/prefs.js), and the view preferences marked
`sync: true` (weeks shown, collapsed threads, days shown in day view, the Timeline's future tasks), are saved in the
plan as `state.settings`, so they follow the plan to every browser and device; the rest of `ui` (sizes, theme) stays
in each browser's localStorage. Weeks shown is kept per kind of screen (`phoneKey`: `weeksPhone` on mobile, `planKey`).
View preferences are changed in place (`ui.collapsed[id] = …`), so `saveUI` also writes the plan's copy and saves it
(once the plan is loaded); the plan's copy is a copy, never `ui`'s own object. The plan's copy wins: `render()` applies it first (`planSettings` -> `settingsFromPlan`), so
code (and tests) must change a setting through `applySetting`, which writes it to the plan (`settingsToPlan`) and
saves; setting `ui.x` directly is undone by the next redraw. A plan without settings takes the browser's when it's
opened (`adopt`). Undo / redo leave settings alone (`keepSettings`); an imported file without settings keeps the
current ones. New setting: add it to UI_PREFS with `setting: true`; nothing else is needed for it to travel.

## Online (Cloudflare)

Live at https://planner.stmiller2.workers.dev, entirely on Cloudflare's free plan. Online and local plans are
separate; Export / Import (Settings > Data file) moves a plan between them.

- **Pieces.** Cloudflare serves dist/ as static files: worker/build.js copies Planner.html (also as index.html), the
  manifest, icons, css/ and js/ there, run automatically by `wrangler dev` / `wrangler deploy` ("build" in
  wrangler.jsonc). Only /api/* runs the Worker (`run_worker_first`). Cloudflare Access sits in front of the whole
  address: sign-in with an emailed one-time PIN; the Access application's policy lists the allowed emails.
- **Who is signed in.** The Worker trusts only the Access token (`Cf-Access-Jwt-Assertion`), verified against the
  team's public keys using ACCESS_TEAM_DOMAIN and ACCESS_AUD ("vars" in wrangler.jsonc; identifiers, not secrets).
  The email in it is the account. Under `wrangler dev`, DEV_USER (.dev.vars, never uploaded) stands in, on
  localhost only. Never add another way to tell who someone is (headers, query strings, cookies) without verifying it.
- **Data.** D1 database `planner` (schema in migrations/): `plans(email PK, data, version, created_at, updated_at)`,
  one row per person holding planner.json's text, `version` bumped on each save; `backups(email, day, data)`, the
  plan before the first save of each UTC day, newest 14 kept. A change to planner.json's shape needs no D1 migration:
  D1 stores the text and `migrate()` upgrades it in the browser.
- **Protocol.** /api/data in worker/index.js mirrors serve_planner.py (ETag = version tag, `"none"` = no plan yet,
  204 / 304, If-Match → 412), so js/storage.js has one `server` backend for both. Change both together, with tests
  in tests/worker.test.js. Online-only headers: `X-Planner-Hosted`, `X-Planner-User`, `X-Planner-Version`.
- **Free-plan limits** (daily ones reset 00:00 UTC; past a limit requests fail, nothing is billed): 100k Worker
  requests / day, 10 ms CPU per request, D1 100k rows written and 5M read / day, 2 MB per row (saves over 1.9 MB get
  413), Access 50 people. Each save is one request and one row write (plus one backup row a day). Keep it that way:
  no writes per request (last-seen stamps, logs in D1), no polling timers, no heavy work in the Worker.
- **People.** Zero Trust > Access controls > Applications > planner > Edit > its policy > Include > Emails. Someone
  holds one of the 50 seats from their first sign-in until removed from Zero Trust's user list. Login method:
  One-time PIN (Integrations > Identity providers; new Zero Trust organizations default to Cloudflare-account
  login instead).
- **Restoring someone's backup:**
  ```
  npx wrangler d1 execute planner --remote --command "SELECT day FROM backups WHERE email = 'x@example.org'"
  npx wrangler d1 execute planner --remote --command "UPDATE plans SET data = (SELECT data FROM backups WHERE email = 'x@example.org' AND day = '2026-11-20'), version = version + 1 WHERE email = 'x@example.org'"
  ```
  Their open windows then report a conflict on the next save ("Load the saved version"). D1 Time Travel can also
  restore the whole database to any moment in the last 7 days (`npx wrangler d1 time-travel`).
- **Pushing to main publishes** (Workers Builds deploys each push). Claude sessions: don't commit, push, run
  `wrangler deploy` or any `--remote` command; the user does.

### Applying a change (the user's steps)

1. Run `node --test tests/*.test.js`.
2. Try it on this computer as usual (the Planner server, http://localhost:47823). If the change touches
   js/storage.js, worker/, wrangler.jsonc, migrations/ or Settings > Data file, also try the online version here:
   `npx wrangler dev`, then http://localhost:8787 (signed in as test@localhost, with a test database kept in
   .wrangler/). The first time, and after adding a migration, run `npx wrangler d1 migrations apply planner --local`
   before `wrangler dev`.
3. If the change adds a file to migrations/: run `npx wrangler d1 migrations apply planner --remote` before pushing
   (a push deploys code only; it never changes the database). Most changes don't touch migrations/.
   A migration must also work with the code that is live until the push deploys: add tables or columns; don't
   rename or drop them in the same change.
4. Commit and push to main. Workers Builds deploys it in a minute or two; the dashboard (Workers & Pages > planner >
   Deployments) lists each deployment with its commit and can roll back to an earlier one. Avoid running
   `npx wrangler deploy` by hand, so the site never runs code that isn't on GitHub (it deploys whatever is in this
   folder, committed or not).
5. Check https://planner.stmiller2.workers.dev. Tabs that were already open keep the old code until reloaded.

## Testing

- `node --test tests/*.test.js`: unit tests of js/core/ (loaded by tests/load.js; no browser, ~1 s), and of
  worker/index.js against an in-memory SQLite stand-in for D1 (tests/worker.test.js; needs Node 22.13+).
- `node tests/browser/smoke.js`: headless run of every view and the main interactions against
  tests/fixtures/sample.json, failing on page errors. Needs `npm install playwright && npx playwright install
  chromium`, run outside this folder (or with node_modules/ ignored).
- The online mode has no browser test in the repo: check it with `npx wrangler dev` (see Online).
- Bug fix in the rules → add a test that would have caught it.

Scale checking to the change:

- Small change (label, style, shortcut, one function): unit tests; smoke test only if visual or interactive.
- `js/core/` change: unit tests plus a new test for the new behavior.
- Broad restructuring: ask the user to commit first, then compare the app before and after in a browser.
- Data-dependent bugs: reproduce on a copy of a real planner.json with `python3 serve_planner.py --data /tmp/copy`.
- After checking out an older commit that changed serve_planner.py, restart the server.
