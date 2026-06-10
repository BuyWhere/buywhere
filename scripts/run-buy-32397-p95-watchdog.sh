#!/usr/bin/env bash
# run-buy-32397-p95-watchdog.sh — wrapper for BUY-32397 P95 Latency Monitoring
#
# Drives scripts/buy-32264-p95-latency-watchdog.js, keeps the shared
# breach state at /tmp/buy-32264-p95-state.json so the 3-rotation
# counter survives across 5-minute routine executions, and snapshots
# the run into data/buy-<issue>-p95-monitor-<UTC timestamp>/ for
# issue evidence.
#
# Usage: bash scripts/run-buy-32397-p95-watchdog.sh [execution-issue]
# Exit codes: 0 PASS, 1 WARN, 2 ALERT, 3 BLOCK
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EXECUTION_ISSUE="${1:-${P95_EXECUTION_ISSUE:-BUY-38871}}"
SCRIPT_JS="$REPO_ROOT/scripts/buy-32264-p95-latency-watchdog.js"
DEFAULT_SHARED_STATE_FILE="/tmp/buy-32264-p95-state.json"
P95_STATE_FILE="${P95_STATE_FILE:-$DEFAULT_SHARED_STATE_FILE}"

mkdir -p "$REPO_ROOT/data"
TS="$(date -u +%Y-%m-%dT%H%MZ)"
SNAPSHOT_DIR="$REPO_ROOT/data/${EXECUTION_ISSUE,,}-p95-monitor-${TS}"

export P95_STATE_FILE
export P95_EXECUTION_ISSUE="$EXECUTION_ISSUE"
export P95_SNAPSHOT_DIR="$SNAPSHOT_DIR"

echo "[run-buy-32397-p95-watchdog] exec=$EXECUTION_ISSUE state=$P95_STATE_FILE snapshot=$SNAPSHOT_DIR" >&2

if [[ ! -f "$SCRIPT_JS" ]]; then
  echo "FATAL: missing $SCRIPT_JS" >&2
  exit 3
fi

node "$SCRIPT_JS"
