#!/bin/bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# BUY-57085: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Runs wc-cycle-cleanup.sh --apply --keep=48 across ALL workspaces to delete orphaned
# WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents root filesystem hitting 100% (BUY-30774).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$PROJECT_ROOT/scripts/wc-cycle-cleanup.sh"

EVIDENCE_DIR="$PROJECT_ROOT/BUY-57085-evidence"
DISK_BEFORE="$EVIDENCE_DIR/disk-before.txt"
DISK_AFTER="$EVIDENCE_DIR/disk-after.txt"
DISK_BEFORE_PCT="$EVIDENCE_DIR/disk-pct-before.txt"
DISK_AFTER_PCT="$EVIDENCE_DIR/disk-pct-after.txt"
SUMMARY="$EVIDENCE_DIR/summary.txt"

mkdir -p "$EVIDENCE_DIR"

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-57085 Worker node WC cycle artifact cleanup starting"
echo "=========================================="

if [[ ! -x "$WC_CLEANUP" ]]; then
  echo "ERROR: wc-cycle-cleanup.sh not found or not executable at $WC_CLEANUP" >&2
  exit 1
fi

# Disk snapshot before
df -P / > "$DISK_BEFORE"
df -P / | awk 'NR==2 {gsub("%","",$5); print $5}' > "$DISK_BEFORE_PCT"
DISK_BEFORE_PCT_VAL=$(cat "$DISK_BEFORE_PCT")
echo "Disk before: ${DISK_BEFORE_PCT_VAL}%"

# Step 1: Dry-run pass
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running DRY-RUN pass..."
bash "$WC_CLEANUP" --keep=48 --alert-pct=90 2>&1 || true
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Dry-run complete."

# Step 2: Apply pass
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running APPLY pass..."
bash "$WC_CLEANUP" --apply --keep=48 --alert-pct=90 2>&1
EXIT_CODE=$?

# Disk snapshot after
df -P / > "$DISK_AFTER"
df -P / | awk 'NR==2 {gsub("%","",$5); print $5}' > "$DISK_AFTER_PCT"
DISK_AFTER_PCT_VAL=$(cat "$DISK_AFTER_PCT")

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-57085 cleanup completed. exit=$EXIT_CODE"
echo "=========================================="
echo "Disk before: ${DISK_BEFORE_PCT_VAL}% | Disk after: ${DISK_AFTER_PCT_VAL}%"

cat > "$SUMMARY" <<EOF
BUY-57085 WC Cycle Cleanup Summary
===================================
Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Disk before: ${DISK_BEFORE_PCT_VAL}%
Disk after: ${DISK_AFTER_PCT_VAL}%
Keep threshold: 48h
Alert threshold: 90%
Exit code: ${EXIT_CODE}
Status: $(if [ "$DISK_AFTER_PCT_VAL" -ge 90 ] 2>/dev/null; then echo "ALERT - disk above 90%"; else echo "OK - disk within safe range"; fi)
EOF

cat "$SUMMARY"

exit $EXIT_CODE
