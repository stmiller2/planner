'use strict';
/* `ui`: this browser's view preferences and settings (saved in localStorage, not in planner.json), plus a little
   transient view state shared between views. Every saved preference is declared once in UI_PREFS:
     def      default value
     ok(v)    whether a stored value is acceptable (otherwise the default is used)
     key      name in localStorage, when it differs
     setting  true = part of the Settings window ("Restore defaults" resets it) */
const DAY_HOURS = [4, 6, 8, 10, 12, 16, 24];   // choices for how many hours the day view fits in the window
const isBool = v => typeof v === 'boolean', isNum = v => typeof v === 'number', oneOf = (...xs) => v => xs.includes(v);
const UI_PREFS = {
  weeks:         { def: 3, ok: oneOf(2, 3, 4), key: 'weeks3', setting: true },
  weekStart:     { def: 1, ok: oneOf(0, 1), setting: true },
  narrowWe:      { def: true, ok: isBool, setting: true },
  shiftLater:    { def: true, ok: isBool, setting: true },
  dayHours:      { def: 8, ok: oneOf(...DAY_HOURS), setting: true },
  snap:          { def: 15, ok: oneOf(5, 10, 15, 30), setting: true },
  clock:         { def: '12', ok: oneOf('12', '24'), setting: true },
  dateLabels:    { def: 'relative', ok: oneOf('relative', 'absolute'), setting: true },
  collapseDone:  { def: false, ok: isBool, setting: true },                   // sidebar: 2+ done tasks in a row -> one "+ N completed" line
  confirmDelete: { def: true, ok: isBool, setting: true },
  orderWarn:     { def: true, ok: isBool, setting: true },
  conflictWarn:  { def: true, ok: isBool, setting: true },
  theme:         { def: 'auto', ok: oneOf('auto', 'light', 'dark') },
  collapsed:     { def: () => ({}), ok: v => !!v && typeof v === 'object' },   // project / thread id -> collapsed in the sidebar
  sbw:           { def: 330, ok: isNum },                                     // sidebar width (0 = hidden)
  sbwLast:       { def: 330, ok: isNum },
  dayCount:      { def: 1, ok: oneOf(1, 2, 3, 4, 5) },                         // days shown side by side in day view
  scratchCal:    { def: false, ok: isBool, setting: true },                    // scratch board open when you go to the calendar
  scratchDay:    { def: true, ok: isBool, setting: true },                     // … and when you go to day view
  scratchRemember: { def: false, ok: isBool, setting: true },                 // true: it stays open / closed as you left it (the two above are ignored)
  scratchOpen:   { def: false, ok: isBool },                                   // whether it was open last (used when remembering)
  scwLast:       { def: 280, ok: isNum },                                      // scratch board width (while open)
  admPlanned:    { def: false, ok: isBool },                                   // timeline: show future tasks
  admSide:       { def: null, ok: isNum },                                     // timeline: list width (null = automatic)
  admWave:       { def: null, ok: isNum },                                     // timeline: wave height
};
const prefDefault = k => typeof UI_PREFS[k].def === 'function' ? UI_PREFS[k].def() : UI_PREFS[k].def;

function loadUI() {
  let u = {};
  try { u = JSON.parse(localStorage.getItem('planner.ui') || '{}'); } catch (e) {}
  const out = {};
  for (const [k, p] of Object.entries(UI_PREFS)) { const v = u[p.key || k]; out[k] = p.ok(v) ? v : prefDefault(k); }
  // dayView: the date open in day view (null = calendar); scw: the scratch board's width now (0 = closed; it opens or
  // closes per view as set in Settings, or stays as last left: see scratchForView)
  return { ...out, dayView: null, scw: (out.scratchRemember ? out.scratchOpen : out.scratchCal) ? out.scwLast : 0 };
}
function saveUI() {
  const out = {};
  for (const [k, p] of Object.entries(UI_PREFS)) out[p.key || k] = ui[k];
  try { localStorage.setItem('planner.ui', JSON.stringify(out)); } catch (e) {}
}
function resetSettings() { for (const [k, p] of Object.entries(UI_PREFS)) if (p.setting) ui[k] = prefDefault(k); }

const ui = loadUI();
ui.viewStart = weekStartOf(todayISO());   // first day shown on the calendar

// sidebar "new task" boxes (shared by the sidebar and the operations that add tasks)
let focusAdd = null;    // thread id whose add box should take focus after the next render
let inserting = null;   // { tid, refId, side } while an in-list "new task" box is open
let addOpen = null;     // thread id whose "add at end" input is open
