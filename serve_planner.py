#!/usr/bin/env python3
"""
Serves the Planner app to this computer only, at http://localhost:47823/ , and reads/writes
planner.json for it, so the app works in any browser, Safari included.

    python3 serve_planner.py                     run it (until you close the window)
    python3 serve_planner.py --set-data DIR      remember DIR as the data folder, then quit
    python3 serve_planner.py --data DIR          use DIR this time only (or PLANNER_DATA=DIR); the app's
                                                 Settings can't change the folder while this is given

The data folder holds planner.json and backups/. It's kept outside the app's own folder so the code can be
updated (git pull, a fresh copy…) without touching your plan. Which folder: --data / $PLANNER_DATA, else the
one remembered in ~/.config/planner/data-folder.txt (set by --set-data, the install scripts, or the app's
Settings > Data file), else planner.json next to this script (older setups), else ~/PlannerData.

Starting at login: mac/install-server.sh (Mac), windows/install-server.cmd (Windows).

Saving is careful:
  * each save is written to a temporary file and then swapped in, so planner.json is never half-written
  * a save is refused if planner.json changed since the app last loaded it (the app then asks which to keep)
  * the first save of each day copies the previous planner.json to backups/planner-YYYY-MM-DD.json
    (the last 14 days are kept)
"""
import datetime
import http.server
import json
import os
import shutil
import sys
import threading
import urllib.parse

PORT = 47823
HERE = os.path.dirname(os.path.abspath(__file__))


CONFIG = os.path.join(os.path.expanduser('~'), '.config', 'planner', 'data-folder.txt')


def arg(name):
    """The value given as `name VALUE` or `name=VALUE` on the command line, or None."""
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == name and i + 1 < len(args):
            return args[i + 1]
        if a.startswith(name + '='):
            return a.split('=', 1)[1]
    return None


def norm(p):
    return os.path.abspath(os.path.expanduser(p.strip()))


def remembered_folder():
    try:
        with open(CONFIG, encoding='utf-8') as f:
            return f.read().strip() or None
    except OSError:
        return None


def remember_folder(folder):
    os.makedirs(os.path.dirname(CONFIG), exist_ok=True)
    tmp = CONFIG + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(folder + '\n')
    os.replace(tmp, CONFIG)


def data_dir():
    """(folder, fixed): where planner.json lives, and whether that was given for this run only (--data or
    $PLANNER_DATA), in which case the app can't change it."""
    if arg('--data'):
        return arg('--data'), True
    if os.environ.get('PLANNER_DATA'):
        return os.environ['PLANNER_DATA'], True
    if remembered_folder():
        return remembered_folder(), False
    if os.path.exists(os.path.join(HERE, 'planner.json')):
        return HERE, False
    return os.path.join(os.path.expanduser('~'), 'PlannerData'), False


_dir, FIXED = data_dir()


def use_folder(folder):
    global DATA_DIR, DATA, BACKUPS
    DATA_DIR = norm(folder)
    DATA = os.path.join(DATA_DIR, 'planner.json')
    BACKUPS = os.path.join(DATA_DIR, 'backups')


use_folder(_dir)
KEEP_BACKUPS = 14
MAX_BYTES = 20 * 1024 * 1024

# the only app files this server will ever send (planner.json only goes out through /api/data):
# these, plus .css / .js files inside the css/ and js/ folders
FILES = {
    '/': 'Planner.html',
    '/Planner.html': 'Planner.html',
    '/manifest.webmanifest': 'manifest.webmanifest',
    '/icon-192.png': 'icon-192.png',
    '/icon-512.png': 'icon-512.png',
}
APP_DIRS = ('css', 'js')
TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
}
ALLOWED_HOSTS = {f'localhost:{PORT}', f'127.0.0.1:{PORT}'}
ALLOWED_ORIGINS = {f'http://{h}' for h in ALLOWED_HOSTS}
write_lock = threading.Lock()


def folder_info():
    return {'folder': DATA_DIR, 'file': DATA, 'fixed': FIXED}


def current_etag():
    """Version tag of planner.json as it is on disk right now ('"none"' if missing or empty)."""
    try:
        st = os.stat(DATA)
    except FileNotFoundError:
        return '"none"'
    if st.st_size == 0:
        return '"none"'
    return f'"{st.st_mtime_ns:x}-{st.st_size:x}"'


