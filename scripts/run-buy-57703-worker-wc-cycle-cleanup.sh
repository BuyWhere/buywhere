#!/usr/bin/env bash
# run-buy-57703-worker-wc-cycle-cleanup.sh
# BUY-57703: WC cycle artifact cleanup for worker nodes
#
# Runs the WC cycle cleanup across all worker workspaces.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WC_CLEANUP="$REPO_ROOT/scripts/wc-cycle-cleanup.sh"
EVIDENCE_DIR="$REPO_ROOT/BUY-57703-evidence"
LOG_FILE="$REPO_ROOT/logs/buy-57703-wc-cycle-cleanup.log"

mkdir -p "$EVIDENCE_DIR" "$REPO_ROOT/logs"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] BUY-57703: $*"; }

WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
KEEP_HOURS="${KEEP_HOURS:-48}"
ALERT_PCT="${ALERT_PCT:-90}"

export WORKSPACES_ROOT KEEP_HOURS ALERT_PCT

log "Starting WC cycle cleanup run"
log "Workspaces root: $WORKSPACES_ROOT"
log "Retention: ${KEEP_HOURS}h"
log "Log file: $LOG_FILE"

bash "$WC_CLEANUP" \
    --apply \
    --keep="$KEEP_HOURS" \
    --alert-pct="$ALERT_PCT" \
    --log-path="$LOG_FILE" \
    2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

# Capture final state
FINAL_STATE="$EVIDENCE_DIR/cleanup-$(date +%Y%m%dT%H%M%S).json"
{
    echo "{"
    echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
    echo "  \"workspaces_root\": \"$WORKSPACES_ROOT\","
    echo "  \"keep_hours\": $KEEP_HOURS,"
    echo "  \"alert_pct\": $ALERT_PCT,"
    echo "  \"exit_code\": $EXIT_CODE"
    echo "}"
} > "$FINAL_STATE"

log "Cleanup run complete. Exit code: $EXIT_CODE"
exit $EXIT_CODE
