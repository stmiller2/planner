'use strict';
/* Loading and saving planner.json. start() picks one of three ways:
     server    the page came from serve_planner.py (the normal setup): the server reads and writes planner.json,
               keeps daily backups, and refuses a save if the file changed since it was loaded (ETag)
     fs        opened straight from disk in Chrome: planner.json in a folder you choose (File System Access);
               this page keeps the daily backups itself
     fallback  opened from disk in a browser without file access (e.g. Safari): kept in this browser, with
               Export / Import buttons for the file
   What the server and folder ways share lives here once: reading the file (and refusing to touch one that isn't
   valid JSON), saving shortly after each change, the "changed on disk" choice, and picking up outside edits
   when the window regains focus. Each backend below only says how to read, write and spot outside changes. */

let MODE = null;            // 'server' | 'fs' | 'fallback'
let dirty = false;          // changes not yet saved
let blocked = false;        // planner.json couldn't be read: never overwrite it
let saveTimer = null, saveChain = Promise.resolve();

function setStatus(text, cls) { const s = $('#status'); s.textContent = text; s.className = cls || ''; }

/* ---------- shared ---------- */
// the file's text as data (null = empty file); if it isn't valid JSON, block saving, say so, and return undefined
function readData(text, fix, buttons = '') {
  if (!text.trim()) return null;
  try { return JSON.parse(text); }
  catch (e) {
    blocked = true; setStatus('File unreadable', 'err');
    showModal(`<h3>planner.json couldn’t be read</h3><p>It isn’t valid JSON (${esc(e.message)}). Nothing has been overwritten. Fix the file or copy a version from <code>backups/</code>${fix}</p>${buttons}`, false);
    return undefined;
  }
}
// make loaded data the planner (fresh undo history)
function adopt(data) {
  blocked = false;
  state = data ? migrate(data) : { version: 4, projects: [] }; dataLoaded = true;
  undoStack.length = 0; redoStack.length = 0;
}
const backend = () => MODE === 'server' ? server : MODE === 'fs' ? folder : null;

function scheduleSave() {
  if (MODE === 'fallback') return saveLocal();
  const b = backend();
  if (blocked || !b || !b.ready()) return;
  dirty = true; setStatus('Unsaved', 'busy');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveChain = saveChain.then(() => writeNow()); }, 350);
}
function flushSave() { clearTimeout(saveTimer); saveChain = saveChain.then(() => writeNow()); return saveChain; }
// write the planner now; force: overwrite even if the file changed on disk
async function writeNow(force) {
  const b = backend();
  if (blocked || !b || !b.ready()) return;
  try {
    if (await b.write(JSON.stringify(state, null, 2), force) === 'conflict') return changedOnDisk(b);
    dirty = false; setStatus('Saved', 'ok');
  } catch (e) { console.error(e); b.failed(e); }
}
function changedOnDisk(b) {
  setStatus('Conflict', 'err');
  showModal(`<h3>planner.json changed on disk</h3>
    <p>The file was modified outside this window (${b.others}, or an edit). Which version do you want to keep?</p>
    <div class="row"><button class="btn primary" id="mLoad">Load the file’s version</button><button class="btn" id="mKeep">Keep this window’s version</button></div>`, false);
  $('#mLoad').onclick = () => { dirty = false; b.reload(); };
  $('#mKeep').onclick = () => { hideModal(); clearTimeout(saveTimer); saveChain = saveChain.then(() => writeNow(true)); };
}
// pick up edits made elsewhere when the window regains focus (unless this window has unsaved changes)
window.addEventListener('focus', async () => {
  const b = backend();
  if (!b || !b.ready() || blocked || dirty) return;
  try {
    const got = await b.poll(); if (!got) return;
    state = migrate(JSON.parse(got.text)); got.seen();
    undoStack.length = 0; redoStack.length = 0; render(); toast('Loaded newer planner.json from disk.');
  } catch (e) {}
});
window.addEventListener('beforeunload', e => {
  if (dirty) { flushSave(); e.preventDefault(); e.returnValue = ''; }
  else if (unexported()) { e.preventDefault(); e.returnValue = 'You have changes that haven’t been exported to planner.json yet.'; }   // Safari etc.
});
// the status button in the header: where the data lives
// where the plan is kept, as HTML for Help and Settings
function dataWhereHTML() {
  if (MODE === 'server') return `<code class="path">${esc(server.file)}</code>`;
  if (MODE === 'fs' && folder.dir) return `<code>planner.json</code> in the folder “${esc(folder.dir.name)}” you chose (browsers don’t reveal a folder’s full path)`;
  if (MODE === 'fallback') return 'this browser’s own storage, not a file (Export saves a copy as <code>planner.json</code>)';
  return 'nowhere yet (no data file connected)';
}
function showStorageInfo() { if (MODE === 'fs') showConnect(folder.dir, null, true); else if (MODE === 'server') server.info(); }

