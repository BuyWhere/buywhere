#!/usr/bin/env bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# setup-buy-57188-disk-space-watchdog.sh — BUY-57188
# Installs the recurring disk space watchdog cron job.
# Runs every 5 minutes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-57188: Disk Space Watchdog — every 5 min"
CRON_CMD="*/5 * * * * cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-57188-disk-space-watchdog.sh >> $REPO_ROOT/logs/buy-57188-disk-space-watchdog.log 2>&1"

# Check if BUY-57188 cron entry already exists
if crontab -l 2>/dev/null | grep -q "BUY-57188"; then
  echo "BUY-57188 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-57188") | crontab -
fi

# Add the cron entry
(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-57188 cron installed:"
echo "  $CRON_CMD"

# Create evidence directory
mkdir -p "$REPO_ROOT/BUY-57188-evidence"

# Run a first check immediately
echo ""
echo "Running initial disk space check..."
bash "$SCRIPT_DIR/run-buy-57188-disk-space-watchdog.sh"
echo ""
echo "Setup complete."
