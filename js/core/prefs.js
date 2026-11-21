'use strict';
/* `ui`: view preferences and settings, plus a little transient view state shared between views. All of it is kept in
   this browser (localStorage); the Settings-window ones (setting: true) and some view preferences (sync: true: weeks
   shown, collapsed threads…) also travel with the plan (state.settings in planner.json / the online account:
   settingsToPlan / settingsFromPlan below), so every browser and device using the plan shows the same. Sizes (sidebar,
   Timeline list) and the theme stay per browser.
   Every saved preference is declared once in UI_PREFS:
     def      default value
     ok(v)    whether a stored value is acceptable (otherwise the default is used)
     key      name in localStorage, when it differs
     setting  true = part of the Settings window ("Restore defaults" resets it); travels with the plan
     sync     true = travels with the plan too, but isn't a Settings-window one
     phoneKey (sync) its name in the plan on a phone (MOBILE), which keeps its own: weeks shown
     was      (optional) the value for a browser that already has saved settings from before this preference existed,
              when that differs from the default for a new install (so adding a preference doesn't change anyone's setup) */
const DAY_HOURS = [4, 6, 8, 10, 12, 16, 24];   // choices for how many hours the day view fits in the window
const isBool = v => typeof v === 'boolean', isNum = v => typeof v === 'number', oneOf = (...xs) => v => xs.includes(v);
const UI_PREFS = {
  weeks:         { def: 3, ok: oneOf(1, 2, 3, 4, 5), key: 'weeks3', sync: true, phoneKey: 'weeksPhone' },   // weeks shown on the calendar (header buttons / keys 1–5)
  weekStart:     { def: 1, ok: oneOf(0, 1), setting: true },
  narrowWe:      { def: true, ok: isBool, setting: true },
  shiftLater:    { def: true, ok: isBool, setting: true },
  keepTimes:     { def: false, ok: isBool, setting: true },                    // a task moved to another day keeps its day-view time (keepTimes, model.js)
  dayHours:      { def: 8, ok: oneOf(...DAY_HOURS), setting: true },
  snap:          { def: 15, ok: oneOf(5, 10, 15, 30), setting: true },
  clock:         { def: '12', ok: oneOf('12', '24'), setting: true },
  dateLabels:    { def: 'relative', ok: oneOf('relative', 'absolute'), setting: true },
  collapseDone:  { def: true, ok: isBool, setting: true },                   // sidebar: 2+ done tasks in a row -> one "+ N completed" line
  confirmDelete: { def: true, ok: isBool, setting: true },
  orderWarn:     { def: true, ok: isBool, setting: true },
  conflictWarn:  { def: true, ok: isBool, setting: true },
  theme:         { def: 'auto', ok: oneOf('auto', 'light', 'dark') },
  collapsed:     { def: () => ({}), ok: v => !!v && typeof v === 'object' && !Array.isArray(v), sync: true },   // project / thread id -> collapsed in the sidebar
  sbw:           { def: 330, ok: isNum },                                     // sidebar width (0 = hidden)
  sbwLast:       { def: 330, ok: isNum },
  dayCount:      { def: 1, ok: oneOf(1, 2, 3, 4, 5), sync: true },             // days shown side by side in day view
  admPlanned:    { def: false, ok: isBool, sync: true },                       // timeline: show future tasks
  admSide:       { def: null, ok: isNum },                                     // timeline: list width (null = automatic)
  admWave:       { def: null, ok: isNum },                                     // timeline: wave height
};
const prefDefault = k => typeof UI_PREFS[k].def === 'function' ? UI_PREFS[k].def() : UI_PREFS[k].def;

function loadUI() {
  let u = {};
  try { u = JSON.parse(localStorage.getItem('planner.ui') || '{}'); } catch (e) {}
  const out = {}, fresh = !Object.keys(u).length;   // (fresh: nothing saved yet, a new install)
  for (const [k, p] of Object.entries(UI_PREFS)) { const v = u[p.key || k]; out[k] = p.ok(v) ? v : !fresh && 'was' in p ? p.was : prefDefault(k); }
  // dayView: the date open in day view (null = calendar)
  return { ...out, dayView: null };
}
function saveUI() {
  const out = {};
  for (const [k, p] of Object.entries(UI_PREFS)) out[p.key || k] = ui[k];
  try { localStorage.setItem('planner.ui', JSON.stringify(out)); } catch (e) {}
  // (a preference that travels with the plan changed: the plan gets it, and is saved; not before the plan is loaded)
  if (typeof dataLoaded !== 'undefined' && dataLoaded && typeof scheduleSave === 'function' && settingsToPlan()) scheduleSave();
}
function resetSettings() { for (const [k, p] of Object.entries(UI_PREFS)) if (p.setting) ui[k] = prefDefault(k); }
// the plan's copy of the settings (and the view preferences that travel with them): written when they change here
// (true: it changed, so the plan needs saving)…
const SETTING_KEYS = Object.keys(UI_PREFS).filter(k => UI_PREFS[k].setting || UI_PREFS[k].sync);
const onPhone = () => typeof MOBILE !== 'undefined' && !!MOBILE;
const planKey = k => UI_PREFS[k].phoneKey && onPhone() ? UI_PREFS[k].phoneKey : k;
function settingsToPlan() {
  if (!state) return false;
  const old = state.settings || {}, s = {};
  for (const k of SETTING_KEYS) {
    s[planKey(k)] = ui[k] && typeof ui[k] === 'object' ? JSON.parse(JSON.stringify(ui[k])) : ui[k];   // (a copy: ui's is changed in place)
    const other = UI_PREFS[k].phoneKey && (onPhone() ? k : UI_PREFS[k].phoneKey);   // (the other kind of screen's: kept)
    if (other && other in old) s[other] = old[other];
  }
  if (JSON.stringify(s) === JSON.stringify(state.settings || null)) return false;
  state.settings = s; touch(); return true;
}
// …and taken from it whenever the plan is drawn (loaded, reloaded from elsewhere, imported): the keys that changed
function settingsFromPlan() {
  const s = state && state.settings; if (!s) return [];
  const same = (a, b) => a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b));
  const changed = SETTING_KEYS.filter(k => UI_PREFS[k].ok(s[planKey(k)]) && !same(ui[k], s[planKey(k)]));
  changed.forEach(k => { const v = s[planKey(k)]; ui[k] = typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; });
  if (changed.length) saveUI();
  return changed;
}

const ui = loadUI();
ui.viewStart = weekStartOf(todayISO());   // first day shown on the calendar

// sidebar "new task" boxes (shared by the sidebar and the operations that add tasks)
let focusAdd = null;    // thread id whose add box should take focus after the next render
let inserting = null;   // { tid, refId, side } while an in-list "new task" box is open
let addOpen = null;     // thread id whose "add at end" input is open
