#!/usr/bin/env bash
# run-buy-57669-worker-disk-enforcement.sh
# BUY-57669: Worker node disk-space enforcement
#
# Enforces disk thresholds across all worker workspaces under WORKSPACES_ROOT.
# Alerts if any workspace root disk > 90%. For BUY-30774 prevention.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENFORCEMENT_SCRIPT="$REPO_ROOT/scripts/worker-node-disk-enforcement.sh"
EVIDENCE_DIR="$REPO_ROOT/BUY-57669-evidence"
LOG_FILE="$REPO_ROOT/logs/buy-57669-disk-enforcement.log"

mkdir -p "$EVIDENCE_DIR" "$REPO_ROOT/logs"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] BUY-57669: $*"; }

# Source Paperclip credentials if available
if [[ -f /home/paperclip/.paperclip_env ]]; then
    . /home/paperclip/.paperclip_env
fi

if [[ ! -x "$ENFORCEMENT_SCRIPT" ]]; then
    log "ERROR: worker-node-disk-enforcement.sh not found at $ENFORCEMENT_SCRIPT"
    exit 1
fi

WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
ENFORCE_PCT="${ENFORCE_PCT:-85}"
CRITICAL_PCT="${CRITICAL_PCT:-95}"
KEEP_HOURS="${KEEP_HOURS:-48}"

export WORKSPACES_ROOT ENFORCE_PCT CRITICAL_PCT KEEP_HOURS

log "Starting disk enforcement run"
log "Workspaces root: $WORKSPACES_ROOT"
log "Enforce threshold: ${ENFORCE_PCT}%, Critical threshold: ${CRITICAL_PCT}%"
log "Log file: $LOG_FILE"

bash "$ENFORCEMENT_SCRIPT" \
    --apply \
    --enforce-pct="$ENFORCE_PCT" \
    --critical-pct="$CRITICAL_PCT" \
    --keep="$KEEP_HOURS" \
    2>&1 | tee -a "$LOG_FILE"

exit ${PIPESTATUS[0]}
