#!/usr/bin/env bash
# setup-buy-56158-disk-space-watchdog.sh — BUY-56158 / BUY-48198
# Installs the recurring disk space watchdog cron job for BUY-56158.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-56158/BUY-48198: Disk space watchdog — every 5 min"
CRON_CMD="*/5 * * * * . /home/paperclip/.paperclip_env; cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-56158-disk-space-watchdog-cron.sh >> $REPO_ROOT/logs/buy-56158-disk-space-watchdog-cron.log 2>&1"

if crontab -l 2>/dev/null | grep -q "BUY-56158"; then
  echo "BUY-56158 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-56158") | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-56158 cron installed:"
echo "  $CRON_CMD"

mkdir -p "$REPO_ROOT/logs"

echo ""
echo "Running initial disk space watchdog check..."
bash "$SCRIPT_DIR/run-buy-56158-disk-space-watchdog-cron.sh"
echo ""
echo "Setup complete."
