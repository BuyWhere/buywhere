#!/usr/bin/env bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# run-buy-57192-worker-wc-cycle-cleanup.sh
# BUY-57192: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Runs wc-cycle-cleanup.sh --apply --keep=48 against the Oracle scrape-data
# workspace (/mnt/paperclip_scrape_data) to delete orphaned WC cycle ndjson
# files older than 48h. Alerts if disk > 90%.
# Prevents the root filesystem hitting 100% (BUY-30774).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLEANUP_SCRIPT="$SCRIPT_DIR/wc-cycle-cleanup.sh"

EVIDENCE_DIR="$REPO_ROOT/BUY-57192-evidence"
mkdir -p "$EVIDENCE_DIR"

DATA_DIR="/mnt/paperclip_scrape_data"
KEEP_HOURS=48
ALERT_PCT=90

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

disk_used_pct() { df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'; }

RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
disk_pct_before=$(disk_used_pct)

log "=== BUY-57192 Worker node WC cycle artifact cleanup ==="
log "Data dir: $DATA_DIR  keep=${KEEP_HOURS}h  alert=${ALERT_PCT}%"
log "Disk before: ${disk_pct_before}%"

if [ ! -d "$DATA_DIR" ]; then
  log "ERROR: Data dir $DATA_DIR not found"
  exit 1
fi

# Dry-run pass
log "DRY-RUN pass..."
bash "$CLEANUP_SCRIPT" \
  --keep="$KEEP_HOURS" \
  --alert-pct="$ALERT_PCT" \
  "$DATA_DIR" 2>&1 | tee "$EVIDENCE_DIR/dryrun-output.txt"
DRYRUN_RESULT="${PIPESTATUS[0]}"

# Extract stats from dry-run summary line
grep '^--- ' "$EVIDENCE_DIR/dryrun-output.txt" > "$EVIDENCE_DIR/dryrun-summary.txt" || true

# Apply pass
log "APPLY pass..."
bash "$CLEANUP_SCRIPT" \
  --apply \
  --keep="$KEEP_HOURS" \
  --alert-pct="$ALERT_PCT" \
  "$DATA_DIR" 2>&1 | tee "$EVIDENCE_DIR/apply-output.txt"
APPLY_EXIT="${PIPESTATUS[0]}"

grep '^--- ' "$EVIDENCE_DIR/apply-output.txt" > "$EVIDENCE_DIR/apply-summary.txt" || true
grep '^ALERT' "$EVIDENCE_DIR/apply-output.txt" > "$EVIDENCE_DIR/alerts.txt" || true

disk_pct_after=$(disk_used_pct)

# Capture disk snapshots
df -h / > "$EVIDENCE_DIR/disk-after.txt"
echo "$disk_pct_before" > "$EVIDENCE_DIR/disk-pct-before.txt"
echo "$disk_pct_after" > "$EVIDENCE_DIR/disk-pct-after.txt"

log "Disk after: ${disk_pct_after}%"
log "Cleanup log: $DATA_DIR/_wc_cleanup_log.jsonl"
log "Evidence: $EVIDENCE_DIR/"
log "=== BUY-57192 completed. exit=$APPLY_EXIT ==="

exit $APPLY_EXIT