def daily_backup():
    """Before the first save of a day, keep a copy of planner.json as it was."""
    if current_etag() == '"none"':
        return
    os.makedirs(BACKUPS, exist_ok=True)
    target = os.path.join(BACKUPS, f'planner-{datetime.date.today().isoformat()}.json')
    if not os.path.exists(target):
        shutil.copy2(DATA, target)
    names = sorted(n for n in os.listdir(BACKUPS) if n.startswith('planner-') and n.endswith('.json') and len(n) == 23)
    for old in names[:-KEEP_BACKUPS]:
        try:
            os.remove(os.path.join(BACKUPS, old))
        except OSError:
            pass


def app_file(path):
    """The file on disk for an app URL path, or None if it isn't one the server hands out."""
    if path in FILES:
        return os.path.join(HERE, FILES[path])
    parts = path.lstrip('/').split('/')
    if len(parts) < 2 or parts[0] not in APP_DIRS or any(p in ('', '.', '..') or p.startswith('.') for p in parts):
        return None
    if os.path.splitext(parts[-1])[1] not in ('.css', '.js'):
        return None
    full = os.path.realpath(os.path.join(HERE, *parts))
    if not full.startswith(os.path.join(os.path.realpath(HERE), parts[0]) + os.sep):
        return None
    return full


