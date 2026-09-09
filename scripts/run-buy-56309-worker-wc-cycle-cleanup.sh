#!/bin/bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# BUY-56309: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Executes wc-cycle-cleanup.sh with --apply --keep=48 to delete orphaned
# WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents root filesystem hitting 100% (BUY-30774).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$PROJECT_ROOT/scripts/wc-cycle-cleanup.sh"

REPORT_PATH="$PROJECT_ROOT/logs/buy-56309-wc-cycle-cleanup-report.json"

mkdir -p "$(dirname "$REPORT_PATH")"

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-56309 Worker node WC cycle artifact cleanup starting"
echo "=========================================="

if [[ ! -x "$WC_CLEANUP" ]]; then
  echo "ERROR: wc-cycle-cleanup.sh not found at $WC_CLEANUP" >&2
  exit 1
fi

# Scope to the Oracle workspace which holds the bulk of stale WC cycle artifacts
bash "$WC_CLEANUP" \
  --apply \
  --keep=48 \
  --alert-pct=90 \
  --workspace-dir=/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c \
  --report-path="$REPORT_PATH" \
  2>&1
EXIT_CODE=$?

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-56309 cleanup completed. exit=$EXIT_CODE"
echo "=========================================="

exit $EXIT_CODE
