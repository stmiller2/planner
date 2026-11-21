/* The online Planner. Cloudflare serves the app's files (dist/, made by worker/build.js); this Worker answers
   /api/data the same way serve_planner.py does on your own computer, so js/storage.js needs no second protocol:

     GET  /api/data   the signed-in person's plan: 200 + JSON, 204 (no plan yet) or 304 (unchanged since If-None-Match)
     PUT  /api/data   save it; refused with 412 if If-Match no longer names the saved version

   Who is signed in comes from Cloudflare Access, which sits in front of the whole site (email + one-time code).
   Access adds a signed token (Cf-Access-Jwt-Assertion) to every request it lets through; the Worker checks that
   signature against Access's public keys and uses the email inside as the account. Nothing else is trusted.

   Settings (wrangler.jsonc "vars"): ACCESS_TEAM_DOMAIN (https://<team>.cloudflareaccess.com) and ACCESS_AUD
   (the Access application's Audience tag). With either missing, every request is refused.
   DEV_USER (.dev.vars, read only by `wrangler dev`) stands in for Access on localhost while testing. */

const MAX_BYTES = 1_900_000;   // a D1 row holds at most 2,000,000 bytes
const KEEP_BACKUPS = 14;       // daily copies kept per person
const NONE = '"none"';         // the version tag of "no plan yet" (as serve_planner.py)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname !== '/api/data') return reply(404, 'Not found');
      let email;
      try { email = await signedInEmail(request, env, url); }
      catch (e) { return reply(401, 'Not signed in: ' + e.message); }
      if (request.method === 'GET' || request.method === 'HEAD') return await load(request, env, email);
      if (request.method === 'PUT') return await save(request, env, email, url);
      return reply(405, 'Method not allowed', { Allow: 'GET, HEAD, PUT' });
    } catch (e) {
      console.error(e);
      return reply(503, `The database couldn’t be reached (${e.message})`);
    }
  },
};

/* ---------- the plan ---------- */
const tagOf = version => `"v${version}"`;
// a version tag as the browser sent it back ("v3", W/"v3"), or null for none
const cleanTag = t => (t == null ? null : t.trim().replace(/^W\//, ''));

async function load(request, env, email) {
  const row = await env.DB.prepare('SELECT data, version FROM plans WHERE email = ?1').bind(email).first();
  const tag = row ? tagOf(row.version) : NONE;
  const headers = { ...who(email, tag) };
  if (!row) return reply(204, null, headers);
  if (cleanTag(request.headers.get('If-None-Match')) === tag) return reply(304, null, headers);
  return reply(200, request.method === 'HEAD' ? null : row.data, { ...headers, 'Content-Type': 'application/json' });
}

async function save(request, env, email, url) {
  // only the app itself saves: same-origin requests with JSON bodies (other sites can't send those)
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== url.origin) return reply(403, 'Forbidden origin');
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return reply(415, 'Expected application/json');
  const body = await request.text();
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > MAX_BYTES) return reply(413, `Your plan is too large to save online (${(bytes / 1e6).toFixed(2)} MB of max ${MAX_BYTES / 1e6} MB). Try archiving or deleting old projects to make it smaller.`);
  try {
    const doc = JSON.parse(body);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.projects)) throw new Error('not a planner document');
  } catch (e) { return reply(400, 'Refusing to save: ' + e.message); }

  const want = cleanTag(request.headers.get('If-Match'));   // null or "*": save over whatever is there
  const today = new Date().toISOString().slice(0, 10);
  const db = env.DB;
  // the plan as it was, once per day, before it's overwritten; then only the newest KEEP_BACKUPS copies stay
  const backup = cond => db.prepare(`INSERT OR IGNORE INTO backups (email, day, data) SELECT email, ?2, data FROM plans WHERE email = ?1${cond}`);
  const prune = db.prepare(`DELETE FROM backups WHERE email = ?1 AND day NOT IN
    (SELECT day FROM backups WHERE email = ?1 ORDER BY day DESC LIMIT ${KEEP_BACKUPS})`).bind(email);
  let stmts, at;   // at: which statement's RETURNING row says it saved
  if (want === NONE) {                       // the first save of a new plan: only if there still is none
    stmts = [db.prepare(`INSERT INTO plans (email, data) VALUES (?1, ?2) ON CONFLICT (email) DO NOTHING RETURNING version`).bind(email, body)];
    at = 0;
  } else if (want === null || want === '*') {
    stmts = [backup('').bind(email, today),
      db.prepare(`INSERT INTO plans (email, data) VALUES (?1, ?2) ON CONFLICT (email) DO UPDATE
        SET data = excluded.data, version = plans.version + 1, updated_at = datetime('now') RETURNING version`).bind(email, body),
      prune];
    at = 1;
  } else {
    const m = /^"v(\d+)"$/.exec(want);
    if (!m) return conflict(db, email);
    const v = Number(m[1]);
    stmts = [backup(' AND version = ?3').bind(email, today, v),
      db.prepare(`UPDATE plans SET data = ?2, version = version + 1, updated_at = datetime('now')
        WHERE email = ?1 AND version = ?3 RETURNING version`).bind(email, body, v),
      prune];
    at = 1;
  }
  const res = await db.batch(stmts);         // one transaction: all of it happens or none
  const row = res[at].results && res[at].results[0];
  if (!row) return conflict(db, email);
  return reply(200, 'saved', who(email, tagOf(row.version)));
}

