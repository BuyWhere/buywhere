#!/usr/bin/env bash
# setup-buy-55393-wc-cleanup-cron.sh — BUY-55393
# Installs the recurring WC cycle artifact cleanup cron job.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-55393: Worker WC cycle cleanup — hourly"
CRON_CMD="0 * * * * cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-55393-disk-space-watchdog-cron.sh >> $REPO_ROOT/logs/buy-55393-wc-cleanup-cron.log 2>&1"

if crontab -l 2>/dev/null | grep -q "BUY-55393"; then
  echo "BUY-55393 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-55393") | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-55393 cron installed:"
echo "  $CRON_CMD"

mkdir -p "$REPO_ROOT/logs"

echo ""
echo "Running initial WC cycle cleanup check..."
bash "$SCRIPT_DIR/run-buy-55393-disk-space-watchdog-cron.sh"
echo ""
echo "Setup complete."
