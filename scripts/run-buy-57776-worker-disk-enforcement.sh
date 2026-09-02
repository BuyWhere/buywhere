#!/usr/bin/env bash
# run-buy-57776-worker-disk-enforcement.sh
# BUY-57776: Worker node disk-space enforcement
#
# Checks disk usage on all workspaces and triggers WC cycle cleanup
# when disk usage exceeds 80% threshold.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WORKSPACES_ROOT="/paperclip/instances/default/workspaces"
ENFORCEMENT_THRESHOLD=80
ALERT_THRESHOLD=90
LOG_FILE="$REPO_ROOT/logs/buy-57776-disk-enforcement.log"

disk_used_pct() {
  df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

main() {
  local disk_pct
  disk_pct=$(disk_used_pct)
  
  log "Disk check: ${disk_pct}% (enforcement=${ENFORCEMENT_THRESHOLD}% alert=${ALERT_THRESHOLD}%)"
  
  if [ "$disk_pct" -gt "$ENFORCEMENT_THRESHOLD" ]; then
    log "Triggering WC cycle cleanup (disk > ${ENFORCEMENT_THRESHOLD}%)"
    bash "$SCRIPT_DIR/run-buy-57776-worker-wc-cycle-cleanup.sh"
  else
    log "Disk usage within limits, no cleanup needed"
  fi
  
  # Always check alert threshold
  if [ "$disk_pct" -gt "$ALERT_THRESHOLD" ]; then
    log "ALERT: Disk usage ${disk_pct}% exceeds alert threshold ${ALERT_THRESHOLD}%"
    return 10
  fi
  
  return 0
}

main "$@"
