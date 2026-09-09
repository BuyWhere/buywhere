#!/usr/bin/env bash
# setup-buy-54378-carousell-sg-scraper-watchdog.sh — BUY-54378
# Installs the Carousell SG scraper daemon watchdog cron job.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRON_LABEL="# BUY-54378: Carousell SG scraper watchdog — every 5 min"
CRON_CMD="*/5 * * * * cd $REPO_ROOT && bash $SCRIPT_DIR/run-buy-54378-carousell-sg-scraper-watchdog-cron.sh >> $REPO_ROOT/logs/buy-54378-carousell-sg-scraper-watchdog-cron.log 2>&1"

# Existing cron entries to exclude when reinstalling
EXISTING_ENTRIES="BUY-54076|BUY-54082|BUY-54086|BUY-54091|BUY-54093|BUY-54099|BUY-54106|BUY-54108|BUY-54112|BUY-54115|BUY-54119|BUY-54123|BUY-54131|BUY-54135|BUY-54139|BUY-54160|BUY-54166|BUY-54181|BUY-54185|BUY-54187|BUY-54195|BUY-54200|BUY-54205|BUY-54214|BUY-54216|BUY-54219|BUY-54225|BUY-54232|BUY-54234|BUY-54238|BUY-54241|BUY-54242|BUY-54244|BUY-54247|BUY-54250|BUY-54256|BUY-54268|BUY-54273|BUY-54277|BUY-54279|BUY-54283|BUY-54288|BUY-54290|BUY-54296|BUY-54299|BUY-54302|BUY-54304|BUY-54307|BUY-54310|BUY-54315|BUY-54326|BUY-54332|BUY-54337|BUY-54340|BUY-54344|BUY-54350|BUY-54355|BUY-54358|BUY-54361|BUY-54364|BUY-54366|BUY-54368|BUY-54372|BUY-54375|BUY-54378"

if crontab -l 2>/dev/null | grep -Eq "$EXISTING_ENTRIES"; then
    echo "BUY-54378 cron entry already installed. Removing and re-adding..."
    (crontab -l 2>/dev/null | grep -Ev "$EXISTING_ENTRIES") | crontab -
fi

(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-54378 cron installed:"
echo "  $CRON_CMD"

mkdir -p "$REPO_ROOT/logs"

echo ""
echo "Running initial watchdog check..."
bash "$SCRIPT_DIR/run-buy-54378-carousell-sg-scraper-watchdog-cron.sh"
echo ""
echo "Setup complete."
