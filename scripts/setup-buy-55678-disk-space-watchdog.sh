#!/usr/bin/env bash
# setup-buy-55678-disk-space-watchdog.sh — BUY-55678 / BUY-48198
# Installs the recurring disk space watchdog cron job for BUY-55678.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-55678: Disk space watchdog — every 5 min"
CRON_CMD="*/5 * * * * cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-55678-disk-space-watchdog-cron.sh >> $REPO_ROOT/logs/buy-55678-disk-space-watchdog-cron.log 2>&1"

if crontab -l 2>/dev/null | grep -q "BUY-55678"; then
  echo "BUY-55678 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-55678") | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-55678 cron installed:"
echo "  $CRON_CMD"

mkdir -p "$REPO_ROOT/logs"

echo ""
echo "Running initial disk space watchdog check..."
bash "$SCRIPT_DIR/run-buy-55678-disk-space-watchdog-cron.sh"
echo ""
echo "Setup complete."
