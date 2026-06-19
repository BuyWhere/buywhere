#!/usr/bin/env bash
# run-buy-53336-ingestion-healthcheck-cron.sh — BUY-53336
# Recurring ingestion pipeline health check.
#
# Runs the Python health check script in --cron mode, writes a timestamped JSON
# report to data/reports/, prints a one-line summary, and exits with the health
# status code (0=healthy, 1=degraded, 2=unhealthy).
#
# Intended to run via crontab every 15 minutes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${LOG_FILE:-$REPO_ROOT/logs/buy-53336-ingestion-healthcheck.log}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/data/reports}"

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$REPORT_DIR"

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Run the health check in cron mode
set +e
OUTPUT=$(python3 "$SCRIPT_DIR/ingestion_pipeline_healthcheck.py" --cron --report-dir "$REPORT_DIR" 2>&1)
RC=$?
set -e

# Log the output (first line is the JSON to stdout, rest is stderr)
echo "[$TS] BUY-53336 healthcheck exit=$RC" >> "$LOG_FILE"
echo "$OUTPUT" >> "$LOG_FILE"

# Extract the summary line (last line from --cron output) for stdout
SUMMARY=$(echo "$OUTPUT" | grep "\[BUY-53336\]" | tail -1)
echo "[$TS] $SUMMARY"

# Exit with health code for crontab visibility
exit $RC
