#!/usr/bin/env bash
# setup-buy-56941-worker-node-artifact-cleanup.sh — BUY-56941
# Installs the recurring worker node artifact cleanup cron job.
# Runs every 6 hours to enforce disk-space limits on WC cycle ndjson artifacts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-56941: Worker node disk-space enforcement (WC cycle artifact cleanup)"
CRON_CMD="0 */6 * * * cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-56941-worker-wc-cycle-cleanup.sh >> $REPO_ROOT/logs/buy-56941-worker-node-artifact-cleanup.log 2>&1"

if crontab -l 2>/dev/null | grep -q "BUY-56941"; then
  echo "BUY-56941 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-56941") | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-56941 cron installed:"
echo "  $CRON_CMD"

mkdir -p "$REPO_ROOT/logs"

echo ""
echo "Running initial WC cycle cleanup check..."
bash "$SCRIPT_DIR/run-buy-56941-worker-wc-cycle-cleanup.sh"
echo ""
echo "Setup complete."
