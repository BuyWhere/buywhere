#!/usr/bin/env bash
# run-buy-57669-worker-wc-cycle-cleanup.sh
# BUY-57669: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Runs wc-cycle-cleanup.sh --apply --keep=48 against all worker workspaces
# under /paperclip/instances/default/workspaces to delete orphaned WC cycle
# ndjson files older than 48h. Alerts if disk > 90%.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_PATH="$REPO_ROOT/BUY-57669-evidence/apply-report.json"
LOG_PATH="$REPO_ROOT/BUY-57669-evidence/apply-log.jsonl"
DRYRUN_REPORT_PATH="$REPO_ROOT/BUY-57669-evidence/dryrun-report.json"
DRYRUN_LOG_PATH="$REPO_ROOT/BUY-57669-evidence/dryrun-log.jsonl"
EVIDENCE_DIR="$REPO_ROOT/BUY-57669-evidence"

mkdir -p "$EVIDENCE_DIR"

KEEP_HOURS=48

disk_used_pct() {
  df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

disk_pct_before=$(disk_used_pct)
log "Disk before: ${disk_pct_before}% keep_hours=${KEEP_HOURS}"
log "Issue: BUY-57669"
log "Scope: all /paperclip/instances/default/workspaces/*/data"

# Step 1: dryrun pass
log "Running DRY-RUN pass..."
bash "$SCRIPT_DIR/wc-cycle-cleanup.sh" \
  --keep="$KEEP_HOURS" \
  --alert-pct=90 \
  --log-path="$DRYRUN_LOG_PATH" \
  --report-path="$DRYRUN_REPORT_PATH" || true
log "Dry-run complete: $DRYRUN_REPORT_PATH"

# Step 2: apply pass
log "Running APPLY pass..."
bash "$SCRIPT_DIR/wc-cycle-cleanup.sh" \
  --apply \
  --keep="$KEEP_HOURS" \
  --alert-pct=90 \
  --log-path="$LOG_PATH" \
  --report-path="$REPORT_PATH"
inner_exit=$?

if [ -s "$REPORT_PATH" ]; then
  tmp_report=$(mktemp)
  cp "$REPORT_PATH" "$tmp_report"
  python3 -c "
import json, sys
with open(sys.argv[1], 'r') as f:
    r = json.load(f)
r['issue'] = 'BUY-57669'
r['disk_before_pct'] = int(sys.argv[2])
with open(sys.argv[1], 'w') as f:
    json.dump(r, f, indent=2)
" "$tmp_report" "$disk_pct_before"
  mv "$tmp_report" "$REPORT_PATH"
fi

disk_pct_after=$(disk_used_pct)
log "Disk after: ${disk_pct_after}%"
log "Report: $REPORT_PATH"

if [ "$inner_exit" -ne 0 ] && [ "$inner_exit" -ne 10 ]; then
  log "WARNING: wc-cycle-cleanup.sh exited with $inner_exit"
  exit "$inner_exit"
fi

log "BUY-57669 enforcement completed. inner_exit=$inner_exit"
exit $inner_exit
