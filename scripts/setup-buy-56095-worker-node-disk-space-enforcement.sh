#!/usr/bin/env bash
# setup-buy-56095-worker-node-disk-space-enforcement.sh
# Sets up cron for BUY-56095 WC cycle artifact cleanup.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$SCRIPT_DIR/run-buy-56095-worker-node-disk-space-enforcement.sh"
LOG_FILE="/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/logs/buy-56095-disk-space-enforcement-cron.log"

mkdir -p "$(dirname "$LOG_FILE")"

CRON_LINE="0 * * * * bash $RUNNER >> $LOG_FILE 2>&1"

# Check if already installed
if crontab -l 2>/dev/null | grep -qF "$RUNNER"; then
  echo "Cron already installed for $RUNNER"
  exit 0
fi

# Install cron
(crontab -l 2>/dev/null || true; echo "$CRON_LINE") | crontab -
echo "Cron installed: $CRON_LINE"
