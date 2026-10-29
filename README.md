# Planner

A planner for lab work. **Projects** (e.g. "build library") hold **threads** (e.g. "cloning"), and threads hold ordered **tasks**
(e.g. "purify GoldenGate reaction"), which can be linked to happen on the same day or the next day. You can schedule
them on a multi-week **calendar**, plan the hours of a day in **day view**, keep one-off to-dos on the
**scratch board**, and look back at what you've finished in the **timeline**. The **?** button in the app explains
the rest, and Settings lists the keyboard shortcuts.

Everything runs on your own computer. Your plan is stored locally in one file, `planner.json`.

> **A note on the code.** The design and features are mine, but the code is entirely AI-generated (Claude). 
> I don't understand JavaScript, so unlike my scientific code, I haven't read it and can't guarantee anything about it beyond Claude's
> promises that it's great. It has automated tests (`tests/`), and your data stays in a
> plain file you can back up, but use it at your own risk.

## Getting it

```
git clone https://github.com/stmiller2/planner Planner
```

or download the ZIP from GitHub and unzip it anywhere. The folder you get is just the app. Your plan is kept
**somewhere else** (see "Your data"), so you can update or replace the app folder without touching it.

## Three ways to run it

| | Browsers | Where your plan is saved | Backups | Good for |
|---|---|---|---|---|
| **1. Local server** (recommended) | any: Chrome, Safari, Edge, Firefox | `PlannerData/planner.json` in your home folder (or a folder you choose) | automatic, daily | everyday use; can be installed as an app with its own Dock / taskbar icon |
| **2. Open `Planner.html` in Chrome or Edge** | Chrome, Edge | `planner.json` in a folder you pick once | automatic, daily | no setup at all |
| **3. Open `Planner.html` in Safari or Firefox** | Safari, Firefox | inside that browser only | none: use **Export** | a quick look |

Options 1 and 2 can share the same data: pick the same `PlannerData` folder in option 2.
The app's Help (**?**) shows exactly where your plan is saved.

### 1. Local server

Needs Python 3.7 or newer, nothing else. On a Mac, macOS offers to install it the first time you type `python3` in
Terminal. On Windows, install it from [python.org](https://www.python.org/downloads/) and tick "Add python.exe to
PATH".

**Try it:** in Terminal (Mac) or Command Prompt (Windows), in the app's folder:

```
python3 serve_planner.py        (on Windows: python serve_planner.py)
```

then open <http://localhost:47823/>. It runs until you close that window. The server only answers on your own
computer (it isn't reachable from the network).

**Start it automatically at login:**

- **Mac:** in Terminal, in the app's folder: `bash mac/install-server.sh`. It keeps running in the background and
  restarts if it ever stops.
- **Windows:** double-click `windows\install-server.cmd`. It should starts the server now (no window) and at every login. Note that I don't have a Windows machine so I have never tested this, if you try it, let me know how it works!

Run the same command again after moving the app's folder, reinstalling Python, or updating. To start with your data in
a particular folder, give it: `bash mac/install-server.sh ~/Dropbox/PlannerData` or
`windows\install-server.cmd "D:\Dropbox\PlannerData"`. (A `planner.json` already in that folder is used.)

**Make it an app:**

- Chrome or Edge (Mac or Windows): open <http://localhost:47823/>, then click the install icon at the right of the
  address bar (or Chrome's ⋮ menu > Cast, save, and share > Install page as app; Edge's … menu > Apps > Install this
  site as an app). Planner then opens in its own window with its own icon.
- Safari: open <http://localhost:47823/>, then File > Add to Dock.

You can use both browsers; they share the same `planner.json`. If you edit in two windows at once, the second one
to save asks which version to keep.

### 2. Open `Planner.html` in Chrome or Edge

Double-click `Planner.html` (or drag it into Chrome). The first time, Planner asks for a folder to keep
`planner.json` in. Make one, such as `PlannerData` in your home folder, rather than using the app's own folder.
Chrome remembers the folder; it may ask you to confirm access once per session (choose "Allow on every visit" if
offered).

### 3. Open `Planner.html` in Safari or Firefox

These browsers can't save to a file from a page opened from disk, so Planner keeps your plan inside the browser and
shows **Export** / **Import** buttons. Clearing the browser's website data deletes it, and it isn't backed up. Click
**Export** often, or better, use the local server (option 1), which works in Safari too.

## Your data

- `planner.json` is your whole plan: in `PlannerData` in your home folder unless you chose another place (Help shows
  where). `backups/` next to it keeps a copy from each of the last 14 days you used it.
- **To keep it somewhere else** (e.g. a Dropbox or OneDrive folder): Settings > **Data file**. With the server, type
  the folder's path and click Move: your plan is copied there and saved there from now on (the old file stays where
  it was, as a spare). With option 2, choose another folder there.
  (Don't have two computers' servers saving to the same synced file at the same time.)
- To restore a backup: quit Planner, copy `backups/planner-YYYY-MM-DD.json` over `planner.json`, reopen.
- To move to another computer: copy the `PlannerData` folder.
- The repository never contains anyone's data (`.gitignore` excludes `planner.json` and `backups/`).

## Updating

```
git pull
```

(or download the new ZIP and replace the app folder). Then reload the Planner window. If `serve_planner.py`
changed, restart the server: rerun `bash mac/install-server.sh` or `windows\install-server.cmd` (or stop and rerun
`python3 serve_planner.py`).

## Troubleshooting

**Planner says it can't connect / the page doesn't load.** First, rerun the install script: it restarts the server
and says whether it's answering. Then:

- **Mac:** `launchctl print gui/$(id -u)/local.planner.server | grep state` should say `running`; errors are in
  `~/Library/Logs/planner-server.log`. "Bootstrap failed: 5: Input/output error" (often after a macOS update) is
  fixed by rerunning the install script, which resets the file's permissions and tags.
- **Windows:** errors are in `server-errors.log` in your data folder. If Windows Defender or another program blocks
  it, run `python serve_planner.py` in a Command Prompt in the app folder to see the message.
- "Address already in use": something else is using port 47823 (perhaps a second copy of the server in a terminal
  window; close it).
- Meanwhile, running `python3 serve_planner.py` in a terminal always works.

**"planner.json couldn't be read".** The file isn't valid JSON (for example, it was edited by hand). Planner won't
overwrite it. Fix it or copy a version from `backups/`.

## Removing it

- **Mac:** `launchctl bootout gui/$(id -u)/local.planner.server` then
  `rm ~/Library/LaunchAgents/local.planner.server.plist`
- **Windows:** `windows\install-server.cmd /uninstall`

Uninstall the Chrome / Edge app from its menu (Uninstall Planner); drag the Safari app out of the Dock. None of this
touches your data folder. The remembered data folder is in `~/.config/planner/data-folder.txt`.

## Changing the code

`ARCHITECTURE.md` is a map of the code and its rules, take a gander if that's your thing or give your LLM of choice
access to the app folder and tell it to read `ARCHITECTURE.md` first for the project structure. If you come up with
anything fun to add let me know.

- `node --test tests/*.test.js` runs the unit tests of the scheduling rules (needs Node.js; a few seconds).
- `node tests/browser/smoke.js` opens the app in a headless browser and checks every view (needs Playwright).
- `python3 serve_planner.py --data /tmp/test-data` runs the app on a separate data folder, so you can experiment
  without touching your own plan.
