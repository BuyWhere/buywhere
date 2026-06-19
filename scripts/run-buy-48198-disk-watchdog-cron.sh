#!/usr/bin/env bash
# BUY-48198 disk watchdog cron entrypoint.
# Stable routine-specific wrapper for the canonical 5-minute BUY-48198 cron job.
# It keeps the legacy cleanup pipeline but exposes a BUY-48198-specific entry
# name and default log path for the 5-minute watchdog task.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export LOG_FILE="${LOG_FILE:-$REPO_ROOT/logs/buy48198_disk_watchdog_cron.log}"
export DISK_CRON_LABEL="${DISK_CRON_LABEL:-BUY-48198}"
export DISK_SOURCE_ISSUE="${DISK_SOURCE_ISSUE:-BUY-48198}"
export DISK_ROUTINE_IDENTIFIER="${DISK_ROUTINE_IDENTIFIER:-BUY-48198}"
export DISK_EXECUTION_ISSUE="${DISK_EXECUTION_ISSUE:-${PAPERCLIP_TASK_ID:-BUY-48198}}"
export WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
export WC_CLEANUP_KEEP_HOURS="${WC_CLEANUP_KEEP_HOURS:-48}"
export WC_CLEANUP_ALERT_PCT="${WC_CLEANUP_ALERT_PCT:-90}"
export WORKER_CLEANUP_ALERT_PCT="${WORKER_CLEANUP_ALERT_PCT:-90}"

mkdir -p "$(dirname "$LOG_FILE")"

run_cleanup_stage() {
  local label="$1"
  shift
  local rc
  if "$@"; then
    rc=0
  else
    rc=$?
  fi
  if [ "$rc" -eq 10 ]; then
    printf '[%s] %s %s rc=10 (disk threshold still exceeded after cleanup; continuing)\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DISK_CRON_LABEL" "$label"
    return 0
  fi
  printf '[%s] %s %s rc=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DISK_CRON_LABEL" "$label" "$rc"
  return "$rc"
}

{
  printf '[%s] %s watchdog start\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DISK_CRON_LABEL"
  run_cleanup_stage "wc cleanup completed" \
    bash "$SCRIPT_DIR/wc-cycle-cleanup.sh" \
    --apply \
    --keep="$WC_CLEANUP_KEEP_HOURS" \
    --alert-pct="$WC_CLEANUP_ALERT_PCT"
  run_cleanup_stage "worker artifact cleanup completed" \
    env \
    WORKSPACES_ROOT="$WORKSPACES_ROOT" \
    APPLY=1 \
    ALERT_PCT="$WORKER_CLEANUP_ALERT_PCT" \
    bash "$SCRIPT_DIR/buy-53114-worker-node-artifact-cleanup.sh"
  bash "$SCRIPT_DIR/run-buy-48198-disk-watchdog.sh"
  rc=$?
  printf '[%s] %s watchdog complete rc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DISK_CRON_LABEL" "$rc"
  exit "$rc"
} >>"$LOG_FILE" 2>&1
