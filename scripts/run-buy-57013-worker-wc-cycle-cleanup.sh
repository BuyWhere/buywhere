#!/bin/bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# BUY-57013: Worker node disk-space enforcement (WC cycle artifact cleanup)
# Runs wc-cycle-cleanup.sh --apply --keep=48 across ALL workspaces to delete orphaned
# WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents root filesystem hitting 100% (BUY-30774).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$PROJECT_ROOT/scripts/wc-cycle-cleanup.sh"

EVIDENCE_DIR="$PROJECT_ROOT/BUY-57013-evidence"
DISK_BEFORE="$EVIDENCE_DIR/disk-before.txt"
DISK_AFTER="$EVIDENCE_DIR/disk-after.txt"
DISK_PCT_BEFORE="$EVIDENCE_DIR/disk-pct-before.txt"
DISK_PCT_AFTER="$EVIDENCE_DIR/disk-pct-after.txt"
DRYRUN_OUT="$EVIDENCE_DIR/dryrun-output.txt"
APPLY_OUT="$EVIDENCE_DIR/apply-output.txt"
REPORT_JSON="$EVIDENCE_DIR/cleanup-report.json"

mkdir -p "$EVIDENCE_DIR"

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-57013 Worker node WC cycle artifact cleanup starting"
echo "=========================================="

if [[ ! -x "$WC_CLEANUP" ]]; then
  echo "ERROR: wc-cycle-cleanup.sh not found at $WC_CLEANUP" >&2
  exit 1
fi

# Disk snapshot before
df -P / > "$DISK_BEFORE"
df -P / | awk 'NR==2 {gsub("%","",$5); print $5}' > "$DISK_PCT_BEFORE"
DISK_PCT_BEFORE_VAL=$(cat "$DISK_PCT_BEFORE")
echo "Disk before: ${DISK_PCT_BEFORE_VAL}%"

# Discover workspaces that actually have a data/ dir worth scanning
WORKSPACES=$(find /paperclip/instances/default/workspaces -mindepth 1 -maxdepth 1 -type d -exec test -d "{}/data" \; -print 2>/dev/null | sort)
WS_COUNT=$(echo "$WORKSPACES" | wc -l)
echo "Workspaces with data/: $WS_COUNT"

# Step 1: Dry-run across each workspace (aggregate what WOULD be deleted)
echo ""
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running DRY-RUN pass per workspace..."
: > "$DRYRUN_OUT"
for ws in $WORKSPACES; do
  echo "--- workspace=$ws ---" >> "$DRYRUN_OUT"
  bash "$WC_CLEANUP" --keep=48 --alert-pct=90 "$ws/data" >> "$DRYRUN_OUT" 2>&1 || true
done
DRYRUN_LINES=$(wc -l < "$DRYRUN_OUT")
DRYRUN_WOULD=$(grep -c 'would-delete' "$DRYRUN_OUT" 2>/dev/null || echo 0)
echo "Dry-run: lines=$DRYRUN_LINES would-delete matches=$DRYRUN_WOULD"

# Step 2: Apply pass per workspace
echo ""
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running APPLY pass per workspace..."
APPLY_EXIT=0
: > "$APPLY_OUT"
for ws in $WORKSPACES; do
  echo "--- workspace=$ws ---" >> "$APPLY_OUT"
  bash "$WC_CLEANUP" --apply --keep=48 --alert-pct=90 "$ws/data" >> "$APPLY_OUT" 2>&1 || APPLY_EXIT=$?
done
echo "Apply exit code: $APPLY_EXIT"

# Disk snapshot after
df -P / > "$DISK_AFTER"
df -P / | awk 'NR==2 {gsub("%","",$5); print $5}' > "$DISK_PCT_AFTER"
DISK_PCT_AFTER_VAL=$(cat "$DISK_PCT_AFTER")
echo "Disk after: ${DISK_PCT_AFTER_VAL}%"

# Compute freed space from disk used delta
DISK_USED_BEFORE=$(df -P / | awk 'NR==2 {print $3}')
DISK_USED_AFTER=$(df -P / | awk 'NR==2 {print $3}')
RECLAIMED_KB=$(( DISK_USED_BEFORE - DISK_USED_AFTER ))
if [ "$RECLAIMED_KB" -lt 0 ]; then RECLAIMED_KB=0; fi

# Aggregate per-workspace log entries written during THIS run
echo ""
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Aggregating per-workspace stats..."
TOTAL_DELETED=0
for ws in $WORKSPACES; do
  log="$ws/data/_wc_cleanup_log.jsonl"
  [ -f "$log" ] || continue
  # Count lines whose ts is within last 10 minutes (this run)
  recent=$(awk '
    {
      match($0, /"ts":"([^"]+)"/, m); if (!m[1]) next
      cmd = "date -u -d \"" m[1] "\" +%s"; cmd | getline epoch; close(cmd)
      now = systime()
      if (epoch + 0 >= now - 600) print
    }' "$log" | wc -l)
  TOTAL_DELETED=$((TOTAL_DELETED + recent))
done

# Extract apply-pass summary line(s)
APPLY_SUMMARY=$(grep -E '^--- deleted=' "$APPLY_OUT" | tail -1 || echo "no-summary")

# Alert if disk > 90%
ALERT_THRESHOLD=90
ALERT_REQUIRED=0
ALERT_LINE=""
if [ "${DISK_PCT_AFTER_VAL}" -ge "$ALERT_THRESHOLD" ] 2>/dev/null; then
  ALERT_REQUIRED=1
  ALERT_LINE="ALERT disk=${DISK_PCT_AFTER_VAL}% >= ${ALERT_THRESHOLD}% after cleanup - escalate (Railway volume resize or ingest-side retention policy per BUY-30774)"
  echo "$ALERT_LINE" >&2
fi

# Write JSON report
DISK_FREE_AFTER=$(df -P / | awk 'NR==2 {print $4}')
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SUMMARY_ESC=$(printf '%s' "$APPLY_SUMMARY" | sed 's/"/\\"/g' | head -c 500)

cat > "$REPORT_JSON" <<EOF
{
  "issue": "BUY-57013",
  "ts": "$TS",
  "workspace_count": $WS_COUNT,
  "apply_exit_code": $APPLY_EXIT,
  "disk_pct_before": $DISK_PCT_BEFORE_VAL,
  "disk_pct_after": $DISK_PCT_AFTER_VAL,
  "disk_used_kb_before": $DISK_USED_BEFORE,
  "disk_used_kb_after": $DISK_USED_AFTER,
  "reclaimed_kb": $RECLAIMED_KB,
  "disk_free_kb_after": $DISK_FREE_AFTER,
  "dryrun_lines": $DRYRUN_LINES,
  "dryrun_would_delete_matches": $DRYRUN_WOULD,
  "log_entries_this_run": $TOTAL_DELETED,
  "apply_summary_line": "$SUMMARY_ESC",
  "alert_threshold_pct": $ALERT_THRESHOLD,
  "alert_required": $ALERT_REQUIRED,
  "alert_message": "$ALERT_LINE"
}
EOF

echo "=========================================="
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] BUY-57013 cleanup completed. exit=$APPLY_EXIT"
echo "Report: $REPORT_JSON"
echo "=========================================="

cat "$REPORT_JSON"
echo ""

exit $APPLY_EXIT
