#!/usr/bin/env bash
# run-buy-58096-worker-disk-enforcement.sh
# BUY-58096: Worker node disk-space enforcement
#
# Checks disk usage; triggers wc-cycle cleanup if > 80%.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLEANUP_RUNNER="$SCRIPT_DIR/run-buy-58096-worker-wc-cycle-cleanup.sh"
THRESHOLD_PCT=80

disk_used_pct() {
  df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

disk_pct=$(disk_used_pct)
log "BUY-58096 disk enforcement: current=${disk_pct}% threshold=${THRESHOLD_PCT}%"

if [ "$disk_pct" -ge "$THRESHOLD_PCT" ]; then
  log "Disk usage (${disk_pct}%) >= threshold (${THRESHOLD_PCT}%) — triggering WC cycle cleanup"
  bash "$CLEANUP_RUNNER"
else
  log "Disk usage (${disk_pct}%) < threshold (${THRESHOLD_PCT}%) — skipping cleanup"
fi

exit 0