// 412: the plan was saved from somewhere else since this window loaded it (the app asks which to keep)
async function conflict(db, email) {
  const row = await db.prepare('SELECT version FROM plans WHERE email = ?1').bind(email).first();
  return reply(412, 'Your plan was saved from another window or device since this one loaded it', who(email, row ? tagOf(row.version) : NONE));
}

// headers the app reads: the version (ETag, repeated in X-Planner-Version in case a proxy rewrites ETags), and
// that this is the online planner and whose plan it is
const who = (email, tag) => ({ ETag: tag, 'X-Planner-Version': tag, 'X-Planner-Hosted': '1', 'X-Planner-User': encodeURIComponent(email) });

function reply(status, body, headers = {}) {
  const h = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  if (body !== null && !h.has('Content-Type')) h.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(status === 204 || status === 304 ? null : body, { status, headers: h });
}

/* ---------- who is signed in ---------- */
async function signedInEmail(request, env, url) {
  // `wrangler dev` on your own computer only: there is no Access there, so DEV_USER stands in. Both conditions are
  // needed: DEV_USER is never uploaded (.dev.vars), and Cloudflare never delivers a request for "localhost".
  if (env.DEV_USER && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return String(env.DEV_USER).trim().toLowerCase();
  const team = teamDomain(env.ACCESS_TEAM_DOMAIN), aud = (env.ACCESS_AUD || '').trim();
  if (!team || !aud) throw new Error('ACCESS_TEAM_DOMAIN and ACCESS_AUD aren’t set in wrangler.jsonc');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new Error('no Access token');
  const claims = await verifyAccessToken(token, team, aud);
  return String(claims.email).trim().toLowerCase();
}
// "yourteam", "yourteam.cloudflareaccess.com" or "https://yourteam.cloudflareaccess.com/" -> https://yourteam.cloudflareaccess.com
function teamDomain(s) {
  s = (s || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https:\/\//.test(s)) s = 'https://' + s.replace(/^http:\/\//, '');
  if (!/\.[a-z]/i.test(s.slice(8))) s += '.cloudflareaccess.com';
  return s;
}

// Access's public signing keys, kept for an hour (they rotate rarely; an unknown key id fetches them again)
let keyCache = { team: '', at: 0, keys: [] };
async function accessKeys(team, fresh) {
  const age = Date.now() - keyCache.at;
  if (keyCache.team !== team || age > 3600e3 || (fresh && age > 60e3)) {
    const r = await fetch(team + '/cdn-cgi/access/certs');
    if (!r.ok) throw new Error('couldn’t fetch Access keys (HTTP ' + r.status + ')');
    keyCache = { team, at: Date.now(), keys: (await r.json()).keys || [] };
  }
  return keyCache.keys;
}

const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const b64json = s => JSON.parse(new TextDecoder().decode(b64(s)));

async function verifyAccessToken(token, team, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  let header, claims;
  try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch (e) { throw new Error('malformed token'); }
  if (header.alg !== 'RS256') throw new Error('unexpected token type');
  let jwk = (await accessKeys(team)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await accessKeys(team, true)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('token signed by an unknown key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('bad token signature');
  const now = Date.now() / 1000;
  if (typeof claims.exp !== 'number' || claims.exp < now - 30) throw new Error('token expired');
  if (typeof claims.nbf === 'number' && claims.nbf > now + 30) throw new Error('token not valid yet');
  if (claims.iss !== team) throw new Error('token from another Access team');
  if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(aud)) throw new Error('token for another application');
  if (!claims.email) throw new Error('token has no email');
  return claims;
}
