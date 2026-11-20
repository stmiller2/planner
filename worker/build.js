/* Copies the app's files into dist/, the folder Cloudflare publishes (see "assets" in wrangler.jsonc). Run
   automatically by `wrangler dev` and `wrangler deploy`. Only these files go online, the same ones
   serve_planner.py hands out; Planner.html is also index.html so the site opens at "/". */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'dist');
const FILES = ['Planner.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const DIRS = ['css', 'js'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
fs.copyFileSync(path.join(ROOT, 'Planner.html'), path.join(OUT, 'index.html'));
for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true, filter: src => !path.basename(src).startsWith('.') && (fs.statSync(src).isDirectory() || /\.(css|js)$/.test(src)) });
console.log('Planner: app files copied to dist/');
