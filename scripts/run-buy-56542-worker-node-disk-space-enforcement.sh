#!/usr/bin/env bash
# DEPRECATED by BUY-57311. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# run-buy-56542-worker-node-disk-space-enforcement.sh
# BUY-56542: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Runs wc-cycle-cleanup.sh --apply --keep=48 in Oracle workspace to delete
# orphaned WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents the root filesystem hitting 100% (BUY-30774).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_DIR="/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c"
REPORT_PATH="$REPO_ROOT/logs/buy-56542-wc-cycle-enforcement-report.json"
LOG_PATH="$WORKSPACE_DIR/data/_wc_cleanup_log.jsonl"
mkdir -p "$REPO_ROOT/logs"

RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

disk_used_pct() {
  df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

inner_exit=0
disk_pct_before=$(disk_used_pct)
KEEP_HOURS=48

log "Disk before: ${disk_pct_before}% keep_hours=${KEEP_HOURS}"
log "Workspace: $WORKSPACE_DIR"
log "Issue: BUY-56542"

bash "$SCRIPT_DIR/wc-cycle-cleanup.sh" \
  --apply \
  --keep="$KEEP_HOURS" \
  --workspace-dir="$WORKSPACE_DIR" \
  --alert-pct=90 \
  --log-path="$LOG_PATH" \
  --report-path="$REPORT_PATH" || inner_exit=$?

if [ -s "$REPORT_PATH" ]; then
  tmp_report=$(mktemp)
  cp "$REPORT_PATH" "$tmp_report"
  python3 -c "
import json, sys
with open(sys.argv[1], 'r') as f:
    r = json.load(f)
r['ts'] = sys.argv[2]
r['issue'] = 'BUY-56542'
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

if [ "$inner_exit" -ne 0 ] && [ "$inner_exit" -ne 10 ]; then
  log "WARNING: wc-cycle-cleanup.sh exited with $inner_exit"
  exit "$inner_exit"
fi

log "BUY-56542 enforcement completed. inner_exit=$inner_exit"
exit $inner_exit
