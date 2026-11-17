// The online Planner's Worker (worker/index.js): sign-in checks, loading / saving with versions, daily backups.
// Runs it against an in-memory SQLite database standing in for D1 (node:sqlite, Node 22.13+) and Access tokens
// signed with a key made up here, so no Cloudflare account is needed.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

const TEAM = 'https://lab.cloudflareaccess.com', AUD = 'aud-123', SITE = 'https://planner.lab.workers.dev';
const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8');

// a D1-shaped wrapper around node:sqlite: prepare().bind().first() / .all(), batch() as one transaction
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    exec: () => db.prepare(sql).all(...args),
  });
  return {
    raw: db,
    prepare: sql => stmt(sql),
    batch: async list => {
      db.exec('BEGIN');
      try { const out = list.map(s => ({ results: s.exec() })); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

let worker, keys, jwk;
const enc = s => Buffer.from(typeof s === 'string' ? s : JSON.stringify(s)).toString('base64url');
async function token(claims = {}, { key = keys.privateKey, kid = 'k1' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = enc({ alg: 'RS256', kid }) + '.' + enc({ iss: TEAM, aud: [AUD], email: 'Silas@Example.org', exp: now + 3600, iat: now, ...claims });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, Buffer.from(body));
  return body + '.' + Buffer.from(sig).toString('base64url');
}

test.before(async () => {
  worker = (await import('../worker/index.js')).default;
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  globalThis.fetch = async url => {   // Access's public keys
    assert.strictEqual(String(url), TEAM + '/cdn-cgi/access/certs');
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } });
  };
});

const envFor = (db, extra = {}) => ({ DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...extra });
async function call(env, { method = 'GET', tok, headers = {}, body, url = SITE + '/api/data' } = {}) {
  const h = { ...headers };
  if (tok) h['Cf-Access-Jwt-Assertion'] = tok;
  if (body !== undefined && !('Content-Type' in h)) h['Content-Type'] = 'application/json';
  const r = await worker.fetch(new Request(url, { method, headers: h, body }), env);
  return { status: r.status, h: r.headers, text: await r.text() };
}
const doc = n => JSON.stringify({ version: 5, projects: [], n }, null, 2);

test('no sign-in, or Access not set up: refused', async () => {
  const db = fakeD1();
  assert.strictEqual((await call(envFor(db))).status, 401);
  assert.strictEqual((await call(envFor(db, { ACCESS_AUD: '' }), { tok: await token() })).status, 401);
  assert.strictEqual((await call(envFor(db), { tok: 'not.a.token' })).status, 401);
});

test('tokens that are expired, for another app or team, or forged: refused', async () => {
  const env = envFor(fakeD1());
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  for (const tok of [
    await token({ exp: Math.floor(Date.now() / 1000) - 120 }),
    await token({ aud: ['someone-else'] }),
    await token({ iss: 'https://evil.cloudflareaccess.com' }),
    await token({}, { key: other.privateKey }),
    await token({}, { kid: 'unknown' }),
    await token({ email: '' }),
  ]) assert.strictEqual((await call(env, { tok })).status, 401);
  assert.strictEqual((await call(env, { tok: await token() })).status, 204);
});

test('first visit: no plan (204); first save creates it; loading gives it back with its version', async () => {
  const env = envFor(fakeD1()), tok = await token();
  let r = await call(env, { tok });
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.h.get('ETag'), '"none"');
  assert.strictEqual(r.h.get('X-Planner-Hosted'), '1');
  assert.strictEqual(decodeURIComponent(r.h.get('X-Planner-User')), 'silas@example.org');
  r = await call(env, { tok, method: 'PUT', headers: { 'If-Match': '"none"' }, body: doc(1) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.h.get('X-Planner-Version'), '"v1"');
  r = await call(env, { tok });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.text, doc(1));
  assert.strictEqual((await call(env, { tok, headers: { 'If-None-Match': '"v1"' } })).status, 304);
  assert.strictEqual((await call(env, { tok, headers: { 'If-None-Match': 'W/"v1"' } })).status, 304);
  // "none" again (a second window that also started empty) is refused
  assert.strictEqual((await call(env, { tok, method: 'PUT', headers: { 'If-Match': '"none"' }, body: doc(9) })).status, 412);
});

test('a save from a window with an old version is refused (412); without If-Match it overwrites', async () => {
  const env = envFor(fakeD1()), tok = await token();
  await call(env, { tok, method: 'PUT', headers: { 'If-Match': '"none"' }, body: doc(1) });
  let r = await call(env, { tok, method: 'PUT', headers: { 'If-Match': '"v1"' }, body: doc(2) });
  assert.strictEqual(r.h.get('ETag'), '"v2"');
  r = await call(env, { tok, method: 'PUT', headers: { 'If-Match': 'W/"v1"' }, body: doc(3) });
  assert.strictEqual(r.status, 412);
  assert.strictEqual(r.h.get('ETag'), '"v2"');
  assert.strictEqual((await call(env, { tok })).text, doc(2));
  r = await call(env, { tok, method: 'PUT', body: doc(4) });            // "Keep this window's version"
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.h.get('ETag'), '"v3"');
  assert.strictEqual((await call(env, { tok })).text, doc(4));
});

