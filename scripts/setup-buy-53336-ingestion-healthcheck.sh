#!/usr/bin/env bash
# setup-buy-53336-ingestion-healthcheck.sh — BUY-53674
# Installs the recurring ingestion pipeline health check cron job.
# Runs every 15 minutes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-53674: Ingestion pipeline recurring health check — every 15 min"
CRON_CMD="*/15 * * * * cd $REPO_ROOT && bash -l $SCRIPT_DIR/run-buy-53336-ingestion-healthcheck-cron.sh >> $REPO_ROOT/logs/buy-53336-ingestion-healthcheck-cron.log 2>&1"

# Check if cron entry already exists
if crontab -l 2>/dev/null | grep -q "BUY-53674"; then
  echo "BUY-53674 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-53674") | crontab -
fi

# Remove old BUY-53336 entry too
if crontab -l 2>/dev/null | grep -q "BUY-53336"; then
  echo "Removing old BUY-53336 cron entry..."
  (crontab -l 2>/dev/null | grep -v "BUY-53336") | crontab -
fi

# Add the cron entry after existing entries (before the final newline)
(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-53674 cron installed:"
echo "  $CRON_CMD"

# Create initial report directory
mkdir -p "$REPO_ROOT/data/reports"

# Run a first check immediately
echo ""
echo "Running initial health check..."
bash -l "$SCRIPT_DIR/run-buy-53336-ingestion-healthcheck-cron.sh"
echo ""
echo "Setup complete."
