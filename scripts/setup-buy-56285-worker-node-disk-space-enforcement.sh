#!/usr/bin/env bash
# setup-buy-56285-worker-node-disk-space-enforcement.sh
# BUY-56285: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Installs a cron job that runs wc-cycle-cleanup.sh --apply --keep=48 hourly.
# Prevents the root filesystem hitting 100% (BUY-30774).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$SCRIPT_DIR/run-buy-56285-worker-node-disk-space-enforcement.sh"
LOG_FILE="/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/logs/buy-56285-disk-space-enforcement-cron.log"

mkdir -p "$(dirname "$LOG_FILE")"

CRON_LINE="0 * * * * bash $RUNNER >> $LOG_FILE 2>&1"

# Remove any existing BUY-56285 cron line to avoid duplicates
(crontab -l 2>/dev/null | grep -v 'BUY-56285' || true) > /tmp/crontab-new
echo "$CRON_LINE # BUY-56285" >> /tmp/crontab-new
crontab /tmp/crontab-new
rm -f /tmp/crontab-new

# Verify exactly one entry remains
COUNT="$(crontab -l | grep -c 'BUY-56285' || true)"
if [[ "$COUNT" -eq 1 ]]; then
  echo "Verified: crontab contains exactly 1 BUY-56285 enforcement entry"
else
  echo "Error: expected 1 BUY-56285 enforcement entry, found $COUNT" >&2
  exit 1
fi

echo "BUY-56285 cron job installed (hourly). Runner: $RUNNER"
echo "Log: $LOG_FILE"
