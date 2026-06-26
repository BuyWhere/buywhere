#!/usr/bin/env bash
# setup-disk-space-watchdog.sh — BUY-57232 / BUY-48198 (stable, idempotent installer)
#
# Installs exactly ONE disk-space-watchdog cron entry, keyed on the shared
# filename marker "disk-space-watchdog-cron" rather than a per-run issue
# number. This replaces the older per-issue-number setup scripts
# (setup-buy-NNNNN-disk-space-watchdog.sh) which each appended a new cron
# line and never deduped against sibling issues, causing cron bloat.
#
# Runs the latest canonical runner script: run-buy-57232-disk-watchdog-cron.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUNNER="$SCRIPT_DIR/run-buy-57232-disk-watchdog-cron.sh"
LOG_FILE="$REPO_ROOT/logs/buy-57232-disk-space-watchdog.log"

# Shared marker — matches every disk-space-watchdog-cron entry regardless of
# the issue number that created it.
MARKER="Disk space watchdog — every 5 min"

# Source the Paperclip credentials env file at the top of the cron line so the
# runner can create critical incidents without needing the watchdog's parent
# process to have inherited them.
CRON_JOB="*/5 * * * * . /home/paperclip/.paperclip_env; cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # BUY-57232/BUY-48198: Disk space watchdog — every 5 min"

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
