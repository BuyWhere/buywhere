#!/usr/bin/env bash
# setup-buy-56228-worker-node-disk-space-enforcement.sh
# BUY-56228: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Installs a cron job that runs wc-cycle-cleanup.sh --apply --keep=48 daily.
# Prevents the root filesystem hitting 100% (BUY-30774).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUNNER="$SCRIPT_DIR/run-buy-56228-worker-node-disk-space-enforcement.sh"
LOG_FILE="$REPO_ROOT/logs/buy-56228-wc-cycle-enforcement.log"
MARKER="buy-56228-worker-node-disk-space-enforcement"

CRON_JOB="0 */6 * * * . /home/paperclip/.paperclip_env; cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # BUY-56228: Worker node disk-space enforcement — every 6 hours"

mkdir -p "$REPO_ROOT/logs"

# Remove existing BUY-56228 entries, then add back one
CRONTAB="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$CRONTAB" | grep -v "$MARKER" || true)"

printf '%s\n%s\n' "$CLEANED" "$CRON_JOB" | crontab -

# Verify exactly one entry remains
COUNT="$(crontab -l | grep -c "$MARKER" || true)"
if [[ "$COUNT" -eq 1 ]]; then
  echo "Verified: crontab contains exactly 1 BUY-56228 enforcement entry"
else
  echo "Error: expected 1 BUY-56228 enforcement entry, found $COUNT" >&2
  exit 1
fi

echo "Worker node disk-space enforcement cron installed (idempotent). Runner: $RUNNER"