/* ---------- the local Planner server ---------- */
const server = {
  api: '/api/data', tag: null, file: '', retry: null,
  others: 'another Planner window',
  ready: () => true,
  fetch() { return fetch(this.api, { cache: 'no-store', headers: this.tag ? { 'If-None-Match': this.tag } : {} }); },
  async probe() {   // the server's first answer, if this page came from it
    if (!/^https?:$/.test(location.protocol)) return null;
    try { const r = await fetch(this.api, { cache: 'no-store' }); return (r.status === 200 || r.status === 204) ? r : null; } catch (e) { return null; }
  },
  async open(r) {
    setStatus('Loading…', 'busy');
    this.tag = r.headers.get('ETag'); this.file = decodeURIComponent(r.headers.get('X-Planner-File') || 'planner.json');
    this.fixed = r.headers.get('X-Planner-Fixed') === '1';   // folder given for this run (--data): Settings can't change it
    const data = readData(r.status === 200 ? await r.text() : '', ' next to it, then reopen Planner.');
    if (data === undefined) return;
    adopt(data);
    hideModal(); hideWarn(); render(); setStatus('Saved', 'ok');
    if (!data || data.version !== state.version) { dirty = true; await writeNow(); }   // new or older-format file: save it now
  },
  async write(text, force) {
    clearTimeout(this.retry);
    setStatus('Saving…', 'busy');
    const headers = { 'Content-Type': 'application/json' };
    if (this.tag && !force) headers['If-Match'] = this.tag;   // refused (412) if the file changed since
    const r = await fetch(this.api, { method: 'PUT', headers, body: text, cache: 'no-store' });
    if (r.status === 412) return 'conflict';
    if (!r.ok) throw new Error((await r.text()) || 'HTTP ' + r.status);
    this.tag = r.headers.get('ETag');
  },
  failed(e) {
    setStatus('Not saved', 'err');
    toast('Couldn’t reach the Planner server to save (' + e.message + '). Your changes are kept in this window and will be retried.', 6000);
    this.retry = setTimeout(() => { if (dirty) flushSave(); }, 5000);
  },
  async poll() {
    const r = await this.fetch(); if (r.status !== 200) return null;
    const tag = r.headers.get('ETag'), text = await r.text();
    return { text, seen: () => { this.tag = tag; } };
  },
  // Settings > Data file: ask the server to use another folder ({ folder, action: 'check' | 'move' | 'open' })
  async setFolder(folder, action) {
    const r = await fetch('/api/folder', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder, action }), cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    if (action !== 'check' && j.file) { this.file = j.file; if (j.etag) this.tag = j.etag; }
    return j;
  },
  async reload() { this.tag = null; try { await this.open(await this.fetch()); } catch (e) { setStatus('Not connected', 'err'); } },
  info() {
    showModal(`<h3>Data file</h3><p>Saving to <code>${esc(this.file)}</code> through the Planner server on this computer. One copy per day is kept in the <code>backups</code> folder next to it (last 14).</p>
    <div class="row"><button class="btn primary" id="mClose">Close</button></div>`);
    $('#mClose').onclick = hideModal;
  },
};

