#!/usr/bin/env bash
# run-buy-57654-worker-wc-cycle-cleanup.sh
# BUY-57654: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Runs wc-cycle-cleanup.sh --apply --keep=48 across all workspaces.
# Alerts at > 90% disk. Prevents rootfs hitting 100% (BUY-30774).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$REPO_ROOT/scripts/wc-cycle-cleanup.sh"

EVIDENCE_DIR="$REPO_ROOT/BUY-57654-evidence"
REPORT_PATH="$EVIDENCE_DIR/apply-report.json"
LOG_PATH="$EVIDENCE_DIR/apply-log.jsonl"
DRYRUN_REPORT_PATH="$EVIDENCE_DIR/dryrun-report.json"
DRYRUN_LOG_PATH="$EVIDENCE_DIR/dryrun-log.jsonl"

mkdir -p "$EVIDENCE_DIR"

KEEP_HOURS=48
ALERT_PCT=90
RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

disk_used_pct() {
  df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

disk_pct_before=$(disk_used_pct)
log "BUY-57654: WC cycle artifact cleanup starting"
log "Disk before: ${disk_pct_before}% keep_hours=${KEEP_HOURS} alert_pct=${ALERT_PCT}"

if [[ ! -x "$WC_CLEANUP" ]]; then
  log "ERROR: wc-cycle-cleanup.sh not found or not executable at $WC_CLEANUP"
  exit 1
fi

# Step 1: dry-run
log "Running DRY-RUN pass..."
bash "$WC_CLEANUP" \
  --keep="$KEEP_HOURS" \
  --alert-pct="$ALERT_PCT" \
  --log-path="$DRYRUN_LOG_PATH" \
  --report-path="$DRYRUN_REPORT_PATH" || true
log "Dry-run complete"

# Step 2: apply
log "Running APPLY pass..."
inner_exit=0
bash "$WC_CLEANUP" \
  --apply \
  --keep="$KEEP_HOURS" \
  --alert-pct="$ALERT_PCT" \
  --log-path="$LOG_PATH" \
  --report-path="$REPORT_PATH" || inner_exit=$?

# Annotate report
if [ -s "$REPORT_PATH" ]; then
  tmp_report=$(mktemp)
  cp "$REPORT_PATH" "$tmp_report"
  python3 -c "
import json, sys
with open(sys.argv[1], 'r') as f:
    r = json.load(f)
r['ts'] = sys.argv[2]
r['issue'] = 'BUY-57654'
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

df -h /

if [ "$inner_exit" -ne 0 ] && [ "$inner_exit" -ne 10 ]; then
  log "WARNING: wc-cycle-cleanup.sh exited with $inner_exit"
  exit "$inner_exit"
fi

log "BUY-57654: cleanup completed. inner_exit=$inner_exit disk_before=${disk_pct_before}% disk_after=${disk_pct_after}%"
exit $inner_exit
