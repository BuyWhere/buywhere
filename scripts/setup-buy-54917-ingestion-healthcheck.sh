#!/usr/bin/env bash
# setup-buy-54917-ingestion-healthcheck.sh — BUY-54917
# Installs the recurring ingestion pipeline health check cron job.
# Runs every 15 minutes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-54917: Ingestion pipeline recurring health check — every 15 min"
CRON_CMD="*/15 * * * * cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-54917-ingestion-healthcheck-cron.sh >> $REPO_ROOT/logs/buy-54917-ingestion-healthcheck-cron.log 2>&1"

# Check if BUY-54917 cron entry already exists
if crontab -l 2>/dev/null | grep -q "BUY-54917"; then
  echo "BUY-54917 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-54917") | crontab -
fi

# Add the cron entry after existing entries (before the final newline)
(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-54917 cron installed:"
echo "  $CRON_CMD"

# Create initial report directory
mkdir -p "$REPO_ROOT/data/reports"

# Run a first check immediately
echo ""
echo "Running initial ingestion health check..."
bash "$SCRIPT_DIR/run-buy-54917-ingestion-healthcheck-cron.sh"
echo ""
echo "Setup complete."
