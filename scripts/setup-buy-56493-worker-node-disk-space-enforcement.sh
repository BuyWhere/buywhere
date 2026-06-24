#!/usr/bin/env bash
# setup-buy-56493-worker-node-disk-space-enforcement.sh
# Installs the BUY-56493 WC cycle artifact cleanup cron entry (hourly).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-56493: Worker node disk-space enforcement (WC cycle cleanup) — hourly"
CRON_CMD="0 * * * * bash $SCRIPT_DIR/run-buy-56493-worker-node-disk-space-enforcement.sh >> $REPO_ROOT/logs/buy-56493-disk-space-enforcement-cron.log 2>&1"

if crontab -l 2>/dev/null | grep -q "BUY-56493"; then
  echo "BUY-56493 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-56493") | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-56493 cron installed:"
echo "  $CRON_CMD"

mkdir -p "$REPO_ROOT/logs"

echo ""
echo "Running initial enforcement run..."
bash "$SCRIPT_DIR/run-buy-56493-worker-node-disk-space-enforcement.sh"
echo ""
echo "Setup complete."
