'use strict';
/* The sidebar: projects › threads › tasks (renderTree / renderThread / renderTaskRow), the link menu, typing new
   tasks (end-of-thread box, click-between-items insert line, multi-line paste), and drag & drop inside the sidebar
   (reorder tasks / threads, move between threads, drop a calendar chip here to unschedule it). The Conflicts
   section at the bottom of the sidebar is in conflicts.js. */
// "Collapse completed tasks" (Settings): ids of tasks in a "+ N completed" run that was clicked open (until reload)
const drOpen = new Set();
// a task's row in the sidebar, or the "+ N completed" line it's folded into
const taskEl = id => $(`.task[data-id="${id}"]`) || $(`#tree .drun[data-has~="${id}"]`);
function reveal(id) {
  const f = findTask(id); if (!f) return;
  drOpen.add(id);
  if (!ui.sbw) setSbw(ui.sbwLast || 330);
  ui.collapsed[f.p.id] = false;
  for (let x = f; x; x = x.parent ? findThread(x.parent.id) : null) ui.collapsed[x.t.id] = false;
  saveUI(); render();
  const row = $(`.task[data-id="${id}"]`); if (!row) return;
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
}

function renderTree() {
  const tree = $('#tree'), na = (state.archive || []).length + pastConfs().length;
  $('#archBtn').textContent = na ? `Archive · ${na}` : 'Archive';
  if (!state.projects.length) { tree.innerHTML = `<div class="empty">No projects yet. Click <b>+ Project</b> to start, then add threads and tasks.</div>` + renderConflicts(); return; }
  // keep any half-typed text in an open new-task box across re-renders
  const keep = {}; $$('.add', tree).forEach(i => { if (i.value) keep[(i.classList.contains('ins') ? 'ins:' : 'end:') + i.dataset.tid] = i.value; });
  tree.innerHTML = state.projects.map((p, pi) => {
    const pc = ui.collapsed[p.id], pk = p.threads.flatMap(subtreeTasks), pDone = pk.length > 0 && pk.every(k => k.done);   // fully completed: muted name
    return `<section class="proj" data-pid="${p.id}">
      <div class="prow ${pDone ? 'alldone' : ''}" data-pdrop="${p.id}">
        <button class="tw" data-act="toggle" data-id="${p.id}">${pc ? '▶' : '▼'}</button>
        <span class="pname" data-act="rename-p" data-id="${p.id}">${esc(p.name)}</span>
        <span class="acts">
          <button class="mini" data-act="add-thread" data-id="${p.id}">+ thread</button>
          ${pi > 0 ? `<button class="ic" data-act="p-up" data-id="${p.id}" title="Move up">${ICON.up}</button>` : ''}
          ${pi < state.projects.length - 1 ? `<button class="ic" data-act="p-down" data-id="${p.id}" title="Move down">${ICON.down}</button>` : ''}
          <button class="ic" data-act="arch-p" data-id="${p.id}" title="Archive">${ICON.archive}</button>
          <button class="ic" data-act="del-p" data-id="${p.id}" title="Delete">${ICON.trash}</button>
        </span>
      </div>
      ${pc ? '' : `<div class="threads">${p.threads.map(t => renderThread(p, t, false)).join('') || `<div class="empty small">No threads yet — hover the project and click <b>+ thread</b>.</div>`}</div>`}
    </section>`;
  }).join('') + renderConflicts();
  $$('.add', tree).forEach(i => { const v = keep[(i.classList.contains('ins') ? 'ins:' : 'end:') + i.dataset.tid]; if (v) i.value = v; });
  if (inserting) { const inp = $('.add.ins'); if (inp) inp.focus(); else inserting = null; }
  else if (focusAdd) { const inp = $(`.add[data-tid="${focusAdd}"]:not(.ins)`); if (inp) inp.focus(); }
  focusAdd = null;
  if (cfAdding) syncConflictForm();
}
function renderThread(p, t, isSub) {
  const tc = ui.collapsed[t.id], c = colorOf(t);
  const all = subtreeTasks(t);
  const uns = all.filter(x => !x.date && !x.done).length, done = all.filter(x => x.done).length;
  const allDone = all.length > 0 && done === all.length;   // fully completed (sub-threads included): muted dot
  let body = '';
  if (!tc) {
    const L = layout(t); let i = 0;
    const insAt = inserting && inserting.tid === t.id ? layoutIndex(L, inserting.refId, inserting.side) : -1;
    const insBox = () => `<input class="add ins" data-tid="${t.id}" placeholder="New task (Enter to add, Esc to stop)">`;
    // collapse completed tasks: runs of 2+ done tasks in a row (no sub-thread between) fold into one line, unless the
    // whole thread is done. layout index where a run starts -> index just past it
    const runs = new Map();
    if (ui.collapseDone && !allDone) for (let a = 0; a < L.length;) {
      if (L[a].kind !== 'task' || !L[a].obj.done) { a++; continue; }
      let b = a; while (b < L.length && L[b].kind === 'task' && L[b].obj.done) b++;
      if (b - a >= 2) runs.set(a, b);
      a = b;
    }
    while (i < L.length) {
      if (i === insAt) body += insBox();
      const end = runs.get(i);
      if (end) {   // the run's line; clicked open, its tasks follow as usual
        const ks = L.slice(i, end).map(x => x.obj), open = ks.some(k => drOpen.has(k.id));
        body += doneRunLine(t, ks, open);
        if (!open) { if (insAt > i && insAt < end) body += insBox(); i = end; continue; }
      }
      if (L[i].kind === 'task') { const k = L[i].obj; body += renderTaskRow(t, k, t.tasks.indexOf(k)); i++; }
      else {                       // consecutive sub-threads = one parallel block
        let blk = ''; do { blk += renderThread(p, L[i].obj, true); i++; } while (i < L.length && L[i].kind === 'sub' && i !== insAt);
        body += `<div class="subs">${blk}</div>`;
      }
    }
    if (insAt === L.length) body += insBox();
    const empty = !L.length;
    if (empty || addOpen === t.id) body += `<input class="add${empty && addOpen !== t.id ? ' idle' : ''}" data-tid="${t.id}" placeholder="${empty && addOpen !== t.id ? '+ Add task' : 'New task at the end (Enter to add, Esc to stop)'}">`;
  }
  return `<div class="thread" data-tid="${t.id}" style="--c:${esc(c)}">
    <div class="trow ${allDone ? 'alldone' : ''}" draggable="true" data-tdrag="${t.id}">
      <button class="tw" data-act="toggle" data-id="${t.id}">${tc ? '▶' : '▼'}</button>
      <label class="dot"><input type="color" value="${esc(c)}" data-act="color" data-id="${t.id}"></label>
      <span class="tname" data-act="rename-t" data-id="${t.id}">${esc(t.name)}</span>
      <span class="meta">${done}/${all.length}${uns ? ` · ${uns} unsched.` : ''}</span>
      <span class="acts">
        <button class="mini" data-act="add-task" data-id="${t.id}">+ task</button>
        <button class="mini" data-act="add-sub" data-id="${t.id}">+ sub</button>
        ${isSub && t.color ? `<button class="mini" data-act="color-reset" data-id="${t.id}">auto color</button>` : ''}
        <button class="ic" data-act="arch-t" data-id="${t.id}" title="Archive">${ICON.archive}</button>
        <button class="ic" data-act="del-t" data-id="${t.id}" title="Delete">${ICON.trash}</button>
      </span>
    </div>
    ${tc ? '' : `<div class="tasks">${body}</div>`}
  </div>`;
}
// "+ N completed" (or, opened, "− N completed" above those tasks). A linked chain crossing into the run carries its
// bar and number box into the line, fading out (top half: link from the task above; bottom half: link to the task
// below); above an opened run the line sits inside that link, so it carries straight through.
function doneRunLine(t, ks, open) {
  const a = t.tasks.indexOf(ks[0]), b = t.tasks.indexOf(ks[ks.length - 1]), nx = t.tasks[b + 1];
  const up = a > 0 ? ks[0].linkToPrev : null, dn = open ? up : nx && nx.linkToPrev;
  const k = { sameDay: 's', nextDay: 'n' };
  const cls = ['drun', open && 'open', up && 'lu', dn && 'ld', up && 'u' + k[up], dn && 'd' + k[dn]].filter(Boolean).join(' ');
  return `<div class="${cls}" data-act="dr-toggle" data-has="${ks.map(x => x.id).join(' ')}" title="${open ? 'Hide' : 'Show'} these completed tasks">
    <input type="checkbox" class="drk" tabindex="-1" aria-hidden="true" disabled><span class="drn"></span><span class="drt">${open ? '−' : '+'} ${ks.length} completed</span></div>`;
}
function renderTaskRow(t, k, i) {
  const nx = t.tasks[i + 1];
  const starts = !k.linkToPrev && nx && nx.linkToPrev;
  const ends = k.linkToPrev && !(nx && nx.linkToPrev);
  const cls = ['task', k.done && 'done', (k.linkToPrev || starts) && 'g', starts && 'gs', ends && 'ge'].filter(Boolean).join(' ');
  // number boxes for linked chains: a box opens at a chain start or a next-day step, and runs through same-day links
  const inChain = k.linkToPrev || (nx && nx.linkToPrev);
  const numCls = ['num', inChain && 'nb', inChain && k.linkToPrev !== 'sameDay' && 'nbs', inChain && !(nx && nx.linkToPrev === 'sameDay') && 'nbe',
    k.linkToPrev === 'nextDay' && 'cin', nx && nx.linkToPrev === 'nextDay' && 'cout'].filter(Boolean).join(' ');
  return `<div class="${cls}" draggable="true" data-id="${k.id}">
    <input type="checkbox" data-act="done" data-id="${k.id}" ${k.done ? 'checked' : ''}>
    <span class="${numCls}">${i + 1}</span>
    <span class="title" data-act="rename-k" data-id="${k.id}">${esc(k.title)}</span>
    <span class="rt">
      <span class="acts">
        ${i > 0 ? `<button class="ic" data-act="linkmenu" title="Link to previous task">${ICON.link}</button>` : ''}
        <button class="ic" data-act="arch-k" title="Archive">${ICON.archive}</button>
        <button class="ic" data-act="del-k" title="Delete">${ICON.trash}</button>
      </span>
      ${k.done ? '' : `<button class="date ${k.date ? '' : 'none'}" data-act="date" ${k.date ? `title="${fmtLong(k.date)}"` : ''}>${k.date ? fmtRelative(k.date) : 'no date'}</button>`}
    </span>
  </div>`;
}

