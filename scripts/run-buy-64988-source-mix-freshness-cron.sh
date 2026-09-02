#!/usr/bin/env bash
#
# run-buy-64988-source-mix-freshness-cron.sh
#
# Cron wrapper for scripts/source_mix_freshness_check.js (BUY-64988).
# Runs every 15 minutes by default; writes a JSON report and exits non-zero
# if the reconciliation_status is `drift` for any (hour, source) row.
#
# Required env:
#   DATABASE_URL
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${LOG_FILE:-$REPO_ROOT/logs/buy-64988-source-mix-freshness.log}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/data/reports}"
HOURS="${HOURS:-24}"

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$REPORT_DIR"

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REPORT_PATH="$REPORT_DIR/source-mix-freshness-${TS}.json"

set +e
OUTPUT=$(node "$SCRIPT_DIR/source_mix_freshness_check.js" --hours "$HOURS" --json 2>&1)
RC=$?
set -e

echo "$OUTPUT" > "$REPORT_PATH"

echo "[$TS] BUY-64988 source_mix_freshness exit=$RC report=$REPORT_PATH" >> "$LOG_FILE"
SUMMARY=$(echo "$OUTPUT" | head -50)
echo "$SUMMARY" >> "$LOG_FILE"

exit $RC