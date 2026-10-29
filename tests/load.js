// Loads the planner's core scripts (js/core/*.js: data model, scheduling rules, operations, parsing) into a
// sandbox so tests can call them directly, without a browser. The UI hooks they call (render, toast, …) are
// stubbed and recorded in `calls`.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const CORE = ['js/core/util.js', 'js/core/parse.js', 'js/core/prefs.js', 'js/core/model.js', 'js/core/ops.js'];

function load(data, { prefs = {} } = {}) {
  const calls = { render: 0, save: 0, warn: [], toast: [], rename: [] };
  const store = { 'planner.ui': JSON.stringify(prefs) };
  const ctx = vm.createContext({
    console,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    confirm: () => true,
    // UI hooks (defined by the ui/ scripts in the app)
    render: () => { calls.render++; }, scheduleSave: () => { calls.save++; },
    showWarn: list => { calls.warn.push(list); }, hideWarn: () => {},
    toast: msg => { calls.toast.push(msg); }, startRename: (kind, id) => { calls.rename.push([kind, id]); },
  });
  for (const f of CORE) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const run = code => vm.runInContext(code, ctx);
  if (data) { ctx.__data = data; run('state = migrate(__data); touch();'); }
  // P.anything evaluates that name in the sandbox (functions, constants, `state`, `ui`)
  const P = new Proxy({}, { get: (_, k) => k === 'calls' ? calls : k === 'store' ? store : k === 'run' ? run : run(k) });
  return P;
}

// helpers for building plans: T(id, date, { done, link }) and TH(id, tasks, { threads, after, color })
const T = (id, date = null, o = {}) => ({ id, title: o.title || id, date, done: !!o.done, linkToPrev: o.link || null, ...(o.plan ? { plan: o.plan } : {}) });
const TH = (id, tasks = [], o = {}) => ({ id, name: o.name || id, color: o.color || null, tasks, threads: o.threads || [], ...('after' in o ? { afterTask: o.after } : {}) });
const plan = (threads, extra = {}) => ({ version: 4, projects: [{ id: 'p', name: 'P', threads }], ...extra });
// task id -> date, for a thread (and its sub-threads)
const dates = (P, ...ids) => Object.fromEntries(ids.map(id => [id, P.findTask(id).task.date]));

module.exports = { load, T, TH, plan, dates, ROOT };