/* ---------- link menu ---------- */
function openLinkMenu(id, btn) {
  const f = findTask(id); if (!f) return;
  const cur = f.task.linkToPrev, n = f.i;
  const opt = (v, k, label) => `<button data-act="setlink" data-v="${v}" data-id="${id}" class="${(cur || '') === v ? 'cur' : ''}"><span class="k">${k}</span>${label}</button>`;
  menu.innerHTML = ['nextDay', 'sameDay'].map(v => opt(v, LINKS[v].badge, `${LINKS[v].label} #${n}`)).join('') + opt('', '—', 'Not linked');
  const r = btn.getBoundingClientRect();
  menu.style.display = 'block';
  menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = (r.bottom + menu.offsetHeight + 6 > innerHeight ? r.top - menu.offsetHeight - 4 : r.bottom + 4) + 'px';
}
function cancelInsert() { if (!inserting && !addOpen) return; inserting = null; addOpen = null; render(); }
$('#tree').addEventListener('keydown', e => {
  if (!e.target.classList.contains('add')) return;
  if (e.key === 'Enter') { const v = e.target.value; e.target.value = ''; addTasks(e.target.dataset.tid, [v], e.target.classList.contains('ins') ? inserting : null); }
  else if (e.key === 'Escape') cancelInsert();
});
$('#tree').addEventListener('focusout', e => {
  // close an add/insert box when leaving it empty (but not when it is just being re-rendered)
  if (e.target.classList.contains('add') && !rendering && !e.target.value.trim()) setTimeout(cancelInsert, 0);
});
$('#tree').addEventListener('paste', e => {
  if (!e.target.classList.contains('add')) return;
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (/\r?\n/.test(text.trim())) { e.preventDefault(); addTasks(e.target.dataset.tid, text.split(/\r?\n/), e.target.classList.contains('ins') ? inserting : null); }
});
$('#tree').addEventListener('scroll', closeMenu);

