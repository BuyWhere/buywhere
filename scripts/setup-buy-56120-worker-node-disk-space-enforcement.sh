#!/usr/bin/env bash
# setup-buy-56120-worker-node-disk-space-enforcement.sh
# Installs the BUY-56120 WC cycle artifact cleanup cron entry.
# Runs hourly. This is the consolidated replacement for BUY-56046 and BUY-56095
# which only targeted a single hardcoded workspace.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
mkdir -p "$LOG_DIR"
CRON_LABEL="# BUY-56120: Worker node disk-space enforcement (WC cycle cleanup, ALL workspaces) — hourly"
CRON_CMD="0 * * * * cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-56120-worker-node-disk-space-enforcement.sh >> $LOG_DIR/buy-56120-disk-space-enforcement-cron.log 2>&1"

if crontab -l 2>/dev/null | grep -q "BUY-56120"; then
  echo "BUY-56120 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-56120") | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-56120 cron installed:"
echo "  $CRON_CMD"

echo ""
echo "Running initial enforcement run..."
bash "$SCRIPT_DIR/run-buy-56120-worker-node-disk-space-enforcement.sh"
echo ""
echo "Setup complete."
