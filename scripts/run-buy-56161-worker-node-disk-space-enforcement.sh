#!/usr/bin/env bash
# run-buy-56161-worker-node-disk-space-enforcement.sh
# BUY-56161: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Tiered cleanup for the Oracle workspace. Adapts retention based on current
# root filesystem pressure (learned from BUY-56120). Alerts if disk > 90%.
# Prevents root filesystem from hitting 100% (BUY-30774).
#
# Tiered policy:
#   <80% used : keep=48h   (baseline)
#   80-90%    : keep=24h
#   90-95%    : keep=6h
#   >=95%     : keep=1h    + purge all trash
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_DIR="/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c"
REPORT_PATH="$REPO_ROOT/logs/buy-56161-wc-cycle-enforcement-report.json"
LOG_PATH="$WORKSPACE_DIR/data/_wc_cleanup_log.jsonl"

RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

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

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

inner_exit=0

disk_pct_before=$(disk_used_pct)
TIER=$(pick_tier "$disk_pct_before")
KEEP_HOURS=$(keep_hours_for_tier "$TIER")
TRASH_RETENTION=$(trash_retention_for_tier "$TIER")

log "Disk before: ${disk_pct_before}% tier=$TIER keep_hours=$KEEP_HOURS trash_retention_hours=$TRASH_RETENTION"
log "Workspace: $WORKSPACE_DIR"

bash "$SCRIPT_DIR/wc-cycle-cleanup.sh" \
  --apply \
  --keep="$KEEP_HOURS" \
  --workspace-dir="$WORKSPACE_DIR" \
  --alert-pct=90 \
  --log-path="$LOG_PATH" \
  --report-path="$REPORT_PATH" \
  --trash-retention-hours="$TRASH_RETENTION" || inner_exit=$?

if [ -s "$REPORT_PATH" ]; then
  tmp_report=$(mktemp)
  cp "$REPORT_PATH" "$tmp_report"
  python3 -c "
import json, sys
with open(sys.argv[1], 'r') as f:
    r = json.load(f)
r['ts'] = sys.argv[2]
r['issue'] = 'BUY-56161'
r['tier'] = sys.argv[3]
r['keep_hours'] = int(sys.argv[4])
r['trash_retention_hours'] = int(sys.argv[5])
r['disk_before_pct'] = int(sys.argv[6])
r['run_started_at'] = sys.argv[2]
with open(sys.argv[1], 'w') as f:
    json.dump(r, f, indent=2)
" "$tmp_report" "$RUN_TS" "$TIER" "$KEEP_HOURS" "$TRASH_RETENTION" "$disk_pct_before"
  mv "$tmp_report" "$REPORT_PATH"
fi

disk_pct_after=$(disk_used_pct)
log "Disk after: ${disk_pct_after}%"
log "Report: $REPORT_PATH"

if [ "$inner_exit" -ne 0 ] && [ "$inner_exit" -ne 10 ]; then
  log "WARNING: wc-cycle-cleanup.sh exited with $inner_exit"
  exit "$inner_exit"
fi

log "BUY-56161 enforcement completed. inner_exit=$inner_exit"
exit $inner_exit
