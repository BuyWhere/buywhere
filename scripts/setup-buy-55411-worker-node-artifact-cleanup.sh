#!/usr/bin/env bash
# setup-buy-55411-worker-node-artifact-cleanup.sh — BUY-55411
# Installs the recurring worker node artifact cleanup cron job.
# Runs wc-cycle-cleanup.sh --apply --keep=48 to delete orphaned WC cycle ndjson files older than 48h.
# Alerts if disk > 90%. Prevents root filesystem from hitting 100% (BUY-30774).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-55411: Worker node artifact cleanup (WC cycle) — every 6 hours"
CRON_CMD="0 */6 * * * cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-55411-worker-node-artifact-cleanup.sh >> $REPO_ROOT/logs/buy-55411-worker-node-artifact-cleanup.log 2>&1"

if crontab -l 2>/dev/null | grep -q "BUY-55411"; then
  echo "BUY-55411 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-55411") | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-55411 cron installed:"
echo "  $CRON_CMD"

mkdir -p "$REPO_ROOT/logs"

echo ""
echo "Running initial WC cycle cleanup check..."
bash "$SCRIPT_DIR/run-buy-55411-worker-node-artifact-cleanup.sh"
echo ""
echo "Setup complete."
