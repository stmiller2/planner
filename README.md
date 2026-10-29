## Experiment Planner

A planner for lab work. **Projects** (e.g. "build library") hold **threads** (e.g. "cloning"), and threads hold ordered
**tasks** (e.g. "purify GoldenGate reaction"), which can be linked to happen on the same day or the next day. Schedule
them on a multi-week **calendar**, plan the hours of a day in **day view**, keep one-off to-dos on the **scratch board**,
and look back at what you've finished in the **timeline**. The **?** button in the app explains the rest.

Everything runs on your own computer. Your plan is stored in one file, `planner.json`.

> **A note on the code.** The design and features are mine, but the code is entirely AI-generated (Claude).
> I don't understand JavaScript, so unlike my scientific code, I haven't read it and can't guarantee anything about it beyond Claude's
> promises that it's great. It has automated tests (`tests/`), and your data stays in a
> plain file you can back up, but use it at your own risk.

### Install

You need Python 3.7 or newer. On a Mac, macOS offers to install it the first time you type `python3` in Terminal. On
Windows, install it from [python.org](https://www.python.org/downloads/) and tick "Add python.exe to PATH".

1. Download the app:
   ```
   git clone https://github.com/stmiller2/planner Planner
   ```
   (or download the ZIP from GitHub and unzip it anywhere).
2. Start the server, which then also starts at every login:
   - **Mac:** in Terminal, in the app's folder, run `bash mac/install-server.sh`
   - **Windows:** double-click `windows\install-server.cmd` (untested; let me know how it goes)
3. Open <http://localhost:47823/>.

Your plan is saved to `PlannerData/planner.json` in your home folder, with a daily copy in `backups/` next to it (last
14 days). To keep it somewhere else, such as Dropbox, use Settings > Data file.

You can also open `Planner.html` directly in a browser, but it only saves automatically in Chrome or Edge. In other
browsers, you'll need to export and import your `planner.json` by hand.

### Updating

Run `git pull` (or replace the app folder with the new ZIP), then rerun the install script from step 2.

### Troubleshooting

- **Page won't load:** rerun the install script. It restarts the server and says whether it's answering. Errors are
  logged in `~/Library/Logs/planner-server.log` (Mac) or `server-errors.log` in your data folder (Windows). As a
  fallback, `python3 serve_planner.py` in the app's folder runs the server in a terminal window.
- **"Address already in use":** another copy of the server is running. Close it.
- **"planner.json couldn't be read":** the file isn't valid JSON. Fix it, or restore a backup by copying
  `backups/planner-YYYY-MM-DD.json` over `planner.json`.

### Uninstalling

- **Mac:** `launchctl bootout gui/$(id -u)/local.planner.server` then `rm ~/Library/LaunchAgents/local.planner.server.plist`
- **Windows:** `windows\install-server.cmd /uninstall`

Neither touches your data folder.

### Changing the code

`ARCHITECTURE.md` is a map of the code and its rules. Take a gander if that's your thing, or give your LLM of choice
access to the app folder and tell it to read `ARCHITECTURE.md` first for the project structure. If you come up with
anything fun to add, let me know.
