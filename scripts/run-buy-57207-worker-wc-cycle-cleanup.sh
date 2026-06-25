#!/bin/bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# BUY-57207: Worker node disk-space enforcement (WC cycle artifact cleanup)
set -euo pipefail

WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
EVIDENCE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/BUY-57207-evidence
mkdir -p "$EVIDENCE"

echo "=== BUY-57207 WC cycle artifact cleanup ==="
date -u
df -h / | tee "$EVIDENCE/disk-before.txt"

# Run the cleanup script for all workspaces
/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/scripts/wc-cycle-cleanup.sh \
  --apply \
  --keep=48 \
  --alert-pct=90 \
  --log-path="$WORKSPACES_ROOT/logs/buy57207_wc_cycle_cleanup_log.jsonl" \
  --report-path="$EVIDENCE/buy57207_wc_cycle_cleanup_report.json"

REPORT_JSON=$(cat "$EVIDENCE/buy57207_wc_cycle_cleanup_report.json")
ALERT_REQUIRED=$(echo "$REPORT_JSON" | jq -r '.alert_required')
DISK_AFTER_PCT=$(echo "$REPORT_JSON" | jq -r '.disk_after_pct')
ALERT_THRESHOLD_PCT=$(echo "$REPORT_JSON" | jq -r '.alert_threshold_pct')

echo "--- report (full details in $EVIDENCE/buy57207_wc_cycle_cleanup_report.json) ---"
cat "$EVIDENCE/buy57207_wc_cycle_cleanup_report.json"

df -h / | tee "$EVIDENCE/disk-after.txt"

echo "=== Summary ==="
echo "Cleanup completed."
echo "Disk usage after cleanup: ${DISK_AFTER_PCT}% (alert threshold: ${ALERT_THRESHOLD_PCT}%)"
if [ "$ALERT_REQUIRED" = "1" ]; then
  echo "ALERT: Disk usage (${DISK_AFTER_PCT}%) is above the threshold (${ALERT_THRESHOLD_PCT}%)."
  exit 1
else
  echo "Disk usage is healthy."
fi

echo "=== BUY-57207 completed ==="
