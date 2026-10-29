#!/bin/bash
# macOS: start the Planner server at login (and restart it if it ever stops), at http://localhost:47823/
#
#   bash mac/install-server.sh                  data in ~/PlannerData (or wherever it was set before)
#   bash mac/install-server.sh ~/Dropbox/Plan   data in that folder (an existing planner.json there is used;
#                                               to move your plan instead, use Settings > Data file in the app)
#
# Run it again any time: after moving the app's folder, changing Python, or updating serve_planner.py.
# Writes ~/Library/LaunchAgents/local.planner.server.plist from mac/local.planner.server.plist.template.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || true)"
if [ -z "$PY" ] || ! "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 7))' 2>/dev/null; then
  echo "Needs Python 3.7 or newer as python3 (macOS offers to install it the first time you type python3 in Terminal)." >&2
  exit 1
fi
case "$APP$PY$HOME" in *'&'*|*'<'*|*'>'*|*'|'*) echo "Paths with & < > | aren't supported here; move the folder." >&2; exit 1;; esac

PLIST="$HOME/Library/LaunchAgents/local.planner.server.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
if [ -n "${1:-}" ]; then mkdir -p "$1"; "$PY" "$APP/serve_planner.py" --set-data "$1"; fi
sed -e "s|__PYTHON__|$PY|" -e "s|__APP__|$APP|" -e "s|__HOME__|$HOME|" \
  "$APP/mac/local.planner.server.plist.template" > "$PLIST"
chmod 644 "$PLIST"
xattr -c "$PLIST" 2>/dev/null || true   # newer macOS can refuse agents with quarantine / provenance tags

launchctl bootout "gui/$(id -u)/local.planner.server" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$PLIST"

for i in 1 2 3 4 5 6 7 8 9 10; do
  if INFO="$(curl -s "http://localhost:47823/api/folder")" && [ -n "$INFO" ]; then
    echo "Planner server running: http://localhost:47823/"
    echo "  app:  $APP"
    echo "  data: $(printf '%s' "$INFO" | "$PY" -c 'import json, sys; print(json.load(sys.stdin)["file"])')"
    exit 0
  fi
  sleep 0.5
done
echo "The server didn't answer. See ~/Library/Logs/planner-server.log and the Troubleshooting part of README.md." >&2
exit 1
