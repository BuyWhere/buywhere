#!/bin/bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# BUY-57000: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Runs wc-cycle-cleanup.sh --apply --keep=48 across ALL workspaces to delete orphaned
# WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents root filesystem hitting 100% (BUY-30774).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$PROJECT_ROOT/scripts/wc-cycle-cleanup.sh"

EVIDENCE_DIR="$PROJECT_ROOT/BUY-57000-evidence"
DISK_BEFORE="$EVIDENCE_DIR/disk-before.txt"
DISK_AFTER="$EVIDENCE_DIR/disk-after.txt"

mkdir -p "$EVIDENCE_DIR"

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-57000 Worker node WC cycle artifact cleanup starting"
echo "=========================================="

if [[ ! -x "$WC_CLEANUP" ]]; then
  echo "ERROR: wc-cycle-cleanup.sh not found at $WC_CLEANUP" >&2
  exit 1
fi

# Disk snapshot before
df -P / > "$DISK_BEFORE"
df -P / | awk 'NR==2 {gsub("%","",$5); print $5}' > "$EVIDENCE_DIR/disk-pct-before.txt"

# Dry-run pass
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running DRY-RUN pass..."
bash "$WC_CLEANUP" --keep=48 --alert-pct=90 2>&1 | tee "$EVIDENCE_DIR/dryrun-output.txt" || true
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Dry-run complete."

# Apply pass
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running APPLY pass..."
bash "$WC_CLEANUP" --apply --keep=48 --alert-pct=90 2>&1 | tee "$EVIDENCE_DIR/apply-output.txt"
EXIT_CODE=$?

# Disk snapshot after
df -P / > "$DISK_AFTER"
df -P / | awk 'NR==2 {gsub("%","",$5); print $5}' > "$EVIDENCE_DIR/disk-pct-after.txt"

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-57000 cleanup completed. exit=$EXIT_CODE"
echo "=========================================="

df -h /

exit $EXIT_CODE
