#!/bin/bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# BUY-56424: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Runs wc-cycle-cleanup.sh --apply --keep=48 in this workspace to delete orphaned
# WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents root filesystem hitting 100% (BUY-30774).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$PROJECT_ROOT/scripts/wc-cycle-cleanup.sh"

EVIDENCE_DIR="$PROJECT_ROOT/BUY-56424-evidence"
REPORT_PATH="$EVIDENCE_DIR/apply-report.json"
LOG_PATH="$EVIDENCE_DIR/apply-log.jsonl"
DRYRUN_REPORT_PATH="$EVIDENCE_DIR/dryrun-report.json"
DRYRUN_LOG_PATH="$EVIDENCE_DIR/dryrun-log.jsonl"

mkdir -p "$EVIDENCE_DIR"

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-56424 Worker node WC cycle artifact cleanup starting"
echo "=========================================="

if [[ ! -x "$WC_CLEANUP" ]]; then
  echo "ERROR: wc-cycle-cleanup.sh not found at $WC_CLEANUP" >&2
  exit 1
fi

WORKSPACE_DIR="/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api"

# Step 1: Dry-run pass
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running DRY-RUN pass..."
bash "$WC_CLEANUP" \
  --keep=48 \
  --alert-pct=90 \
  --workspace-dir="$WORKSPACE_DIR" \
  --report-path="$DRYRUN_REPORT_PATH" \
  --log-path="$DRYRUN_LOG_PATH" \
  2>&1 || true
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Dry-run complete. Report: $DRYRUN_REPORT_PATH"

# Step 2: Apply pass
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running APPLY pass..."
bash "$WC_CLEANUP" \
  --apply \
  --keep=48 \
  --alert-pct=90 \
  --workspace-dir="$WORKSPACE_DIR" \
  --report-path="$REPORT_PATH" \
  --log-path="$LOG_PATH" \
  2>&1
EXIT_CODE=$?

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-56424 cleanup completed. exit=$EXIT_CODE"
echo "=========================================="

# Print disk usage
df -h /

exit $EXIT_CODE
