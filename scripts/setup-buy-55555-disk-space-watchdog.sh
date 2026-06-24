#!/usr/bin/env bash
# setup-buy-55555-disk-space-watchdog.sh — BUY-55555 | BUY-48198
# Installs the BUY-55555 disk space watchdog cron job.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_MARKER="BUY-55555"
CRON_JOB="*/5 * * * * cd $REPO_ROOT && bash scripts/run-buy-55555-disk-space-watchdog-cron.sh >> $REPO_ROOT/logs/buy-55555-disk-space-watchdog-cron.log 2>&1 # BUY-55555: Disk space watchdog — every 5 min"
LOG_FILE="$REPO_ROOT/logs/buy-55555-disk-space-watchdog-cron.log"

mkdir -p "$REPO_ROOT/logs"

# Remove any existing entry with this marker
CRONTAB="$(crontab -l 2>/dev/null || true)"
CLEANED="$(echo "$CRONTAB" | grep -v "$CRON_MARKER" || true)"

# Add the new entry
NEW_CRONTAB="$CLEANED
$CRON_JOB"

echo "$NEW_CRONTAB" | crontab -

# Verify
echo "Cron job installed for $CRON_MARKER."
CRON_LIST="$(crontab -l)"
if echo "$CRON_LIST" | grep -q "$CRON_MARKER"; then
  echo "Verified: crontab contains $CRON_MARKER"
else
  echo "Error: crontab does not contain $CRON_MARKER" >&2
  exit 1
fi

# Initial run
bash "$SCRIPT_DIR/run-buy-55555-disk-space-watchdog-cron.sh"
RC=$?

# Copy initial output to the cron log too
if [[ -f "$LOG_FILE" ]]; then
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") Initial run: exit=$RC" >> "$LOG_FILE"
fi

echo "BUY-55555 disk space watchdog installed. Initial run exit=$RC"
