#!/usr/bin/env bash
# run-buy-57667-worker-disk-enforcement.sh
# BUY-57667: Worker node disk-space enforcement
#
# Enforces disk thresholds across all worker workspaces under WORKSPACES_ROOT.
# Alerts if any workspace root disk > 90%. For BUY-30774 prevention.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
ALERT_PCT="${ALERT_PCT:-90}"
ENFORCE_PCT="${ENFORCE_PCT:-85}"

mkdir -p "$REPO_ROOT/logs"
mkdir -p "$REPO_ROOT/BUY-57667-evidence"
LOG_FILE="$REPO_ROOT/logs/buy-57667-disk-enforcement.log"
REPORT_PATH="$REPO_ROOT/BUY-57667-evidence/enforcement-report.json"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log() { echo "[$(ts)] $*" | tee -a "$LOG_FILE"; }

disk_used_pct() {
  df -Pk "$1" | awk 'NR==2 {gsub("%","",$5); print $5}'
}

disk_free_gb() {
  df -BG "$1" 2>/dev/null | awk 'NR==2 {gsub(/G/,"",$4); print $4}' || echo "0"
}

alert_pct() {
  local pct=$1
  echo "ALERT: Disk usage at ${pct}% exceeds threshold of ${ALERT_PCT}% on buywhere-api worker node" >&2
}

main() {
  local disk_pct
  disk_pct=$(disk_used_pct /)
  local disk_free
  disk_free=$(disk_free_gb /)

  log "BUY-57667 disk enforcement check: disk=${disk_pct}% free=${disk_free}GB threshold=${ALERT_PCT}%"
  log "Scanning workspaces under: $WORKSPACES_ROOT"

  local ws_count=0
  local warned=0

  while IFS= read -r -d '' ws_dir; do
    ws_count=$((ws_count + 1))
    local ws_name
    ws_name="$(basename "$ws_dir")"
    local ws_pct
    ws_pct=$(disk_used_pct "$ws_dir" 2>/dev/null || echo 0)
    if [[ "$ws_pct" -ge "$ENFORCE_PCT" ]]; then
      log "WARNING: workspace=$ws_name disk=${ws_pct}% exceeds enforce=${ENFORCE_PCT}%"
      warned=$((warned + 1))
    fi
  done < <(find "$WORKSPACES_ROOT" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)

  cat > "$REPORT_PATH" <<EOF
{
  "ts": "$(ts)",
  "issue": "BUY-57667",
  "disk_pct": $disk_pct,
  "disk_free_gb": $disk_free,
  "workspaces_scanned": $ws_count,
  "workspaces_warned": $warned,
  "alert_threshold_pct": $ALERT_PCT,
  "enforce_threshold_pct": $ENFORCE_PCT
}
EOF

  log "Scanned $ws_count workspaces, $warned above enforce threshold"
  log "Report: $REPORT_PATH"

  if [[ "$disk_pct" -ge "$ALERT_PCT" ]]; then
    alert_pct "$disk_pct"
    log "WARNING: Disk at ${disk_pct}% - above ${ALERT_PCT}% threshold"
    exit 1
  fi

  log "Disk usage OK: ${disk_pct}% below ${ALERT_PCT}% threshold"
  exit 0
}

main "$@"
