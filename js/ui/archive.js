'use strict';
/* The Archive window (searchable list of archived projects / threads / tasks and past conflicts). The archive
   and restore operations themselves are in core/ops.js. */
/* the Archive window: a searchable list, newest first; each entry shows where it came from and when it was
   archived, can be expanded to see what was in it, and restored or deleted */
let archQuery = '', archOpen = new Set();
function showArchive() {
  closeMenu();
  framedModal('Archive', '');
  const card = $('#modal .card'); card.classList.add('wide', 'arch');
  card.oninput = e => { if (e.target.classList.contains('arch-q')) { archQuery = e.target.value; renderArchive(false); } };
  card.onclick = e => {
    const b = e.target.closest('[data-arch]'); if (!b) return;
    const id = b.closest('[data-eid]') && b.closest('[data-eid]').dataset.eid;
    if (b.dataset.arch === 'restore') restoreEntry(id);
    else if (b.dataset.arch === 'delete') deleteEntry(id);
    else if (b.dataset.arch === 'delete-cf') delConflict(b.closest('[data-cfid]').dataset.cfid);
    else if (b.dataset.arch === 'toggle') { archOpen.has(id) ? archOpen.delete(id) : archOpen.add(id); }
    else if (b.dataset.arch === 'close') return hideModal();
    renderArchive(false);
  };
  renderArchive(true);
}
// read-only outline of what an archived thread / project contained
function archOutline(threads) {
  const taskLine = k => `<li class="${k.done ? 'done' : ''}"><span class="ck">${k.done ? '✓' : ''}</span>${esc(k.title)}${k.date ? `<span class="d">${fmtShort(k.date)}</span>` : ''}</li>`;
  const th = t => `<li class="th"><b>${esc(t.name)}</b><ul>${layout(t).map(x => x.kind === 'task' ? taskLine(x.obj) : th(x.obj)).join('') || '<li class="none">(empty)</li>'}</ul></li>`;
  return `<ul class="ao">${threads.map(th).join('')}</ul>`;
}
function renderArchive(first) {
  const body = $('#modal .mbody'); if (!body || !$('#modal .card.arch')) return;
  const top = body.scrollTop, list = state.archive || [];
  const q = archQuery.trim().toLowerCase();
  const nameOf = e => e.kind === 'task' ? e.item.title : e.item.name;
  const shown = list.filter(e => !q || (nameOf(e) + ' ' + (e.from.path || []).join(' ')).toLowerCase().includes(q));
  const pastC = pastConfs().filter(c => !q || c.title.toLowerCase().includes(q)).sort((a, b) => a.start < b.start ? 1 : -1);
  const rows = shown.map(e => {
    const tg = restoreTarget(e), open = archOpen.has(e.id);
    let info = '';
    if (e.kind === 'task') info = [e.item.done ? 'done' : 'not done', e.item.date ? fmtShort(e.item.date) : 'no date'].join(' · ');
    else {
      const all = e.kind === 'project' ? e.item.threads.flatMap(subtreeTasks) : subtreeTasks(e.item);
      info = `${plural(all.length, 'task')}, ${all.filter(k => k.done).length} done`;
    }
    const from = (e.from.path || []).length ? `in ${esc(e.from.path.join(' › '))} · ` : '';
    const contents = e.kind === 'task' ? '' : open ? archOutline(e.kind === 'project' ? e.item.threads : [e.item]) : '';
    return `<div class="ar" data-eid="${e.id}">
      <div class="ar-main">
        <div class="ar-t"><span class="kind">${e.kind === 'thread' && e.from.parentTid ? 'sub-thread' : e.kind}</span><b>${esc(nameOf(e))}</b></div>
        <div class="ar-s">${from}${info} · archived ${fmtShort(e.at)}${e.kind !== 'task' ? ` · <button class="lnk" data-arch="toggle">${open ? 'hide contents' : 'show contents'}</button>` : ''}</div>
        ${!tg.ok ? `<div class="ar-w">${esc(tg.why)}</div>` : ''}
        ${contents}
      </div>
      <div class="ar-b">
        <button class="btn" data-arch="restore" ${tg.ok ? '' : 'disabled'} ${tg.ok ? '' : `title="${esc(tg.why)}"`}>Restore</button>
        <button class="ic" data-arch="delete" title="Delete">${ICON.trash}</button>
      </div></div>`;
  }).join('');
  const hadFocus = document.activeElement && document.activeElement.classList.contains('arch-q');
  body.innerHTML = `
    <input class="arch-q" placeholder="Search the archive" value="${esc(archQuery)}" spellcheck="false">
    ${list.length || pastConfs().length ? '' : '<p class="sub">Nothing archived yet. Hover a project, thread or task in the sidebar and click the box icon to archive it: it disappears from the sidebar but is kept here (and stays on the calendar), and can be restored to where it was.</p>'}
    ${(list.length || pastConfs().length) && !shown.length && !pastC.length ? '<p class="sub">Nothing matches.</p>' : ''}
    <div class="ar-list">${rows}${pastC.map(c => `<div class="ar" data-cfid="${c.id}">
      <div class="ar-main"><div class="ar-t"><span class="kind">conflict</span><b>${esc(c.title)}</b></div>
        <div class="ar-s">${cfSpan(c)} · past</div></div>
      <div class="ar-b"><button class="ic" data-arch="delete-cf" title="Delete">${ICON.trash}</button></div></div>`).join('')}</div>
    <div class="row"><button class="btn primary" data-arch="close">Done</button></div>`;
  body.scrollTop = top;
  const qi = body.querySelector('.arch-q');
  if (first || hadFocus) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
}
