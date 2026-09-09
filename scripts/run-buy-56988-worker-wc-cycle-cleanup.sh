#!/bin/bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# BUY-56988: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Runs wc-cycle-cleanup.sh --apply --keep=48 across ALL workspaces to delete orphaned
# WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents root filesystem hitting 100% (BUY-30774).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$PROJECT_ROOT/scripts/wc-cycle-cleanup.sh"

EVIDENCE_DIR="$PROJECT_ROOT/BUY-56988-evidence"
REPORT_PATH="$EVIDENCE_DIR/apply-report.json"
LOG_PATH="$EVIDENCE_DIR/apply-log.jsonl"
DRYRUN_REPORT_PATH="$EVIDENCE_DIR/dryrun-report.json"
DRYRUN_LOG_PATH="$EVIDENCE_DIR/dryrun-log.jsonl"
DISK_BEFORE="$EVIDENCE_DIR/disk-before.txt"
DISK_AFTER="$EVIDENCE_DIR/disk-after.txt"

mkdir -p "$EVIDENCE_DIR"

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-56988 Worker node WC cycle artifact cleanup starting"
echo "=========================================="

if [[ ! -x "$WC_CLEANUP" ]]; then
  echo "ERROR: wc-cycle-cleanup.sh not found at $WC_CLEANUP" >&2
  exit 1
fi

# Disk snapshot before
df -P / > "$DISK_BEFORE"
df -P / | awk 'NR==2 {gsub("%","",$5); print $5}' > "$EVIDENCE_DIR/disk-pct-before.txt"

# Step 1: Dry-run pass (all workspaces)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running DRY-RUN pass (all workspaces)..."
bash "$WC_CLEANUP" \
  --keep=48 \
  --alert-pct=90 \
  --report="$DRYRUN_REPORT_PATH" \
  --log-jsonl="$DRYRUN_LOG_PATH" \
  2>&1 || true
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Dry-run complete. Report: $DRYRUN_REPORT_PATH"

# Step 2: Apply pass (all workspaces)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running APPLY pass (all workspaces)..."
bash "$WC_CLEANUP" \
  --apply \
  --keep=48 \
  --alert-pct=90 \
  --report="$REPORT_PATH" \
  --log-jsonl="$LOG_PATH" \
  2>&1
EXIT_CODE=$?

# Disk snapshot after
df -P / > "$DISK_AFTER"
df -P / | awk 'NR==2 {gsub("%","",$5); print $5}' > "$EVIDENCE_DIR/disk-pct-after.txt"

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-56988 cleanup completed. exit=$EXIT_CODE"
echo "=========================================="

df -h /

if [ -s "$REPORT_PATH" ]; then
  echo "---"
  echo "Report summary:"
  cat "$REPORT_PATH"
fi

exit $EXIT_CODE