def atomic_write(data: bytes):
    tmp = os.path.join(DATA_DIR, f'.planner.json.tmp-{os.getpid()}-{threading.get_ident()}')
    try:
        with open(tmp, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, DATA)          # all-or-nothing swap
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'Planner'
    sys_version = ''

    # ---- helpers
    def host_ok(self):
        # refuse requests that arrive under some other hostname (DNS-rebinding guard)
        if self.headers.get('Host', '') in ALLOWED_HOSTS:
            return True
        self.send_error(403)
        return False

    def reply(self, code, body=b'', ctype='text/plain; charset=utf-8', extra=None, send_body=True):
        self.send_response(code)
        if body or code == 200:
            self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store' if self.path.startswith('/api/') else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if send_body and body:
            self.wfile.write(body)

    # ---- GET / HEAD: app files, or the data
    def do_GET(self):
        self.handle_read(send_body=True)

    def do_HEAD(self):
        self.handle_read(send_body=False)

    def handle_read(self, send_body):
        if not self.host_ok():
            return
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if path == '/api/folder':
            return self.reply_json(200, folder_info(), send_body)
        if path == '/api/data':
            tag = current_etag()
            info = {'ETag': tag, 'X-Planner-File': urllib.parse.quote(DATA), 'X-Planner-Fixed': '1' if FIXED else '0'}   # (headers are ASCII)
            if tag == '"none"':
                return self.reply(204, extra=info)
            if self.headers.get('If-None-Match') == tag:
                return self.reply(304, extra=info)
            try:
                with open(DATA, 'rb') as f:
                    data = f.read()
            except OSError as e:
                sys.stderr.write(f'cannot read planner.json: {e}\n')
                return self.reply(500, f'Cannot read planner.json: {e}'.encode())
            return self.reply(200, data, 'application/json', info, send_body)
        name = app_file(path)
        if name is None:
            return self.send_error(404)
        try:
            with open(name, 'rb') as f:
                data = f.read()
        except OSError as e:
            sys.stderr.write(f'cannot read {name}: {e}\n')
            return self.send_error(404)
        self.reply(200, data, TYPES[os.path.splitext(name)[1]], send_body=send_body)

    def reply_json(self, code, obj, send_body=True):
        self.reply(code, json.dumps(obj).encode(), 'application/json', send_body=send_body)

    # ---- PUT /api/data: save; PUT /api/folder: change the data folder
    def do_PUT(self):
        if not self.host_ok():
            return
        path = self.path.split('?', 1)[0]
        if path not in ('/api/data', '/api/folder'):
            return self.send_error(404)
        # only the app itself may save: same-origin requests, JSON bodies (other sites can't send these)
        origin = self.headers.get('Origin')
        if origin is not None and origin not in ALLOWED_ORIGINS:
            return self.reply(403, b'Forbidden origin')
        if path == '/api/folder':
            return self.change_folder()
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            return self.reply(415, b'Expected application/json')
        try:
            length = int(self.headers.get('Content-Length', '-1'))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BYTES:
            return self.reply(413, b'Missing or too large body')
        body = self.rfile.read(length)
        try:
            doc = json.loads(body)
            if not isinstance(doc, dict) or not isinstance(doc.get('projects'), list):
                raise ValueError('not a planner document')
        except ValueError as e:
            return self.reply(400, f'Refusing to save: {e}'.encode())
        with write_lock:
            tag = current_etag()
            want = self.headers.get('If-Match')
            if want is not None and want != '*' and want != tag:
                return self.reply(412, b'planner.json changed since it was loaded', extra={'ETag': tag})
            try:
                daily_backup()
            except OSError as e:
                sys.stderr.write(f'backup failed: {e}\n')      # don't block saving over a backup problem
            try:
                atomic_write(body)
            except OSError as e:
                sys.stderr.write(f'save failed: {e}\n')
                return self.reply(500, f'Could not write planner.json: {e}'.encode())
            self.reply(200, b'saved', extra={'ETag': current_etag()})

    def change_folder(self):
        """Settings > Data file. Body {folder, action}: 'check' says whether the folder already has a planner.json;
        'move' copies the current plan there and uses it (refused if one is there already); 'open' uses the plan
        that's there. The choice is remembered for the next start. The old planner.json stays where it was."""
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            return self.reply(415, b'Expected application/json')
        try:
            req = json.loads(self.rfile.read(min(int(self.headers.get('Content-Length', '0')), 65536)))
            target, action = norm(str(req['folder'])), req['action']
            if action not in ('check', 'move', 'open') or not str(req['folder']).strip():
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self.reply_json(400, {'error': 'Bad request'})
        if FIXED:
            return self.reply_json(409, {'error': 'The server was started with a data folder given for that run '
                                         '(--data or PLANNER_DATA), so it can\'t be changed from here.'})
        with write_lock:
            new_file = os.path.join(target, 'planner.json')
            try:
                has = os.path.getsize(new_file) > 0
            except OSError:
                has = False
            if target == DATA_DIR:
                return self.reply_json(200, {**folder_info(), 'same': True})
            if action == 'check':
                when = datetime.datetime.fromtimestamp(os.path.getmtime(new_file)).strftime('%b %d, %Y %H:%M') if has else None
                return self.reply_json(200, {'folder': target, 'has': has, 'modified': when})
            if action == 'move' and has:
                return self.reply_json(409, {'error': 'That folder already has a planner.json.'})
            if action == 'open' and not has:
                return self.reply_json(400, {'error': 'There is no planner.json in that folder.'})
            try:
                os.makedirs(target, exist_ok=True)
                if action == 'move' and current_etag() != '"none"':
                    shutil.copy2(DATA, new_file)
                elif not os.access(target, os.W_OK):
                    raise OSError('not allowed to write there')
                remember_folder(target)
            except OSError as e:
                return self.reply_json(500, {'error': f'Could not use {target}: {e}'})
            use_folder(target)
            sys.stdout.write(f'Planner: now using {DATA}\n')
            return self.reply_json(200, {**folder_info(), 'etag': current_etag()})

    def log_message(self, fmt, *args):
        pass   # stay quiet; errors still go to stderr


if __name__ == '__main__':
    if '-h' in sys.argv or '--help' in sys.argv:
        print(__doc__.strip())
        sys.exit(0)
    if arg('--set-data'):
        remember_folder(norm(arg('--set-data')))
        print(f'Data folder: {norm(arg("--set-data"))} (remembered in {CONFIG})')
        sys.exit(0)
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
    except OSError as e:
        if sys.stderr:
            sys.stderr.write(f'Planner server: cannot use the data folder {DATA_DIR}: {e}\n')
        sys.exit(1)
    # started without a console (pythonw on Windows): errors go to a log in the data folder
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
    if sys.stderr is None:
        sys.stderr = open(os.path.join(DATA_DIR, 'server-errors.log'), 'a', buffering=1)
    print(f'Planner: http://localhost:{PORT}/   data: {DATA}', flush=True)
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError as e:
        sys.stderr.write(f'Planner server could not start on port {PORT}: {e}\n')
        sys.exit(1)
    server.serve_forever()
