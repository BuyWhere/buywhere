#!/usr/bin/env bash
# run-buy-56120-worker-node-disk-space-enforcement.sh
# BUY-56120: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Comprehensive disk enforcement that scans ALL worker workspaces (not just
# one hardcoded workspace like BUY-56046/56095), uses tiered retention based
# on current root filesystem pressure, and aggressively reclaims space when
# thresholds are crossed.
#
# Tiered policy (driven by current root filesystem usage):
#   <80% used : --keep=48   (baseline 48h WC cycle retention)
#   80-90%    : --keep=24
#   90-95%    : --keep=6
#   >=95%     : --keep=1   + purge all trash + delete WC summary sidecars
#
# Runs hourly via cron (see setup-buy-56120-...).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
LOG_DIR="$REPO_ROOT/logs"
mkdir -p "$LOG_DIR"
REPORT_PATH="$LOG_DIR/buy-56120-wc-cycle-enforcement-report.json"
LOG_PATH="$LOG_DIR/buy-56120-wc-cycle-enforcement-log.jsonl"
ALERT_PCT="${ALERT_PCT:-90}"
RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REPO_WORKSPACE_DIR="$REPO_ROOT"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

disk_used_pct() {
  df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

pick_tier() {
  local pct="$1"
  if [ "$pct" -ge 95 ]; then
    echo "critical"
  elif [ "$pct" -ge 90 ]; then
    echo "high"
  elif [ "$pct" -ge 80 ]; then
    echo "elevated"
  else
    echo "normal"
  fi
}

keep_hours_for_tier() {
  case "$1" in
    normal)    echo 48 ;;
    elevated)  echo 24 ;;
    high)      echo 6 ;;
    critical)  echo 1 ;;
    *)         echo 48 ;;
  esac
}

trash_retention_for_tier() {
  case "$1" in
    normal)    echo 48 ;;
    elevated)  echo 24 ;;
    high)      echo 6 ;;
    critical)  echo 0 ;;
    *)         echo 48 ;;
  esac
}

WORKSPACE_COUNT=0
INNER_EXIT_MAX=0
TIER="normal"
KEEP_HOURS=48
TRASH_RETENTION_HOURS=48

cleanup_workspace() {
  local workspace_dir="$1"
  local data_dir="$workspace_dir/data"

  if [ ! -d "$data_dir" ]; then
    return 0
  fi

  if [ "$workspace_dir" = "$REPO_WORKSPACE_DIR" ]; then
    return 0
  fi

  if ! find "$data_dir" -type f \
    \( -name 'cycle-*.ndjson' -o -name 'wc-deep-cycle-*.ndjson' \) \
    ! -path '*/_trash/*' -print -quit 2>/dev/null | grep -q .; then
    return 0
  fi

  log "cleanup workspace=$workspace_dir tier=$TIER keep=${KEEP_HOURS}h trash_retention=${TRASH_RETENTION_HOURS}h"

  local inner_exit=0
  local ws_log_path="$data_dir/_wc_cleanup_log.jsonl"

  bash "$SCRIPT_DIR/wc-cycle-cleanup.sh" \
    --apply \
    --keep="$KEEP_HOURS" \
    --workspace-dir="$workspace_dir" \
    --alert-pct="$ALERT_PCT" \
    --log-path="$ws_log_path" \
    --trash-retention-hours="$TRASH_RETENTION_HOURS" \
    >/dev/null 2>&1 || inner_exit=$?

  if [ -s "$ws_log_path" ]; then
    tail -n 500 "$ws_log_path" >> "$LOG_PATH" 2>/dev/null || true
  fi

  WORKSPACE_COUNT=$((WORKSPACE_COUNT + 1))
  if [ "$inner_exit" -gt "$INNER_EXIT_MAX" ]; then
    INNER_EXIT_MAX=$inner_exit
  fi
}

purge_global_artifacts() {
  if [ "$TIER" != "critical" ]; then
    return 0
  fi
  find "$LOG_DIR" -type f -name '*.log' -mtime +14 -delete 2>/dev/null || true
  find "$LOG_DIR" -type f -name '*.jsonl' -mtime +7 -delete 2>/dev/null || true
  find "$WORKSPACES_ROOT" -maxdepth 3 -type d -name _run_logs -mtime +3 -exec rm -rf {} + 2>/dev/null || true
}

main() {
  local disk_pct_before
  disk_pct_before=$(disk_used_pct)
  TIER=$(pick_tier "$disk_pct_before")
  KEEP_HOURS=$(keep_hours_for_tier "$TIER")
  TRASH_RETENTION_HOURS=$(trash_retention_for_tier "$TIER")

  WORKSPACE_COUNT=0
  INNER_EXIT_MAX=0

  log "Disk before: ${disk_pct_before}% tier=$TIER keep_hours=$KEEP_HOURS trash_retention_hours=$TRASH_RETENTION_HOURS"

  while IFS= read -r -d '' data_dir; do
    local workspace_dir
    workspace_dir="$(dirname "$data_dir")"
    cleanup_workspace "$workspace_dir"
  done < <(
    find "$WORKSPACES_ROOT" -mindepth 2 -maxdepth 3 -type d -name data -print0 2>/dev/null
  )

  purge_global_artifacts

  local disk_pct_after
  disk_pct_after=$(disk_used_pct)
  local alert_required=0
  if [ "$disk_pct_after" -gt "$ALERT_PCT" ]; then
    alert_required=1
  fi

  cat > "$REPORT_PATH" <<EOF
{
  "issue": "BUY-56120",
  "ts": "$RUN_TS",
  "tier": "$TIER",
  "keep_hours": $KEEP_HOURS,
  "trash_retention_hours": $TRASH_RETENTION_HOURS,
  "disk_pct_before": $disk_pct_before,
  "disk_pct_after": $disk_pct_after,
  "disk_free_kb": $(df -Pk / | awk 'NR==2 {print $4}'),
  "disk_used_kb": $(df -Pk / | awk 'NR==2 {print $3}'),
  "workspaces_scanned": $WORKSPACE_COUNT,
  "alert_threshold_pct": $ALERT_PCT,
  "alert_required": $alert_required,
  "inner_exit_max": $INNER_EXIT_MAX,
  "workspaces_root": "$WORKSPACES_ROOT"
}
EOF

  log "Disk after: ${disk_pct_after}% workspaces_scanned=$WORKSPACE_COUNT inner_exit_max=$INNER_EXIT_MAX alert_required=$alert_required"
  log "Report: $REPORT_PATH"

  if [ "$alert_required" = "1" ]; then
    exit 10
  fi
  exit 0
}

main "$@"