$('#tree').addEventListener('mouseover', e => { if (drag) return; const r = e.target.closest('.task'); setHL(r ? r.dataset.id : null); });
$('#tree').addEventListener('mouseleave', () => setHL(null));

const tree = $('#tree');
function clearTdrop() { $$('.tdrop').forEach(x => x.classList.remove('tdrop')); dropline.style.display = 'none'; }
const showLine = (y, x) => showGuide(dropline, y, x, tree.getBoundingClientRect().right);
// left edge of the column a thread block sits in (its parent's task column, or the project's thread list)
const colLeft = thEl => (thEl.parentElement.closest('.tasks, .threads') || thEl).getBoundingClientRect().left;
// true only in the padding strip at the bottom of a thread block (not its indented left margin)
function inBottomGap(el, y) {
  if (!el.classList.contains('thread')) return false;
  const r = el.getBoundingClientRect(), pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
  return pad > 0 && y >= r.bottom - pad - 1;
}
// what a drop on the sidebar would do: unschedule (from calendar), insert task(s) at a position, or move a thread
function treeTarget(e) {
  if (!drag) return null;
  if (drag.from === 'cal') return { type: 'unsched' };
  const isTask = drag.kind === 'task';
  const f = isTask ? findTask(drag.id) : findThread(drag.id); if (!f) return null;
  let tg = null;
  const row = e.target.closest('.task'), tr = e.target.closest('.trow'), pr = e.target.closest('.prow');
  // a thread placed relative to its own block: before it, or after its whole block
  const aroundThread = (thEl, side) => {
    const x = findThread(thEl.dataset.tid); if (!x) return null;
    if (!isTask && inSubtree(f.t, x.t.id)) return null;
    if (!x.parent && isTask) return null;                // tasks can't sit between top-level threads
    const r = thEl.getBoundingClientRect(), pad = parseFloat(getComputedStyle(thEl).paddingBottom) || 0;
    return { spot: x.parent ? { tid: x.parent.id, refId: x.t.id, side } : { pid: x.p.id, refId: x.t.id, side },
             line: [side === 'before' ? r.top : r.bottom - pad, colLeft(thEl)] };
  };
  if (row) {                                             // before/after a task
    const g = findTask(row.dataset.id); if (!g) return null;
    if (!isTask && inSubtree(f.t, g.t.id)) return null;
    const r = row.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
    const [s, en] = runOf(g.t, g.i);                     // snap to the edges of a linked chain
    const anchor = g.t.tasks[before ? s : en];
    if (isTask && movingIds(drag.id, splitHeld(e)).includes(anchor.id)) return null;
    const ar = taskEl(anchor.id).getBoundingClientRect();
    tg = { spot: { tid: g.t.id, refId: anchor.id, side: before ? 'before' : 'after' }, line: [before ? ar.top : ar.bottom, ar.left] };
  } else if (tr) {                                       // thread header: top edge = before it; otherwise into it
    const thEl = tr.closest('.thread'), x = findThread(tr.dataset.tdrag); if (!x) return null;
    const r = tr.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
    const shut = ui.collapsed[x.t.id] || (!x.t.tasks.length && !x.t.threads.length);
    if (y < .3 && !(isTask && !x.parent)) tg = aroundThread(thEl, 'before');
    else if (y > .7 && shut && !(isTask && !x.parent)) tg = aroundThread(thEl, 'after');   // collapsed/empty: bottom edge = after it
    else {
      if (!isTask && inSubtree(f.t, x.t.id)) return null;
      tg = { spot: { tid: x.t.id }, el: tr };
    }
  } else if (inBottomGap(e.target, e.clientY)) {          // the gap under a thread block = after the whole block
    tg = aroundThread(e.target, 'after');
  } else if (pr && !isTask) {
    tg = { spot: { pid: pr.dataset.pdrop }, el: pr };
  }
  if (!tg) return null;
  if (isTask ? isNoopTasks(drag.id, splitHeld(e), tg.spot) : isNoopThread(drag.id, tg.spot)) return null;   // no guide for "where it already is"
  if (tg.line && tg.spot.tid) {                          // same canonical line as click-to-insert for the same position
    const L = layout(findThread(tg.spot.tid).t);
    tg.line = spotLine(tg.spot.tid, layoutIndex(L, tg.spot.refId, tg.spot.side)) || tg.line;
  }
  tg.type = isTask ? 'tasks' : 'thread';
  return tg;
}
tree.addEventListener('dragover', e => {
  const tg = treeTarget(e); clearTdrop();
  if (!tg) { tree.classList.remove('drop'); return; }
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  if (tg.type === 'unsched') tree.classList.add('drop');
  else if (tg.line) showLine(tg.line[0], tg.line[1]);
  else if (tg.el) tg.el.classList.add('tdrop');
});
tree.addEventListener('dragleave', e => { if (!tree.contains(e.relatedTarget)) { tree.classList.remove('drop'); clearTdrop(); } });
/* click-to-insert: hovering the seam between two items (or just under a thread's name, or in the gap under a
   sub-thread) shows a "+" line; clicking there opens a new-task box at exactly that spot */
