#!/usr/bin/env bash
# setup-buy-55388-carousell-sg-monitor.sh — BUY-55388
# Installs Python-based Carousell SG scraper monitoring with JSON status output.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MONITOR_SCRIPT="$SCRIPT_DIR/carousell-sg-monitor.py"
CRON_LABEL="# BUY-55388: Carousell SG scraper monitor — every 5 min"
CRON_CMD="*/5 * * * * cd $REPO_ROOT && python3 $MONITOR_SCRIPT >> /tmp/carousell-sg-monitor.log 2>&1"

echo "=== Installing BUY-55388 Carousell SG Scraper Monitor ==="
echo "Repo: $REPO_ROOT"
echo "Monitor: $MONITOR_SCRIPT"

# Check monitor script exists
if [[ ! -f "$MONITOR_SCRIPT" ]]; then
    echo "ERROR: Monitor script not found: $MONITOR_SCRIPT"
    exit 1
fi

# Register cron (exclude old entries to avoid duplicates)
EXISTING_PATTERN="BUY-55388|BUY-54378"
(crontab -l 2>/dev/null | grep -Ev "$EXISTING_PATTERN") | crontab -
(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo ""
echo "Cron installed:"
echo "  $CRON_CMD"
echo ""
echo "Running initial check..."
python3 "$MONITOR_SCRIPT"
echo ""
echo "Status file: data/carousell-sg/monitor-status.json"
echo "Monitor log: /tmp/carousell-sg-monitor.log"
echo ""
echo "=== Setup complete ==="
