#!/usr/bin/env bash
# setup-buy-56192-disk-space-watchdog.sh — BUY-56192 / BUY-48198
# Installs exactly ONE disk-space-watchdog cron entry, keyed on shared marker.
# Replaces any existing disk-space-watchdog-cron entries (dedup).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUNNER="$SCRIPT_DIR/run-buy-56192-disk-space-watchdog-cron.sh"
LOG_FILE="$REPO_ROOT/logs/buy-56192-disk-space-watchdog.log"
MARKER="disk-space-watchdog-cron"

CRON_JOB="*/5 * * * * . /home/paperclip/.paperclip_env; cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # BUY-56192/BUY-48198: Disk space watchdog — every 5 min"

mkdir -p "$REPO_ROOT/logs"

# Remove ALL existing disk-space-watchdog-cron entries, then add back one.
CRONTAB="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$CRONTAB" | grep -v "$MARKER" || true)"

printf '%s\n%s\n' "$CLEANED" "$CRON_JOB" | crontab -

# Verify exactly one entry remains
COUNT="$(crontab -l | grep -c "$MARKER" || true)"
if [[ "$COUNT" -eq 1 ]]; then
  echo "Verified: crontab contains exactly 1 disk-space-watchdog entry"
else
  echo "Error: expected 1 disk-space-watchdog entry, found $COUNT" >&2
  exit 1
fi

echo "Disk space watchdog cron installed (idempotent). Runner: $RUNNER"
