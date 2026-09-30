#!/usr/bin/env bash
# Install (or remove) the daily refresh as a macOS launchd agent (ADR 0029).
#
#   scripts/install-refresh.sh            # daily 6:00, weekly extras on Sundays
#   scripts/install-refresh.sh --remove
#
# launchd runs only while the Mac is awake; a missed run happens at the next wake.
# Logs: data/logs/refresh-YYYY-MM-DD.log
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
agents="$HOME/Library/LaunchAgents"
label="app.hclubs.refresh"
plist="$agents/$label.plist"
weekly_label="app.hclubs.refresh-weekly"
weekly_plist="$agents/$weekly_label.plist"

if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/$weekly_label" 2>/dev/null || true
  rm -f "$plist" "$weekly_plist"
  echo "Removed the hclubs refresh jobs."
  exit 0
fi

mkdir -p "$agents" "$root/data/logs"
# launchd starts with a bare PATH: record the one that finds node, pnpm and gh now.
path="$(dirname "$(command -v node)"):$(dirname "$(command -v pnpm)"):$(dirname "$(command -v gh)"):/usr/bin:/bin:/usr/sbin:/sbin"

write_plist() { # label file weekday(or empty) args
  local weekday_xml=""
  [ -n "$3" ] && weekday_xml="<key>Weekday</key><integer>$3</integer>"
  cat >"$2" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$root/scripts/refresh.sh</string>$4</array>
  <key>WorkingDirectory</key><string>$root</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$path</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer>$weekday_xml</dict>
  <key>StandardOutPath</key><string>$root/data/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>$root/data/logs/launchd.log</string>
</dict>
</plist>
EOF
}

# Daily Mon–Sat, weekly (with extras) on Sunday.
write_plist "$label" "$plist" "" ""
write_plist "$weekly_label" "$weekly_plist" "0" "<string>--weekly</string>"
for l in "$label" "$weekly_label"; do launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true; done
launchctl bootstrap "gui/$(id -u)" "$plist"
launchctl bootstrap "gui/$(id -u)" "$weekly_plist"
echo "Installed: daily refresh at 6:00 ($plist) and weekly extras Sundays at 6:00 ($weekly_plist)."
