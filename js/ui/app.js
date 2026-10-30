'use strict';
/* The app shell: render() (redraws every view after a change), the header, sidebar width, theme, and the
   document-wide click / change / double-click / keyboard handlers that dispatch on data-act attributes. */

/* ---------- rendering ---------- */
let rendering = false;     // true while render() runs (focus changes during it aren't the user's)
let calStale = false;      // the calendar skipped a render while day view / the timeline covered it
function render() {
  rendering = true; computeColors(); renderHeader(); renderTree(); renderScratch();
  if (ui.dayView || admOpen) calStale = true; else { calStale = false; renderCal(); }
  renderDay(); renderAdmire(); rendering = false; if (hl) setHL(hl, true);
}

let dataLoaded = false;
const DEFAULT_TITLE = 'Experiment planner';   // the planner's name until it's renamed (state.title)
function renderHeader() {
  let name;
  if (dataLoaded) { name = state.title || DEFAULT_TITLE; try { localStorage.setItem('planner.title', name); } catch (e) {} }
  else { try { name = localStorage.getItem('planner.title'); } catch (e) {} name = name || DEFAULT_TITLE; }
  const bn = $('.brand .bname'), bi = bn.querySelector('input'); if (!bi || bi.dataset.done) bn.textContent = name;   // don't wipe the box mid-rename
  document.title = name;
  setRange();
  const cur = admOpen ? '-' : ui.dayView ? 'd' : 'c';
  $$('#wkcount button').forEach(b => b.classList.toggle('on', +b.dataset.n === ui.weeks));
  $$('.views button').forEach(b => b.classList.toggle('on', b.dataset.view === cur));
}
// the dates in view, beside ‹ Today ›: the calendar's weeks, or day view's day(s) (`first` = day view's first day)
function setRange(first = ui.dayView) {
  if (first) { $('#range').textContent = dvTitle(first); return; }
  const end = addDays(ui.viewStart, ui.weeks * 7 - 1);
  const s = parseD(ui.viewStart), e = parseD(end);
  $('#range').textContent = `${MON[s.getMonth()]} ${s.getDate()}${s.getFullYear() !== e.getFullYear() ? ', ' + s.getFullYear() : ''} – ${MON[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}

/* ---------- sidebar resize ---------- */
// collapsed (ui.sbw = 0), the sidebar and day view's task list keep a slim labeled tab (like the scratch board's)
const SB_TAB = 30;
function setSbw(w) {
  ui.sbw = w; if (w) ui.sbwLast = w;
  $('#app').style.setProperty('--sbw', (w || SB_TAB) + 'px');
  $('#app').classList.toggle('sbhidden', !w);
}
const rz = $('#resizer');
rz.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault(); rz.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
  const move = ev => { let w = Math.round(ev.clientX); if (w < 100) w = 0; setSbw(Math.min(w, Math.round(innerWidth * 0.6))); };
  const up = () => { rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); saveUI(); };
  rz.addEventListener('pointermove', move); rz.addEventListener('pointerup', up);
});
rz.addEventListener('dblclick', () => { setSbw(ui.sbw ? 0 : (ui.sbwLast || 330)); saveUI(); render(); });
const sbTab = label => `<button class="sc-tab sb-tab" data-act="sb-show" title="Show sidebar (double-click its edge)">${ICON.dright}<span>${label}</span></button>`;
$('aside').insertAdjacentHTML('afterbegin', sbTab('Projects / Conflicts'));

/* ---------- events ---------- */
document.addEventListener('click', e => {
  if (!e.target.closest('#menu') && !e.target.closest('[data-act="linkmenu"]')) closeMenu();
  if (e.target.closest('.inl')) return;            // clicks inside a rename box just move the cursor
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  const id = a.dataset.id || (a.closest('[data-id]') || {}).dataset?.id;
  switch (act) {
    case 'toggle': ui.collapsed[id] = !ui.collapsed[id]; saveUI(); render(); break;
    case 'add-thread': addThread(id); break;
    case 'add-cf': addConflict(); break;
    case 'cf-cancel': cfAdding = false; dhint.style.display = 'none'; render(); break;
    case 'del-c': delConflict(id); break;
    case 'cf-s': case 'cf-e': {
      const c = confs().find(x => x.id === id); if (!c) break;
      if (act === 'cf-s') editDateIn(a, { value: c.start, placeholder: 'Start', commit: v => setConflictDates(id, v, c.start ? addDays(v, diffDays(c.end, c.start)) : v) });
      else editDateIn(a, { value: c.end !== c.start ? c.end : null, allowEmpty: true, emptyText: 'one day', min: c.start, placeholder: 'End', commit: v => setConflictDates(id, c.start, v || c.start) });
      break;
    }
    case 'del-p': delProject(id); break;
    case 'arch-p': archiveProject(id); break;
    case 'p-up': moveProject(id, -1); break;
    case 'p-down': moveProject(id, 1); break;
    case 'del-t': delThread(id); break;
    case 'arch-t': archiveThread(id); break;
    case 'add-sub': addSubThread(id); break;
    case 'add-task': inserting = null; addOpen = id; focusAdd = id; ui.collapsed[id] = false; saveUI(); render(); break;
    case 'color-reset': { const f = findThread(id); if (f) mutate(() => f.t.color = null); break; }
    case 'linkmenu': openLinkMenu(id, a); break;
    case 'setlink': closeMenu(); setLink(id, a.dataset.v); break;
    case 'unsched': moveTask(id, null); break;
    case 'del-k': delTask(id); break;
    case 'arch-k': archiveTask(id); break;
    case 'date': { const f = findTask(id); if (f) editDateIn(a, { value: f.task.date, allowEmpty: true, emptyText: 'no date (unscheduled)', commit: v => moveTask(id, v), clear: f.task.date ? () => moveTask(id, null) : null }); break; }
    case 'reveal': clearTimeout(revealTimer); if (e.detail === 1) revealTimer = setTimeout(() => reveal(id), 250); break;
    case 'openday': openDay(a.dataset.date); break;
    case 'sc-del': delScratch(id); break;
    case 'sc-clear': { const n = clearDoneScratch(); if (n) toast(`Deleted ${plural(n, 'completed task')}. ⌘Z to undo.`); break; }
    case 'sc-hide': toggleScratch(false); break;
    case 'sc-show': toggleScratch(true); break;
    case 'sb-show': setSbw(Math.max(100, ui.sbwLast || 330)); saveUI(); render(); break;
    case 'dr-toggle': {   // a "+ N completed" line in the sidebar: show / hide those tasks
      const ids = a.dataset.has.split(' '), open = ids.some(x => drOpen.has(x));
      ids.forEach(x => open ? drOpen.delete(x) : drOpen.add(x)); render(); break;
    }
    case 'unplan': { const f = findTask(id); if (f) mutate(() => { delete f.task.plan; }); break; }
  }
});
document.addEventListener('change', e => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'done') { const f = findTask(a.dataset.id); if (f) mutate(() => f.task.done = a.checked); }
  else if (a.dataset.act === 'sc-done') setScratchDone(a.dataset.id, a.checked);
  else if (a.dataset.act === 'color') { const f = findThread(a.dataset.id); if (f) mutate(() => f.t.color = a.value); }
});
document.addEventListener('input', e => {
  if (e.target.dataset && e.target.dataset.act === 'color') {
    const id = e.target.dataset.id, v = e.target.value;
    const th = e.target.closest('.thread'); if (th) th.style.setProperty('--c', v);
    $$(`.chip[data-thread="${id}"]`).forEach(c => c.style.setProperty('--c', v));
  }
});
document.addEventListener('dblclick', e => {
  // a task's title on the calendar (week view chip, day-view block or list item)
  const tt = e.target.closest('.chip .tt, .dv-blk .tt, .dv-item .tt');
  if (tt) {
    if (tt.querySelector('input')) return;
    clearTimeout(revealTimer); closeTimePop(false); hideTip();
    return startRename('k', tt.closest('[data-id]').dataset.id, tt);
  }
  const a = e.target.closest('[data-act^="rename-"]'); if (!a || a.querySelector('input')) return;
  startRename(a.dataset.act.slice(7), a.dataset.id, a.dataset.act === 'rename-c' ? a : undefined);
});
// Clicking anywhere outside an open, empty new-task box closes it, but the re-render waits until the click
// has landed, so a button clicked while the box is open (e.g. "+ sub") works on the first click.
document.addEventListener('mousedown', e => {
  const box = document.querySelector('#tree .add:not(.idle), #dayview .dvadd');
  if (!box || box.contains(e.target) || box.value.trim() || (!inserting && !addOpen && !dvAdd)) return;
  inserting = null; addOpen = null; dvAdd = null;
  document.addEventListener('mouseup', () => setTimeout(() => { if (document.contains(box)) render(); }, 0), { once: true });
}, true);
// header: ‹ Today › (and ← / → / T) step the calendar a week or day view a day, sliding just like a scroll does
function navStep(dir) {
  if (!ui.dayView) return weekShift(dir);
  if (!dv && !cfDrag) daySlide(dir);
}
// Today: a quick slide to it. From far away, the view first jumps to TODAY_SLIDE steps short of today and slides
// the rest of the way, so the slide stays short. (Already there: day view just scrolls the hours to now, as openDay does.)
const TODAY_SLIDE = 6;
function navToday() {
  const t = todayISO();
  if (ui.dayView) {
    const n = diffDays(t, ui.dayView);
    if (!n || dv || cfDrag) return openDay(t);
    if (dayAnim) dayAnim.finish();
    const dir = Math.sign(n), m = Math.min(Math.abs(n), TODAY_SLIDE);
    if (Math.abs(n) > m) { ui.dayView = addDays(t, -dir * m); dvAdd = null; renderDay(); }
    return daySlide(dir, m);
  }
  if (weekAnim) weekAnim.finish();
  const w = weekStartOf(t), n = diffDays(w, ui.viewStart) / 7;
  if (!n) return;
  const dir = Math.sign(n), m = Math.min(Math.abs(n), TODAY_SLIDE);
  if (Math.abs(n) > m) { ui.viewStart = addDays(w, -7 * dir * m); render(); }
  weekShift(dir, m);
}
$('#prev').onclick = () => navStep(-1);
$('#next').onclick = () => navStep(1);
$('#todayBtn').onclick = navToday;
// view switcher beside the planner's name
$$('.views button').forEach(b => { b.innerHTML = ICON[{ c: 'calendar', d: 'day', '-': 'timeline' }[b.dataset.view]]; b.onclick = () => switchView(b.dataset.view); });
// day view: how many days side by side
$('#dvcount').innerHTML = [1, 2, 3, 4, 5].map(n => `<button data-n="${n}"><span>${n}</span><span class="dl">${n > 1 ? ' days' : ' day'}</span></button>`).join('');
$('#dvcount').onclick = e => { const b = e.target.closest('button'); if (b) { b.blur(); setDayCount(+b.dataset.n); } };   // (blur: no focus ring left behind once you use the keys)
// calendar: how many weeks (also keys 1–5)
$('#wkcount').innerHTML = [1, 2, 3, 4, 5].map(n => `<button data-n="${n}"><span>${n}</span><span class="dl">${n > 1 ? ' weeks' : ' week'}</span></button>`).join('');
$('#wkcount').onclick = e => { const b = e.target.closest('button'); if (b) { b.blur(); setWeekCount(+b.dataset.n); } };
function setWeekCount(n) {
  if (ui.dayView || admOpen || n === ui.weeks) return;
  if (weekAnim) weekAnim.finish();
  ui.weeks = n; saveUI(); render();
}
// day view: (also keys 1–5) a slide in progress lands first
function setDayCount(n) {
  if (!ui.dayView || dv || cfDrag || n === ui.dayCount) return;
  if (dayAnim) dayAnim.finish(); else if (dayStrip) exitStrip(null);
  ui.dayCount = n; dvAdd = null; saveUI(); renderDay();
}
$('#addProject').onclick = addProject;
$('#archBtn').onclick = showArchive;
$('#warnUndo').onclick = () => { undo(); hideWarn(); };
$('#warnClose').onclick = hideWarn;
$('#helpBtn').onclick = showHelp;
$('#setBtn').innerHTML = ICON.gear;
$('#setBtn').onclick = showSettings;
// theme: Auto (follow macOS) → Light → Dark. The page always carries the theme in effect (data-theme="light" / "dark"),
// so the CSS needs only one dark palette; Planner.html's <head> sets it before the first paint.
const osDark = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = ui.theme === 'auto' ? (osDark.matches ? 'dark' : 'light') : ui.theme;
  const b = $('#themeBtn'); b.innerHTML = ICON[ui.theme === 'auto' ? 'auto' : ui.theme === 'dark' ? 'moon' : 'sun'];
}
$('#themeBtn').onclick = () => { ui.theme = { auto: 'light', light: 'dark', dark: 'auto' }[ui.theme]; saveUI(); applyTheme(); };
osDark.addEventListener('change', applyTheme);
applyTheme();
$('#status').onclick = () => showStorageInfo();   // (storage.js loads after this file)
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });   // keep 'Today'/'Mon' labels current
// C / D / - : switch to the calendar, day view or timeline. Day view opens on today, or on the first day shown
// when the calendar is on other weeks.
function switchView(k) {
  if (k === '-') { if (!admOpen) openAdmire(); return; }
  if (admOpen) closeAdmire();
  if (k === 'c' && ui.dayView) closeDay();
  else if (k === 'd' && !ui.dayView) {
    const t = todayISO(), shown = t >= ui.viewStart && t <= addDays(ui.viewStart, ui.weeks * 7 - 1);
    openDay(shown ? t : ui.viewStart);
  }
}
document.addEventListener('keydown', e => {
  const modalOpen = $('#modal').style.display === 'grid', mod = e.metaKey || e.ctrlKey;
  // ⌘, / Ctrl+, / Ctrl+Shift+, (e.code: Shift turns the key into '<')
  if (mod && e.code === 'Comma') { e.preventDefault(); if (!modalOpen) showSettings(); return; }
  if (e.key === 'Escape') {
    closeMenu();
    if (tpop) { closeTimePop(false); return; }
    if (admOpen && !modalOpen) { closeAdmire(); return; }
    if (modalOpen) { if ($('#modal').dataset.dismiss) hideModal(); }
    else if (ui.dayView && !e.target.closest('input,textarea,select')) closeDay();
  }
  if (e.target.closest('input:not([type=checkbox]),textarea,select')) return;   // typing in a box (a ticked checkbox doesn't count)
  if (modalOpen) {
    // in Help or Settings, a letter shortcut closes the window and then does its thing (H in Help / S in Settings just
    // close it). Other windows, and the arrow keys (they scroll the window), are left alone.
    const kind = $('#modal').dataset.kind, k = e.key.toLowerCase();
    if (!kind || mod || e.altKey || !['c', 'd', '-', 't', 'h', 's', 'x'].includes(k)) return;
    hideModal();
    if (k === kind[0]) return;   // 'h'elp / 's'ettings
  }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (!mod && !e.altKey && ['c', 'd', '-'].includes(e.key.toLowerCase())) switchView(e.key.toLowerCase());
  else if (!mod && !e.altKey && e.key.toLowerCase() === 'h') { closeMenu(); showHelp(); }
  else if (!mod && !e.altKey && e.key.toLowerCase() === 's') showSettings();
  else if (admOpen) return;
  else if (!mod && !e.altKey && e.key.toLowerCase() === 'x') toggleScratch();
  else if (!mod && !e.altKey && e.key.toLowerCase() === 'n' && ui.scratchOn && ui.scw) { e.preventDefault(); scNew(); }   // (no 'n' typed into the box)
  else if (!mod && !e.altKey && /^[1-5]$/.test(e.key)) ui.dayView ? setDayCount(+e.key) : setWeekCount(+e.key);
  else if (!mod && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); navStep(-1); }
  else if (!mod && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) { e.preventDefault(); navStep(1); }
  else if (!mod && e.key.toLowerCase() === 't') navToday();
});
