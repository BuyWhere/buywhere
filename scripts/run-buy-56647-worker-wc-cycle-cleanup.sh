# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# run-buy-56647-worker-wc-cycle-cleanup.sh
# BUY-56647: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Runs wc-cycle-cleanup.sh --apply --keep=48 across ALL workspaces to delete
# orphaned WC cycle ndjson files older than 48h. Alerts if disk > 90%.
# Prevents the root filesystem hitting 100% (BUY-30774).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
EVIDENCE_DIR="$REPO_ROOT/BUY-56647-evidence"
REPORT_PATH="$EVIDENCE_DIR/apply-report.json"
LOG_PATH="$EVIDENCE_DIR/apply-log.jsonl"

mkdir -p "$EVIDENCE_DIR"

RUN_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

disk_used_pct() {
  df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

inner_exit=0
disk_pct_before=$(disk_used_pct)
KEEP_HOURS=48
ALERT_PCT=90

log "BUY-56647 enforcement starting"
log "Disk before: ${disk_pct_before}% keep_hours=${KEEP_HOURS} alert_pct=${ALERT_PCT}"

CLEANUP_OUTPUT=$(bash "$SCRIPT_DIR/wc-cycle-cleanup.sh" \
  --apply \
  --keep="$KEEP_HOURS" \
  --alert-pct="$ALERT_PCT" 2>&1) || inner_exit=$?
echo "$CLEANUP_OUTPUT"

# Parse the summary line
SUMMARY_LINE=$(echo "$CLEANUP_OUTPUT" | grep '^---' | head -1)
if [ -n "$SUMMARY_LINE" ]; then
  DELETED=$(echo "$SUMMARY_LINE" | grep -oP 'deleted=\K\d+' || echo 0)
  SIDECARS=$(echo "$SUMMARY_LINE" | grep -oP 'sidecars=\K\d+' || echo 0)
  TRASH_PURGED=$(echo "$SUMMARY_LINE" | grep -oP 'trash_purged=\K\d+' || echo 0)
  FREED_GB=$(echo "$SUMMARY_LINE" | grep -oP 'freed=\K[0-9.]+' || echo 0)
  SKIPPED=$(echo "$SUMMARY_LINE" | grep -oP 'skipped=\K\d+' || echo 0)
  ALERT_LINE=$(echo "$CLEANUP_OUTPUT" | grep 'ALERT ' || true)
  if [ -n "$ALERT_LINE" ]; then
    HAS_ALERT=true
  else
    HAS_ALERT=false
  fi
  DISK_AFTER=$(disk_used_pct)
  cat > "$REPORT_PATH" << REPORTHERE
{
  "ts": "$RUN_TS",
  "issue": "BUY-57257",
  "keep_hours": $KEEP_HOURS,
  "disk_before_pct": $disk_pct_before,
  "disk_after_pct": $DISK_AFTER,
  "deleted": ${DELETED:-0},
  "sidecars_deleted": ${SIDECARS:-0},
  "trash_purged": ${TRASH_PURGED:-0},
  "freed_gb": ${FREED_GB:-0},
  "skipped": ${SKIPPED:-0},
  "alert": $HAS_ALERT,
  "run_started_at": "$RUN_TS",
  "parent_epic": "BUY-30774",
  "summary_line": "$SUMMARY_LINE",
  "status": "clean"
}
REPORTHERE
fi

disk_pct_after=$(disk_used_pct)
log "Disk after: ${disk_pct_after}%"
log "Report: $REPORT_PATH"

df -h /

if [ "$inner_exit" -ne 0 ] && [ "$inner_exit" -ne 10 ]; then
  log "WARNING: wc-cycle-cleanup.sh exited with $inner_exit"
  exit "$inner_exit"
fi

log "BUY-56647 enforcement completed. inner_exit=$inner_exit disk_before=${disk_pct_before}% disk_after=${disk_pct_after}%"
exit $inner_exit
