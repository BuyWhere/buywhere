#!/bin/bash
# DEPRECATED by BUY-57311. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# BUY-56941: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Runs wc-cycle-cleanup.sh --apply --keep=48 across all workspaces to delete orphaned
# WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents root filesystem hitting 100% (BUY-30774).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$PROJECT_ROOT/scripts/wc-cycle-cleanup.sh"

EVIDENCE_DIR="$PROJECT_ROOT/BUY-56941-evidence"
REPORT_PATH="$EVIDENCE_DIR/apply-report.json"
LOG_PATH="$EVIDENCE_DIR/apply-log.jsonl"
DRYRUN_REPORT_PATH="$EVIDENCE_DIR/dryrun-report.json"
DRYRUN_LOG_PATH="$EVIDENCE_DIR/dryrun-log.jsonl"

mkdir -p "$EVIDENCE_DIR"

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-56941 Worker node WC cycle artifact cleanup starting"
echo "=========================================="

if [[ ! -x "$WC_CLEANUP" ]]; then
  echo "ERROR: wc-cycle-cleanup.sh not found or not executable at $WC_CLEANUP" >&2
  exit 1
fi

# Capture disk before
df -P / > "$EVIDENCE_DIR/disk-before.txt" 2>&1
df -P / | awk 'NR==2{gsub("%","",$5);print $5}' > "$EVIDENCE_DIR/disk-pct-before.txt" 2>&1

# Step 1: Dry-run pass
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running DRY-RUN pass..."
bash "$WC_CLEANUP"   --keep=48   --alert-pct=90   --report="$DRYRUN_REPORT_PATH"   --log-jsonl="$DRYRUN_LOG_PATH"   2>&1 || true
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Dry-run complete."

# Step 2: Apply pass
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running APPLY pass..."
bash "$WC_CLEANUP"   --apply   --keep=48   --alert-pct=90   --report="$REPORT_PATH"   --log-jsonl="$LOG_PATH"   2>&1
EXIT_CODE=$?

# Capture disk after
df -P / > "$EVIDENCE_DIR/disk-after.txt" 2>&1
df -P / | awk 'NR==2{gsub("%","",$5);print $5}' > "$EVIDENCE_DIR/disk-pct-after.txt" 2>&1

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-56941 cleanup completed. exit=$EXIT_CODE"
echo "=========================================="

df -h /
