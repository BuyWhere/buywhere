#!/usr/bin/env bash
# run-buy-58656-worker-wc-cycle-cleanup.sh
# BUY-58656: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Runs wc-cycle-cleanup.sh --apply --keep=48 across all worker workspaces to
# delete (trash) orphaned WC cycle ndjson files older than 48h and purge trash
# older than the retention window. Alerts if disk > 90%.
# Prevents the root filesystem hitting 100% (BUY-30774).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Default: scan ALL worker workspaces under WORKSPACES_ROOT (no --workspace-dir).
# Override with WORKSPACE_DIR to scope to a single workspace.
WORKSPACE_DIR="${WORKSPACE_DIR:-}"
WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
REPORT_PATH="$REPO_ROOT/logs/buy-58656-wc-cycle-enforcement-report.json"
LOG_PATH="${LOG_PATH:-$WORKSPACES_ROOT/logs/buy58656_wc_cycle_cleanup_log.jsonl}"
mkdir -p "$REPO_ROOT/logs" "$(dirname "$LOG_PATH")"

RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

disk_used_pct() {
  df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

inner_exit=0
disk_pct_before=$(disk_used_pct)
KEEP_HOURS=48

log "BUY-58656 enforcement starting"
log "Disk before: ${disk_pct_before}% keep_hours=${KEEP_HOURS} alert_pct=90"
if [ -n "$WORKSPACE_DIR" ]; then
  log "Scope: single workspace $WORKSPACE_DIR"
else
  log "Scope: all worker workspaces under $WORKSPACES_ROOT"
fi

args=(
  --apply
  --keep="$KEEP_HOURS"
  --alert-pct=90
  --log-path="$LOG_PATH"
  --report-path="$REPORT_PATH"
)
if [ -n "$WORKSPACE_DIR" ]; then
  args+=(--workspace-dir="$WORKSPACE_DIR")
fi

bash "$SCRIPT_DIR/wc-cycle-cleanup.sh" "${args[@]}" || inner_exit=$?

if [ -s "$REPORT_PATH" ]; then
  tmp_report=$(mktemp)
  cp "$REPORT_PATH" "$tmp_report"
  python3 -c "
import json, sys
with open(sys.argv[1], 'r') as f:
    r = json.load(f)
r['ts'] = sys.argv[2]
r['issue'] = 'BUY-58656'
r['keep_hours'] = int(sys.argv[3])
r['disk_before_pct'] = int(sys.argv[4])
r['run_started_at'] = sys.argv[2]
with open(sys.argv[1], 'w') as f:
    json.dump(r, f, indent=2)
" "$tmp_report" "$RUN_TS" "$KEEP_HOURS" "$disk_pct_before"
  mv "$tmp_report" "$REPORT_PATH"
fi

disk_pct_after=$(disk_used_pct)
log "Disk after: ${disk_pct_after}%"
log "Report: $REPORT_PATH"

# Exit codes: 0 = clean / below alert; 10 = disk alert raised (>90%); others = error.
if [ "$inner_exit" -ne 0 ] && [ "$inner_exit" -ne 10 ]; then
  log "WARNING: wc-cycle-cleanup.sh exited with $inner_exit"
  exit "$inner_exit"
fi

log "BUY-58656 enforcement completed. inner_exit=$inner_exit"
exit $inner_exit
