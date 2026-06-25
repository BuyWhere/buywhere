#!/usr/bin/env bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# run-buy-57118-worker-wc-cycle-cleanup.sh
# BUY-57118: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Runs wc-cycle-cleanup.sh --apply --keep=48 against the Oracle scrape-data
# workspace (/mnt/scrape-data) to delete orphaned WC cycle ndjson files older
# than 48h. Alerts if disk > 90%.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLEANUP_SCRIPT="$SCRIPT_DIR/wc-cycle-cleanup.sh"

EVIDENCE_DIR="$REPO_ROOT/BUY-57118-evidence"
mkdir -p "$EVIDENCE_DIR"

DATA_DIR="/mnt/scrape-data"
KEEP_HOURS=48
ALERT_PCT=90

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }
disk_used_pct() { df -Pk / | awk '''NR==2{gsub( "%","",$5);print $5}'''; }

RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
disk_pct_before=$(disk_used_pct)

log "=== BUY-57118 Worker node WC cycle artifact cleanup ==="
log "Data dir: $DATA_DIR  keep=${KEEP_HOURS}h  alert=${ALERT_PCT}%"
log "Disk before: ${disk_pct_before}%"

if [ ! -d "$DATA_DIR" ]; then
  log "ERROR: Data dir $DATA_DIR not found"
  exit 1
fi

# Dry-run pass
log "DRY-RUN pass..."
bash "$CLEANUP_SCRIPT"   --keep="$KEEP_HOURS"   --alert-pct="$ALERT_PCT"   --workspace-dir="$DATA_DIR"   --log-path="$EVIDENCE_DIR/dryrun-log.jsonl"   --report-path="$EVIDENCE_DIR/dryrun-report.json"   2>&1 | tee "$EVIDENCE_DIR/dryrun-output.txt"
DRYRUN_RESULT="${PIPESTATUS[0]}"

# Apply pass
log "APPLY pass..."
bash "$CLEANUP_SCRIPT"   --apply   --keep="$KEEP_HOURS"   --alert-pct="$ALERT_PCT"   --workspace-dir="$DATA_DIR"   --log-path="$EVIDENCE_DIR/apply-log.jsonl"   --report-path="$EVIDENCE_DIR/apply-report.json"   2>&1 | tee "$EVIDENCE_DIR/apply-output.txt"
APPLY_EXIT="${PIPESTATUS[0]}"

disk_pct_after=$(disk_used_pct)

df -h / > "$EVIDENCE_DIR/disk-after.txt"
echo "$disk_pct_before" > "$EVIDENCE_DIR/disk-pct-before.txt"
echo "$disk_pct_after" > "$EVIDENCE_DIR/disk-pct-after.txt"

log "Disk before: ${disk_pct_before}%  Disk after: ${disk_pct_after}%"
log "Cleanup log: $DATA_DIR/_wc_cleanup_log.jsonl"
log "Evidence: $EVIDENCE_DIR/"
log "=== BUY-57118 completed. exit=$APPLY_EXIT ==="

exit $APPLY_EXIT
