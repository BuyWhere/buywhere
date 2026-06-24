#!/usr/bin/env bash
# setup-buy-55904-disk-space-watchdog.sh — BUY-55904 / BUY-48198
# Installs the recurring disk space watchdog cron job for BUY-55904.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-55904/BUY-48198: Disk space watchdog — every 5 min"
CRON_CMD="*/5 * * * * cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-55904-disk-space-watchdog-cron.sh >> $REPO_ROOT/logs/buy-55904-disk-space-watchdog-cron.log 2>&1"

if crontab -l 2>/dev/null | grep -q "BUY-55904"; then
  echo "BUY-55904 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-55904") | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-55904 cron installed:"
echo "  $CRON_CMD"

mkdir -p "$REPO_ROOT/logs"

echo ""
echo "Running initial disk space watchdog check..."
bash "$SCRIPT_DIR/run-buy-55904-disk-space-watchdog-cron.sh"
echo ""
echo "Setup complete."
