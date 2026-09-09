#!/usr/bin/env bash
# setup-buy-55437-worker-node-artifact-cleanup.sh — BUY-55437
# Installs the recurring worker node artifact cleanup cron job.
# Canonical implementation lives under BUY-55411; BUY-55437 is an alias.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-55437: Worker node disk-space enforcement (WC cycle artifact cleanup)"
CRON_CMD="0 */6 * * * cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-55437-worker-node-artifact-cleanup.sh >> $REPO_ROOT/logs/buy-55437-worker-node-artifact-cleanup.log 2>&1"

if crontab -l 2>/dev/null | grep -q "BUY-55437"; then
  echo "BUY-55437 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-55437") | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-55437 cron installed:"
echo "  $CRON_CMD"

mkdir -p "$REPO_ROOT/logs"

echo ""
echo "Running initial WC cycle cleanup check..."
bash "$SCRIPT_DIR/run-buy-55437-worker-node-artifact-cleanup.sh"
echo ""
echo "Setup complete."
