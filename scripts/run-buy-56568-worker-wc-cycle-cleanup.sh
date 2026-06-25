#!/bin/bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# BUY-56568: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Runs wc-cycle-cleanup.sh --apply --keep=48 across all worker workspaces to delete
# orphaned WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents root filesystem hitting 100% (BUY-30774).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$PROJECT_ROOT/scripts/wc-cycle-cleanup.sh"

WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"

EVIDENCE_DIR="$PROJECT_ROOT/BUY-56568-evidence"
REPORT_PATH="$EVIDENCE_DIR/apply-report.json"
LOG_PATH="$EVIDENCE_DIR/apply-log.jsonl"
DRYRUN_REPORT_PATH="$EVIDENCE_DIR/dryrun-report.json"
DRYRUN_LOG_PATH="$EVIDENCE_DIR/dryrun-log.jsonl"

mkdir -p "$EVIDENCE_DIR"

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-56568 Worker node WC cycle artifact cleanup starting"
echo "=========================================="

disk_used_pct() {
  df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

KEEP_HOURS=48
ALERT_PCT=90

disk_pct_before=$(disk_used_pct)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Disk before: ${disk_pct_before}% keep_hours=${KEEP_HOURS}"

if [[ ! -x "$WC_CLEANUP" ]]; then
  echo "ERROR: wc-cycle-cleanup.sh not found at $WC_CLEANUP" >&2
  exit 1
fi

# Step 1: Dry-run pass (no --apply)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running DRY-RUN pass..."
bash "$WC_CLEANUP" \
  --keep="$KEEP_HOURS" \
  --alert-pct="$ALERT_PCT" \
  --report-path="$DRYRUN_REPORT_PATH" \
  --log-path="$DRYRUN_LOG_PATH" \
  2>&1 || true
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Dry-run complete. Report: $DRYRUN_REPORT_PATH"

# Step 2: Apply pass (--apply moves files to trash)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running APPLY pass..."
bash "$WC_CLEANUP" \
  --apply \
  --keep="$KEEP_HOURS" \
  --alert-pct="$ALERT_PCT" \
  --report-path="$REPORT_PATH" \
  --log-path="$LOG_PATH" \
  2>&1
EXIT_CODE=$?

disk_pct_after=$(disk_used_pct)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Disk after: ${disk_pct_after}%"

# Annotate reports with issue identifier, keep_hours, and disk_before_pct
for r in "$DRYRUN_REPORT_PATH" "$REPORT_PATH"; do
  if [ -s "$r" ]; then
    tmp=$(mktemp)
    cp "$r" "$tmp"
    python3 -c "
import json, sys
with open(sys.argv[1], 'r') as f:
    r = json.load(f)
r['issue'] = 'BUY-56568'
r['keep_hours'] = int(sys.argv[2])
r['disk_before_pct'] = int(sys.argv[3])
r['alert_pct'] = int(sys.argv[4])
r['parent_epic'] = 'BUY-30774'
with open(sys.argv[1], 'w') as f:
    json.dump(r, f, indent=2)
" "$tmp" "$KEEP_HOURS" "$disk_pct_before" "$ALERT_PCT"
    mv "$tmp" "$r"
  fi
done

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-56568 cleanup completed. exit=$EXIT_CODE disk_before=${disk_pct_before}% disk_after=${disk_pct_after}%"
echo "=========================================="

df -h /

exit $EXIT_CODE
