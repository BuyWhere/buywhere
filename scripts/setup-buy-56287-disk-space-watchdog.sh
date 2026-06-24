#!/usr/bin/env bash
# setup-buy-56287-disk-space-watchdog.sh — BUY-56287 / BUY-48198
# Installs exactly ONE disk-space-watchdog cron entry for /dev/vda1.
# Replaces any existing disk-space-watchdog cron entries.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$SCRIPT_DIR/run-buy-56287-disk-space-watchdog-cron.sh"
LOG_FILE="$REPO_ROOT/logs/buy-56287-disk-space-watchdog.log"
MARKER="BUY-56287: Disk space watchdog"

CRON_JOB="*/5 * * * * . /home/paperclip/.paperclip_env; cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # $MARKER — every 5 min"

mkdir -p "$REPO_ROOT/logs"

CRONTAB="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$CRONTAB" | grep -Ev '(run-buy-[0-9]+-disk-space-watchdog-cron\.sh|Disk space watchdog — every 5 min|Disk space watchdog$)' || true)"

printf '%s\n%s\n' "$CLEANED" "$CRON_JOB" | crontab -

COUNT="$(crontab -l | grep -Ec 'run-buy-[0-9]+-disk-space-watchdog-cron\.sh|Disk space watchdog — every 5 min|Disk space watchdog$' || true)"
if [[ "$COUNT" -eq 1 ]]; then
  echo "Verified: crontab contains exactly 1 disk-space-watchdog entry"
else
  echo "Error: expected 1 disk-space-watchdog entry, found $COUNT" >&2
  exit 1
fi

echo "Disk space watchdog cron installed for BUY-56287/BUY-48198. Runner: $RUNNER"
bash "$RUNNER"