test('each person only ever sees and changes their own plan', async () => {
  const env = envFor(fakeD1());
  const a = await token(), b = await token({ email: 'labmate@example.org' });
  await call(env, { tok: a, method: 'PUT', headers: { 'If-Match': '"none"' }, body: doc('a') });
  assert.strictEqual((await call(env, { tok: b })).status, 204);
  await call(env, { tok: b, method: 'PUT', headers: { 'If-Match': '"none"' }, body: doc('b') });
  await call(env, { tok: b, method: 'PUT', body: doc('b2') });
  assert.strictEqual((await call(env, { tok: a })).text, doc('a'));
  assert.strictEqual((await call(env, { tok: b })).text, doc('b2'));
});

test('the first save of a day keeps the plan as it was; only the newest 14 copies stay', async () => {
  const db = fakeD1(), env = envFor(db), tok = await token();
  await call(env, { tok, method: 'PUT', headers: { 'If-Match': '"none"' }, body: doc(1) });
  assert.strictEqual(db.raw.prepare('SELECT COUNT(*) n FROM backups').get().n, 0);
  await call(env, { tok, method: 'PUT', headers: { 'If-Match': '"v1"' }, body: doc(2) });
  await call(env, { tok, method: 'PUT', headers: { 'If-Match': '"v2"' }, body: doc(3) });
  const today = new Date().toISOString().slice(0, 10);
  assert.deepStrictEqual(db.raw.prepare('SELECT day, data FROM backups').all().map(r => ({ ...r })), [{ day: today, data: doc(1) }]);
  // a refused save makes no copy
  const ins = db.raw.prepare('INSERT INTO backups (email, day, data) VALUES (?, ?, ?)');
  for (let i = 1; i <= 20; i++) ins.run('silas@example.org', `2020-01-${String(i).padStart(2, '0')}`, 'old');
  ins.run('labmate@example.org', '2019-01-01', 'theirs');
  db.raw.prepare("DELETE FROM backups WHERE day = ?").run(today);
  await call(env, { tok, method: 'PUT', headers: { 'If-Match': '"v1"' }, body: doc(0) });   // stale: refused
  assert.strictEqual(db.raw.prepare("SELECT COUNT(*) n FROM backups WHERE day = ?").get(today).n, 0);
  await call(env, { tok, method: 'PUT', headers: { 'If-Match': '"v3"' }, body: doc(4) });
  const days = db.raw.prepare("SELECT day FROM backups WHERE email = 'silas@example.org' ORDER BY day").all().map(r => r.day);
  assert.strictEqual(days.length, 14);
  assert.strictEqual(days[13], today);
  assert.strictEqual(days[0], '2020-01-08');
  assert.strictEqual(db.raw.prepare("SELECT COUNT(*) n FROM backups WHERE email = 'labmate@example.org'").get().n, 1);
});

test('saves that aren\'t a plan, too large, from another site, or not JSON: refused, nothing changes', async () => {
  const env = envFor(fakeD1()), tok = await token();
  await call(env, { tok, method: 'PUT', headers: { 'If-Match': '"none"' }, body: doc(1) });
  const put = (body, headers = {}) => call(env, { tok, method: 'PUT', headers: { 'If-Match': '"v1"', ...headers }, body });
  assert.strictEqual((await put('{not json')).status, 400);
  assert.strictEqual((await put('[1,2]')).status, 400);
  assert.strictEqual((await put('{"projects": 3}')).status, 400);
  assert.strictEqual((await put(JSON.stringify({ projects: [], pad: 'x'.repeat(2_000_000) }))).status, 413);
  assert.strictEqual((await put(doc(2), { Origin: 'https://evil.example' })).status, 403);
  assert.strictEqual((await put(doc(2), { 'Content-Type': 'text/plain' })).status, 415);
  assert.strictEqual((await call(env, { tok })).text, doc(1));
  assert.strictEqual((await put(doc(2), { Origin: SITE })).status, 200);
});

test('other paths and methods', async () => {
  const env = envFor(fakeD1()), tok = await token();
  assert.strictEqual((await call(env, { tok, url: SITE + '/api/folder' })).status, 404);
  assert.strictEqual((await call(env, { tok, method: 'DELETE' })).status, 405);
});

test('DEV_USER (wrangler dev) works on localhost only', async () => {
  const env = envFor(fakeD1(), { DEV_USER: 'test@localhost' });
  assert.strictEqual((await call(env)).status, 401);
  const r = await call(env, { url: 'http://localhost:8787/api/data' });
  assert.strictEqual(r.status, 204);
  assert.strictEqual(decodeURIComponent(r.h.get('X-Planner-User')), 'test@localhost');
});

test('the team domain can be given as just the team name', async () => {
  const env = envFor(fakeD1(), { ACCESS_TEAM_DOMAIN: 'lab' });
  assert.strictEqual((await call(env, { tok: await token() })).status, 204);
});
