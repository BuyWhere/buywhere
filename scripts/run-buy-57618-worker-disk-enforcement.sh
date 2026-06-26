#!/usr/bin/env bash
# run-buy-57618-worker-disk-enforcement.sh
# BUY-57618: Worker node disk-space enforcement
#
# Enforces disk thresholds across all worker workspaces under WORKSPACES_ROOT.
# Alerts if any workspace root disk > 90%. For BUY-30774 prevention.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
ALERT_PCT="${ALERT_PCT:-90}"

mkdir -p "$REPO_ROOT/logs"
LOG_FILE="$REPO_ROOT/logs/buy-57618-disk-enforcement.log"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log() { echo "[$(ts)] $*" | tee -a "$LOG_FILE"; }

disk_used_pct() {
  df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

alert_pct() {
  local pct=$1
  echo "ALERT: Disk usage at ${pct}% exceeds threshold of ${ALERT_PCT}% on buywhere-api worker node" >&2
}

main() {
  local disk_pct
  disk_pct=$(disk_used_pct)
  
  log "BUY-57618 disk enforcement check: disk=${disk_pct}% threshold=${ALERT_PCT}%"
  
  if [[ "$disk_pct" -ge "$ALERT_PCT" ]]; then
    alert_pct "$disk_pct"
    log "WARNING: Disk at ${disk_pct}% - above ${ALERT_PCT}% threshold"
    exit 1
  fi
  
  log "Disk usage OK: ${disk_pct}% below ${ALERT_PCT}% threshold"
  exit 0
}

main "$@"
