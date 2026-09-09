#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if WORKTREE_ROOT="$(git -C "${SCRIPT_DIR}/.." rev-parse --show-toplevel 2>/dev/null)"; then
  WORKDIR="$WORKTREE_ROOT"
else
  WORKDIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
OUTPUT_DIR="${WORKDIR}/data/carousell-sg"
LOG_FILE="${OUTPUT_DIR}/scraper.log"
MONITOR_LOG="/tmp/carousell-sg-monitor.log"
MONITOR_SCRIPT="${SCRIPT_DIR}/monitor_carousell_sg.sh"

log() {
    echo "[$(date '+%Y-%m-%dT%H:%M:%S')] $1" | tee -a "$MONITOR_LOG"
}

log "Starting continuous Carousell SG monitor loop (PID $$)"

while true; do
    cd "$WORKDIR"
    bash "$MONITOR_SCRIPT" >> "$MONITOR_LOG" 2>&1 || log "ERROR: Monitor script failed"
    sleep 300
done