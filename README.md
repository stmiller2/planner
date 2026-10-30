## Experiment planner

Vibe-coded experiment planner I use to help schedule lab work. Code is all AI-generated javascript that I haven’t read and can’t vouch for, put here for version control or if anyone else wants to use it feel free! “Help” section in the app explains how to use it.

### Install

It runs off a local server on your computer bound to <http://localhost:47823/>. You just need Python 3.7 or newer to run this server.
To install:
   ```
   git clone https://github.com/stmiller2/planner Planner
   ```
   (or download the ZIP from GitHub and unzip it anywhere).

Start the server, which from then on automatically runs when you log in:
   - **Mac:** in Terminal, in the app's folder, run `bash mac/install-server.sh`
   - **Windows:** double-click `windows\install-server.cmd` (untested; let me know how it goes)

Open <http://localhost:47823/>.

(You can also open `Planner.html` directly in a browser, but it only saves automatically in Chrome or Edge. In other browsers, you'll need to export and import your `planner.json` by hand [this is why I prefer to use the server])

Your tasks are saved under `PlannerData/planner.json` in your home folder by default but this can be changed in settings.

Update with `git pull` (or replace the app folder with the new ZIP), then rerun the install script.

Every issue with the server I’ve run into so far can be solved by re-running the install script.

### Uninstalling

- **Mac:** `launchctl bootout gui/$(id -u)/local.planner.server` then `rm ~/Library/LaunchAgents/local.planner.server.plist`
- **Windows:** `windows\install-server.cmd /uninstall`