const EDGE = 5;
// one canonical guide line per position in a thread's list (position `at` in its layout), so the zones on
// either side of a seam (e.g. "after sub-thread A" and "before sub-thread B") show the very same line
function spotLine(tid, at) {
  const x = findThread(tid), thEl = $(`.thread[data-tid="${tid}"]`); if (!x || !thEl) return null;
  const tasksEl = thEl.querySelector(':scope > .tasks'), tr = thEl.querySelector(':scope > .trow').getBoundingClientRect();
  const left = tasksEl ? tasksEl.getBoundingClientRect().left : tr.left + 20;
  const L = layout(x.t);
  const elOf = it => it.kind === 'task' ? taskEl(it.obj.id) : $(`.thread[data-tid="${it.obj.id}"]`);
  let y;
  if (at < L.length && elOf(L[at])) y = elOf(L[at]).getBoundingClientRect().top;
  else if (L.length && elOf(L[L.length - 1])) y = elOf(L[L.length - 1]).getBoundingClientRect().bottom;
  else y = tr.bottom;
  return [y, left];
}
function insertSpot(e) {
  if (drag || e.target.closest('input, button, label, .add, .inl, #menu')) return null;
  const y = e.clientY, row = e.target.closest('.task'), tr = e.target.closest('.trow');
  let s = null;
  if (row) {
    const g = findTask(row.dataset.id); if (!g) return null;
    const r = row.getBoundingClientRect();
    const isLast = !row.nextElementSibling || !row.nextElementSibling.matches('.task, .subs');   // last item in its list
    if (y - r.top <= EDGE) s = { tid: g.t.id, refId: g.task.id, side: 'before' };
    else if (r.bottom - y <= (isLast ? 9 : EDGE)) s = { tid: g.t.id, refId: g.task.id, side: 'after' };
  } else if (tr) {
    const x = findThread(tr.dataset.tdrag); if (!x) return null;
    const r = tr.getBoundingClientRect();
    if (x.parent && y - r.top <= EDGE) s = { tid: x.parent.id, refId: x.t.id, side: 'before' };       // just above a sub-thread
    else if (r.bottom - y <= EDGE && !ui.collapsed[x.t.id]) {                                         // just under a thread's name: first in its list
      const L = layout(x.t); s = { tid: x.t.id, refId: L.length ? L[0].obj.id : null, side: 'before' };
    }
  } else if (e.target.classList.contains('tasks')) {      // the space under a thread's last item: add at its end
    const last = e.target.lastElementChild, th = e.target.closest('.thread');
    if (th && last && !last.matches('.add') && y >= last.getBoundingClientRect().bottom) s = { tid: th.dataset.tid, refId: null, side: 'before' };
  } else if (inBottomGap(e.target, y)) {                 // the gap under a sub-thread: after it
    const x = findThread(e.target.dataset.tid); if (x && x.parent) s = { tid: x.parent.id, refId: x.t.id, side: 'after' };
  }
  if (!s) return null;
  // canonical form: "before item #at" (or the end), so both sides of a seam are one and the same target
  const L = layout(findThread(s.tid).t), at = layoutIndex(L, s.refId, s.side);
  s = at < L.length ? { tid: s.tid, refId: L[at].obj.id, side: 'before' } : { tid: s.tid, refId: null, side: 'before' };
  s.line = spotLine(s.tid, at);
  return s.line ? s : null;
}
tree.addEventListener('mousemove', e => {
  const s = insertSpot(e);
  if (!s) return hideInsline();
  showGuide(insline, s.line[0], s.line[1], tree.getBoundingClientRect().right);
});
tree.addEventListener('mouseleave', hideInsline);
tree.addEventListener('scroll', hideInsline);
tree.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const s = insertSpot(e); if (!s) return;
  e.preventDefault(); hideInsline();
  addOpen = null; inserting = { tid: s.tid, refId: s.refId, side: s.side };
  render();
});
tree.addEventListener('drop', e => {
  const tg = treeTarget(e); if (!tg) return;
  e.preventDefault(); tree.classList.remove('drop'); clearTdrop();
  const id = drag.id; drag = null;
  if (tg.type === 'unsched') moveTask(id, null);
  else if (tg.type === 'tasks') moveTasksTo(id, splitHeld(e), tg.spot);
  else moveThreadTo(id, tg.spot);
});