/* ---------- a folder chosen in Chrome (File System Access) ---------- */
const folder = {
  dir: null, file: null, mod: 0,          // the folder, planner.json in it, and its last-modified time as we last saw it
  others: 'another tab, a sync service',
  ready() { return !!this.file; },
  // carry: a folder chosen to move to; if it has no planner.json yet, the current plan is saved there (not a blank one)
  async open(h, carry) {
    setStatus('Loading…', 'busy');
    try {
      const fh = await h.getFileHandle('planner.json', { create: true });
      const file = await fh.getFile(), text = await file.text();
      if (carry && !text.trim() && dataLoaded) {
        this.dir = h; this.file = fh; this.mod = file.lastModified;
        dirty = true; await writeNow(true);
        hideModal(); render(); toast(`Your plan is now saved in “${h.name}”.`);
        return;
      }
      const data = readData(text, ', then reload this page.', '<div class="row"><button class="btn" id="mChoose">Choose a different folder…</button></div>');
      if (data === undefined) { $('#mChoose').onclick = chooseFolder; return; }
      this.dir = h; this.file = fh; this.mod = file.lastModified;
      adopt(data);
      if (!text.trim()) await writeNow();
      else { this.backup(text); if (data.version !== state.version) await writeNow(); }
      hideModal(); hideWarn(); render(); setStatus('Saved', 'ok');
    } catch (e) {
      setStatus('Not connected', 'err');
      showConnect(h, 'Could not open the folder: ' + e.message);
    }
  },
  async write(text, force) {
    const cur = await this.file.getFile();
    if (!force && this.mod && cur.lastModified !== this.mod) return 'conflict';
    setStatus('Saving…', 'busy');
    const w = await this.file.createWritable();
    await w.write(text);
    await w.close();
    this.mod = (await this.file.getFile()).lastModified;
  },
  failed(e) {
    setStatus('Save failed', 'err');
    toast('Could not save planner.json: ' + e.message + ' — click the status to reconnect.', 6000);
  },
  async poll() {
    const f = await this.file.getFile(); if (f.lastModified === this.mod) return null;
    return { text: await f.text(), seen: () => { this.mod = f.lastModified; } };
  },
  reload() { this.open(this.dir); },
  // the first time the file is opened each day, keep a copy of it as it was in backups/ (the last 14 days)
  async backup(text) {
    try {
      const b = await this.dir.getDirectoryHandle('backups', { create: true });
      const name = `planner-${todayISO()}.json`;
      let exists = true; try { await b.getFileHandle(name); } catch (e) { exists = false; }
      if (!exists) { const fh = await b.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(text); await w.close(); }
      const names = [];
      for await (const [n] of b.entries()) if (/^planner-\d{4}-\d{2}-\d{2}\.json$/.test(n)) names.push(n);
      names.sort(); while (names.length > 14) await b.removeEntry(names.shift());
    } catch (e) { console.warn('Backup failed', e); }
  },
};
// the folder is remembered between visits (IndexedDB can hold the folder handle; localStorage can't)
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('planner', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  try { const db = await idb(); return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  catch (e) { return null; }
}
async function kvSet(k, v) {
  try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  catch (e) {}
}
function showConnect(h, err, fromStatus) {
  const fh = folder.file, open = fromStatus && fh;
  setStatus(fh ? (dirty ? 'Unsaved' : 'Saved') : 'Not connected', fh ? (dirty ? 'busy' : 'ok') : 'err');
  showModal(`<h3>${open ? 'Data folder' : 'Open your planner data'}</h3>
    ${open ? `<p>Saving to <code>${esc(folder.dir.name)}/planner.json</code>. Backups are in <code>${esc(folder.dir.name)}/backups/</code>.</p>` :
    `<p>Choose the folder that holds (or should hold) your <code>planner.json</code>. The file is created if it doesn’t exist, and saved automatically after every change.</p>
    <p class="sub">A folder of its own, such as <code>PlannerData</code> in your home folder, keeps your plan apart from the app’s code (it’s also where the Planner server keeps it, so you can switch between the two).</p>`}
    ${err ? `<p style="color:var(--danger)">${esc(err)}</p>` : ''}
    <div class="row">
      ${h && !open ? `<button class="btn primary" id="mRe">Open “${esc(h.name)}”</button>` : ''}
      <button class="btn ${h ? '' : 'primary'}" id="mChoose">${h ? 'Choose a different folder…' : 'Choose folder…'}</button>
      ${open ? `<button class="btn primary" id="mClose">Close</button>` : ''}
    </div>
    ${h && !open ? `<p class="sub" style="margin-top:14px">When Planner is installed as an app, Chrome remembers this permission. Otherwise it asks once per session; if it offers “Allow on every visit”, choose that.</p>` : ''}`,
    !!open);
  if ($('#mRe')) $('#mRe').onclick = async () => {
    try { if (await h.requestPermission({ mode: 'readwrite' }) === 'granted') folder.open(h); }
    catch (e) { showConnect(null, 'That folder is no longer available: ' + e.message); }
  };
  $('#mChoose').onclick = chooseFolder;
  if ($('#mClose')) $('#mClose').onclick = hideModal;
}
async function chooseFolder(carry) {
  let h;
  try { h = await window.showDirectoryPicker({ id: 'planner', mode: 'readwrite' }); }
  catch (e) { if (e.name !== 'AbortError') showConnect(null, e.message); return; }
  if (dirty && folder.file) await flushSave();
  await kvSet('dir', h);
  folder.open(h, carry === true);
}

/* ---------- this browser only (no file access) ----------
   The data lives in localStorage; we remember what was last exported so we can warn about changes that haven't
   been exported yet (on screen and when closing the tab). */
let lastExported = null;
const unexported = () => MODE === 'fallback' && lastExported !== null && JSON.stringify(state) !== lastExported;
function fbStatus() {
  const u = unexported();
  setStatus(u ? 'Not exported' : 'Exported', u ? 'busy' : 'ok');
  $('#exportBtn').classList.toggle('primary', u);
  $('#exportBtn').title = u ? 'Changes since your last export — export to save them to a file' : 'planner.json is up to date';
}
function markExported() { lastExported = JSON.stringify(state); try { localStorage.setItem('planner.exported', lastExported); } catch (e) {} }
function startFallback() {
  try { const s = localStorage.getItem('planner.data'); if (s) state = migrate(JSON.parse(s)); } catch (e) {}
  dataLoaded = true;
  try { lastExported = localStorage.getItem('planner.exported'); } catch (e) {}
  if (lastExported === null) markExported();   // first visit: nothing to lose yet
  $('#fb').hidden = false;
  fbStatus();
  render();
  toast('This browser can’t write to files. Open this page in Chrome for planner.json, or use Export/Import here.', 7000);
}
function saveLocal() { try { localStorage.setItem('planner.data', JSON.stringify(state)); } catch (e) {} fbStatus(); }
$('#exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  a.download = 'planner.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  markExported(); fbStatus();
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = migrate(JSON.parse(await f.text())); mutate(() => { state = d; });
    markExported(); fbStatus(); toast('Imported ' + f.name);
  }
  catch (err) { toast('Import failed: ' + err.message); }
  e.target.value = '';
};

/* ---------- start-up ---------- */
async function start() {
  setSbw(ui.sbw);
  render();
  const r = await server.probe();
  if (r) { MODE = 'server'; return server.open(r); }
  if (typeof window.showDirectoryPicker !== 'function') { MODE = 'fallback'; return startFallback(); }
  MODE = 'fs';
  const h = await kvGet('dir');
  if (h) {
    let p = 'prompt';
    try { p = await h.queryPermission({ mode: 'readwrite' }); } catch (e) {}
    if (p === 'granted') return folder.open(h);
  }
  showConnect(h || null);
}
