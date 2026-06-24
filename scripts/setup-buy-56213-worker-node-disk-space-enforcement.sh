#!/usr/bin/env bash
# setup-buy-56213-worker-node-disk-space-enforcement.sh
# Registers BUY-56213 enforcement as a cron job (hourly) for the buywhere-api workspace.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$SCRIPT_DIR/run-buy-56213-worker-node-disk-space-enforcement.sh"
LOG_FILE="/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/logs/buy-56213-disk-space-enforcement-cron.log"

mkdir -p "$(dirname "$LOG_FILE")"

CRON_LINE="0 * * * * bash $RUNNER >> $LOG_FILE 2>&1"

# Remove any existing BUY-56213 cron line to avoid duplicates
(crontab -l 2>/dev/null | grep -v 'BUY-56213' || true) > /tmp/crontab-purge

# Add new line
(crontab -l 2>/dev/null | grep -v 'BUY-56213' || true) > /tmp/crontab-new
echo "$CRON_LINE # BUY-56213" >> /tmp/crontab-new
crontab /tmp/crontab-new
rm -f /tmp/crontab-new /tmp/crontab-purge

echo "BUY-56213 cron job installed (hourly). Runner: $RUNNER"
echo "Log: $LOG_FILE"
