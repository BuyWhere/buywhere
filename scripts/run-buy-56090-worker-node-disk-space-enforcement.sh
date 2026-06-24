#!/usr/bin/env bash
# run-buy-56090-worker-node-disk-space-enforcement.sh
# Runner for BUY-56090: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Invokes wc-cycle-cleanup.sh --apply --keep=48 in the Oracle workspace.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_DIR="/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c"
REPORT_PATH="$REPO_ROOT/logs/buy-56090-wc-cycle-enforcement-report.json"
LOG_PATH="$WORKSPACE_DIR/data/_wc_cleanup_log.jsonl"

cleanup_ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

disk_before_pct=$(df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}')
log "Disk before cleanup: ${disk_before_pct}% used"

log "Running wc-cycle-cleanup.sh --apply --keep=48 ..."
inner_exit=0
bash "$SCRIPT_DIR/wc-cycle-cleanup.sh" \
  --apply \
  --keep=48 \
  --workspace-dir="$WORKSPACE_DIR" \
  --alert-pct=90 \
  --log-path="$LOG_PATH" \
  --report-path="$REPORT_PATH" \
  --trash-retention-hours=48 || inner_exit=$?

disk_after_pct=$(df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}')

log "Disk after cleanup: ${disk_after_pct}% used, free=$(df -Pk / | awk 'NR==2 {print $4}')KB used=$(df -Pk / | awk 'NR==2 {print $3}')KB"
log "Report: $REPORT_PATH"

if [ -s "$REPORT_PATH" ]; then
  tmp_report=$(mktemp)
  cp "$REPORT_PATH" "$tmp_report"
  python3 -c "
import json, sys
with open(sys.argv[1], 'r') as f:
    r = json.load(f)
r['ts'] = sys.argv[2]
r['issue'] = 'BUY-56090'
r['disk_before_pct'] = int(sys.argv[3])
r['runner_inner_exit'] = int(sys.argv[4])
r['run_started_at'] = sys.argv[2]
with open(sys.argv[1], 'w') as f:
    json.dump(r, f, indent=2)
" "$tmp_report" "$cleanup_ts" "$disk_before_pct" "$inner_exit"
  mv "$tmp_report" "$REPORT_PATH"
fi

if [ "$inner_exit" -ne 0 ] && [ "$inner_exit" -ne 10 ]; then
  log "WARNING: wc-cycle-cleanup.sh exited with $inner_exit"
  exit "$inner_exit"
fi

log "BUY-56090 enforcement completed. inner_exit=$inner_exit"
log "Disk: before=${disk_before_pct}% after=${disk_after_pct}%"

exit $inner_exit
