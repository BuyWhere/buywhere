#!/usr/bin/env bash
# run-buy-56110-carousell-sg-cleanup-cron.sh — BUY-56110 / BUY-48198
# Cron wrapper for carousell-sg disk cleanup. Runs every 5 minutes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/buy-56110-carousell-sg-cleanup-cron.log"
mkdir -p "$REPO_ROOT/logs"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Run the cleanup script and capture output
if bash "$SCRIPT_DIR/carousell-sg-disk-cleanup.sh" >> "$LOG_FILE" 2>&1; then
    echo "[$TS] BUY-56110: Carousell SG cleanup completed successfully" >> "$LOG_FILE"
else
    echo "[$TS] BUY-56110: Carousell SG cleanup failed (exit=$?)" >> "$LOG_FILE"
fi
