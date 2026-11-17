-- Online Planner (worker/index.js): one plan per signed-in person, plus one copy of it per day (last 14).
-- Applied with:  npx wrangler d1 migrations apply planner --remote   (--local for `wrangler dev`)

-- email: the address the person signed in with (Cloudflare Access), lower-cased; it is the account
-- data: the planner.json text; version: bumped on every save (the app's ETag)
CREATE TABLE plans (
  email      TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- the plan as it was before the first save of each day (UTC), like backups/ next to planner.json
CREATE TABLE backups (
  email TEXT NOT NULL,
  day   TEXT NOT NULL,          -- YYYY-MM-DD
  data  TEXT NOT NULL,
  PRIMARY KEY (email, day)
);
