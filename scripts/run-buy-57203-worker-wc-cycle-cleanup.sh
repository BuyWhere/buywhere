#!/usr/bin/env bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# run-buy-57203-worker-wc-cycle-cleanup.sh
# BUY-57203: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Runs wc-cycle-cleanup.sh --apply --keep=48 in this workspace to delete
# orphaned WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents root filesystem hitting 100% (BUY-30774).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLEANUP_SCRIPT="$SCRIPT_DIR/wc-cycle-cleanup.sh"

EVIDENCE_DIR="$REPO_ROOT/BUY-57203-evidence"
mkdir -p "$EVIDENCE_DIR"

KEEP_HOURS=48
ALERT_PCT=90

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

disk_used_pct() { df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'; }

RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
disk_pct_before=$(disk_used_pct)

log "=== BUY-57203 Worker node WC cycle artifact cleanup ==="
log "Workspace: $REPO_ROOT  keep=${KEEP_HOURS}h  alert=${ALERT_PCT}%"
log "Disk before: ${disk_pct_before}%"

if [ ! -x "$CLEANUP_SCRIPT" ]; then
  log "ERROR: wc-cycle-cleanup.sh not found at $CLEANUP_SCRIPT"
  exit 1
fi

# Step 1: Dry-run
log "Running DRY-RUN pass..."
DRYRUN_REPORT="$EVIDENCE_DIR/dryrun-report.json"
DRYRUN_LOG="$EVIDENCE_DIR/dryrun-log.jsonl"
bash "$CLEANUP_SCRIPT" \
  --keep="$KEEP_HOURS" \
  --alert-pct="$ALERT_PCT" \
  --workspace-dir="$REPO_ROOT" \
  --report-path="$DRYRUN_REPORT" \
  --log-path="$DRYRUN_LOG" \
  2>&1 | tee "$EVIDENCE_DIR/dryrun-output.txt"
DRYRUN_EXIT=${PIPESTATUS[0]}
log "Dry-run complete. Report: $DRYRUN_REPORT"

# Step 2: Apply pass
log "Running APPLY pass..."
APPLY_REPORT="$EVIDENCE_DIR/apply-report.json"
APPLY_LOG="$EVIDENCE_DIR/apply-log.jsonl"
bash "$CLEANUP_SCRIPT" \
  --apply \
  --keep="$KEEP_HOURS" \
  --alert-pct="$ALERT_PCT" \
  --workspace-dir="$REPO_ROOT" \
  --report-path="$APPLY_REPORT" \
  --log-path="$APPLY_LOG" \
  2>&1 | tee "$EVIDENCE_DIR/apply-output.txt"
APPLY_EXIT=${PIPESTATUS[0]}

grep '^ALERT' "$EVIDENCE_DIR/apply-output.txt" > "$EVIDENCE_DIR/alerts.txt" || true

disk_pct_after=$(disk_used_pct)

echo "$disk_pct_before" > "$EVIDENCE_DIR/disk-pct-before.txt"
echo "$disk_pct_after" > "$EVIDENCE_DIR/disk-pct-after.txt"

log "Disk after: ${disk_pct_after}%"
log "=== BUY-57203 completed. exit=$APPLY_EXIT ==="

cat "$APPLY_REPORT"

exit $APPLY_EXIT
