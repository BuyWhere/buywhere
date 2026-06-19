#!/usr/bin/env bash
# BUY-53114 worker-node artifact cleanup.
# Safe-by-default disk hygiene for Paperclip worker workspaces:
# - removes stale pid / heartbeat files when the owning process is gone
# - prunes old worker-cycle logs
# - prunes old runs/ artifacts
# - removes Python cache directories/files
#
# Dry-run by default. Set APPLY=1 to delete.

set -euo pipefail

WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
APPLY="${APPLY:-0}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-2}"
RUN_RETENTION_DAYS="${RUN_RETENTION_DAYS:-3}"
HEARTBEAT_RETENTION_MIN="${HEARTBEAT_RETENTION_MIN:-360}"
PYCACHE_RETENTION_DAYS="${PYCACHE_RETENTION_DAYS:-1}"
DISK_ARTIFACT_RETENTION_DAYS="${DISK_ARTIFACT_RETENTION_DAYS:-2}"
TRASH_ARCHIVE_MINUTES="${TRASH_ARCHIVE_MINUTES:-360}"
TRASH_ARCHIVE_MIN_KB="${TRASH_ARCHIVE_MIN_KB:-262144}"
TRASH_ARCHIVE_DIRNAME="${TRASH_ARCHIVE_DIRNAME:-_trash_archives}"
ALERT_PCT="${ALERT_PCT:-90}"
REPORT_PATH="${REPORT_PATH:-$WORKSPACES_ROOT/logs/buy53114_worker_wc_cycle_cleanup_report.json}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log() {
  echo "[$(ts)] $*"
}

file_kb() {
  local bytes
  bytes=$(stat -c '%s' -- "$1" 2>/dev/null || echo 0)
  awk -v b="$bytes" 'BEGIN{printf "%d", (b + 1023) / 1024}'
}

can_delete_path() {
  local path="$1"
  local parent
  parent=$(dirname -- "$path")
  if [ -d "$path" ]; then
    [ -w "$parent" ] && [ -x "$parent" ] && [ -w "$path" ] && [ -x "$path" ]
    return $?
  fi
  [ -w "$parent" ] && [ -x "$parent" ]
}

path_age_minutes() {
  local now epoch
  now=$(date +%s)
  epoch=$(stat -c '%Y' -- "$1" 2>/dev/null || echo "$now")
  awk -v n="$now" -v e="$epoch" 'BEGIN{printf "%d", (n - e) / 60}'
}

should_keep_pid() {
  local pid
  [ -f "$1" ] || return 1
  pid=$(tr -d '[:space:]' < "$1" 2>/dev/null || true)
  if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  kill -0 "$pid" 2>/dev/null
}

delete_path() {
  local kind="$1"
  local path="$2"
  local kb
  kb=$(file_kb "$path")
  if [ "$APPLY" = "1" ]; then
    if ! can_delete_path "$path"; then
      log "skip-undeletable kind=$kind kb=$kb path=$path"
      SKIPPED_UNDELETABLE_COUNT=$((SKIPPED_UNDELETABLE_COUNT + 1))
      return 0
    fi
    if rm -rf -- "$path" 2>/dev/null; then
      log "deleted kind=$kind kb=$kb path=$path"
    else
      log "delete-failed kind=$kind kb=$kb path=$path"
      FAILED_COUNT=$((FAILED_COUNT + 1))
      return 0
    fi
  else
    log "would-delete kind=$kind kb=$kb path=$path"
  fi
  REMOVED_COUNT=$((REMOVED_COUNT + 1))
  RECLAIMED_KB=$((RECLAIMED_KB + kb))
}

archive_trash_dir() {
  local path="$1"
  local data_dir archive_root archive_path tmp_archive dir_kb archive_kb reclaimed_kb parent base
  data_dir=$(dirname -- "$(dirname -- "$path")")
  archive_root="$data_dir/$TRASH_ARCHIVE_DIRNAME"
  base=$(basename -- "$path")
  archive_path="$archive_root/$base.tar.gz"
  tmp_archive="$archive_path.tmp.$$"
  dir_kb=$(du -sk -- "$path" 2>/dev/null | awk '{print $1}')
  dir_kb="${dir_kb:-0}"

  if [ "$APPLY" != "1" ]; then
    log "would-archive-trash dir_kb=$dir_kb path=$path archive=$archive_path"
    return 0
  fi

  parent=$(dirname -- "$archive_root")
  if ! can_delete_path "$path" || ! [ -w "$parent" ] || ! [ -x "$parent" ]; then
    log "skip-undeletable kind=trash-archive kb=$dir_kb path=$path archive=$archive_path"
    SKIPPED_UNDELETABLE_COUNT=$((SKIPPED_UNDELETABLE_COUNT + 1))
    return 0
  fi

  mkdir -p -- "$archive_root"
  if [ -e "$archive_path" ]; then
    log "skip-existing-archive dir_kb=$dir_kb path=$path archive=$archive_path"
    SKIPPED_UNDELETABLE_COUNT=$((SKIPPED_UNDELETABLE_COUNT + 1))
    return 0
  fi

  if tar -C "$(dirname -- "$path")" -czf "$tmp_archive" -- "$base" 2>/dev/null &&
    mv -- "$tmp_archive" "$archive_path" &&
    rm -rf -- "$path" 2>/dev/null; then
    archive_kb=$(file_kb "$archive_path")
    reclaimed_kb=$((dir_kb - archive_kb))
    if [ "$reclaimed_kb" -lt 0 ]; then
      reclaimed_kb=0
    fi
    REMOVED_COUNT=$((REMOVED_COUNT + 1))
    RECLAIMED_KB=$((RECLAIMED_KB + reclaimed_kb))
    log "archived-trash dir_kb=$dir_kb archive_kb=$archive_kb reclaimed_kb=$reclaimed_kb path=$path archive=$archive_path"
    return 0
  fi

  rm -f -- "$tmp_archive" 2>/dev/null || true
  log "archive-failed dir_kb=$dir_kb path=$path archive=$archive_path"
  FAILED_COUNT=$((FAILED_COUNT + 1))
}

cleanup_pid_files() {
  local ws="$1"
  local file
  while IFS= read -r -d '' file; do
    SCANNED_COUNT=$((SCANNED_COUNT + 1))
    if should_keep_pid "$file"; then
      continue
    fi
    delete_path "stale-pid" "$file"
  done < <(find "$ws" -type f -name '*.pid' -print0 2>/dev/null)
}

cleanup_heartbeat_files() {
  local ws="$1"
  local file age_min
  while IFS= read -r -d '' file; do
    SCANNED_COUNT=$((SCANNED_COUNT + 1))
    age_min=$(path_age_minutes "$file")
    if [ "$age_min" -lt "$HEARTBEAT_RETENTION_MIN" ]; then
      continue
    fi
    delete_path "stale-heartbeat" "$file"
  done < <(find "$ws" -type f \( -name '*.heartbeat' -o -name '*.heartbeat.json' \) -print0 2>/dev/null)
}

cleanup_pycaches() {
  local ws="$1"
  local path
  while IFS= read -r -d '' path; do
    SCANNED_COUNT=$((SCANNED_COUNT + 1))
    delete_path "pycache-dir" "$path"
  done < <(find "$ws" -type d -name '__pycache__' -mtime +"$PYCACHE_RETENTION_DAYS" -print0 2>/dev/null)

  while IFS= read -r -d '' path; do
    SCANNED_COUNT=$((SCANNED_COUNT + 1))
    delete_path "pycache-file" "$path"
  done < <(find "$ws" -type f \( -name '*.pyc' -o -name '*.pyo' \) -mtime +"$PYCACHE_RETENTION_DAYS" -print0 2>/dev/null)
}

cleanup_runs_dirs() {
  local ws="$1"
  local path last_selected=""
  while IFS= read -r -d '' path; do
    if [[ -n "$last_selected" && "$path" == "$last_selected"/* ]]; then
      continue
    fi
    SCANNED_COUNT=$((SCANNED_COUNT + 1))
    delete_path "runs-dir" "$path"
    last_selected="$path"
  done < <(
    find "$ws" -type d -path '*/runs/*' \
      ! -path '*/runs' \
      -mtime +"$RUN_RETENTION_DAYS" \
      -print0 2>/dev/null | sort -z
  )
}

cleanup_cycle_logs() {
  local ws="$1"
  local logs_dir

  while IFS= read -r -d '' logs_dir; do
    local path
    while IFS= read -r -d '' path; do
      SCANNED_COUNT=$((SCANNED_COUNT + 1))
      delete_path "cycle-log" "$path"
    done < <(find "$logs_dir" -maxdepth 1 -type f -mtime +"$LOG_RETENTION_DAYS" \
      \( -name '*supervisor*.log' -o -name '*keepalive*.log' -o -name '*worker*.log' -o -name '*cron*.log' -o -name '*wc*deep*.log' -o -name '*wc_cycle_cleanup*.log' -o -name '*deep*.fatal.log' \) \
      -print0 2>/dev/null)
  done < <(find "$ws" -type d \( -name logs -o -path '*/data/logs' \) -print0 2>/dev/null)
}

cleanup_disk_monitor_artifacts() {
  local ws="$1"
  local data_dir="$ws/data"
  local reports_dir="$ws/reports"
  local path

  if [ -d "$data_dir" ]; then
    while IFS= read -r -d '' path; do
      SCANNED_COUNT=$((SCANNED_COUNT + 1))
      delete_path "disk-monitor-dir" "$path"
    done < <(
      find "$data_dir" -maxdepth 1 -mindepth 1 -type d \
        \( \
          -name 'buy-*-disk-monitor-*' -o \
          -name 'buy-*-disk-monitor-smoke' -o \
          -name 'buy-*-disk-watchdog-*' -o \
          -name 'buy-*-disk-watchdog-smoke' \
        \) \
        -mtime +"$DISK_ARTIFACT_RETENTION_DAYS" \
        -print0 2>/dev/null
    )

    while IFS= read -r -d '' path; do
      SCANNED_COUNT=$((SCANNED_COUNT + 1))
      delete_path "disk-state-file" "$path"
    done < <(
      find "$data_dir" -maxdepth 1 -type f -name 'buy-*-disk-state.json' \
        -mtime +"$DISK_ARTIFACT_RETENTION_DAYS" \
        -print0 2>/dev/null
    )
  fi

  if [ -d "$reports_dir" ]; then
    while IFS= read -r -d '' path; do
      SCANNED_COUNT=$((SCANNED_COUNT + 1))
      delete_path "disk-report-artifact" "$path"
    done < <(
      find "$reports_dir" -maxdepth 1 -type f \
        \( \
          -name 'BUY-*-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup.*' -o \
          -name 'BUY-*-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup-*.json' -o \
          -name 'BUY-*-disk-space-watchdog-5min-*.md' \
        \) \
        -mtime +"$DISK_ARTIFACT_RETENTION_DAYS" \
        -print0 2>/dev/null
    )
  fi
}

cleanup_trash_dirs() {
  local ws="$1"
  local trash_root path age_min dir_kb
  trash_root="$ws/data/_trash"
  [ -d "$trash_root" ] || return 0

  while IFS= read -r -d '' path; do
    SCANNED_COUNT=$((SCANNED_COUNT + 1))
    age_min=$(path_age_minutes "$path")
    if [ "$age_min" -lt "$TRASH_ARCHIVE_MINUTES" ]; then
      continue
    fi
    dir_kb=$(du -sk -- "$path" 2>/dev/null | awk '{print $1}')
    dir_kb="${dir_kb:-0}"
    if [ "$dir_kb" -lt "$TRASH_ARCHIVE_MIN_KB" ]; then
      continue
    fi
    archive_trash_dir "$path"
  done < <(
    find "$trash_root" -mindepth 1 -maxdepth 1 -type d \
      -regextype posix-extended \
      -regex '.*/[0-9]{4}-[0-9]{2}-[0-9]{2}$' \
      -print0 2>/dev/null
  )
}

write_report() {
  local disk_after_pct disk_after_kb free_after_kb alert_required
  disk_after_pct=$(df -Pk "$WORKSPACES_ROOT" | awk 'NR==2 {gsub("%","",$5); print $5}')
  disk_after_kb=$(df -Pk "$WORKSPACES_ROOT" | awk 'NR==2 {print $3}')
  free_after_kb=$(df -Pk "$WORKSPACES_ROOT" | awk 'NR==2 {print $4}')
  alert_required=0
  if [ "${disk_after_pct:-0}" -gt "$ALERT_PCT" ]; then
    alert_required=1
    log "ALERT disk_after_pct=$disk_after_pct exceeds threshold=$ALERT_PCT scope=$WORKSPACES_ROOT"
  fi

  mkdir -p "$(dirname "$REPORT_PATH")"
  cat > "$REPORT_PATH" <<EOF
{
  "ts": "$(ts)",
  "apply": $APPLY,
  "workspaces_root": "$WORKSPACES_ROOT",
  "scanned_count": $SCANNED_COUNT,
  "removed_count": $REMOVED_COUNT,
  "skipped_undeletable_count": $SKIPPED_UNDELETABLE_COUNT,
  "failed_count": $FAILED_COUNT,
  "reclaimed_kb": $RECLAIMED_KB,
  "disk_after_pct": $disk_after_pct,
  "disk_after_kb": $disk_after_kb,
  "disk_free_kb": $free_after_kb,
  "alert_threshold_pct": $ALERT_PCT,
  "alert_required": $alert_required
}
EOF

  if [ "$alert_required" = "1" ]; then
    return 10
  fi
  return 0
}

main() {
  local ws
  SCANNED_COUNT=0
  REMOVED_COUNT=0
  SKIPPED_UNDELETABLE_COUNT=0
  FAILED_COUNT=0
  RECLAIMED_KB=0

  log "starting apply=$APPLY root=$WORKSPACES_ROOT log_retention_days=$LOG_RETENTION_DAYS run_retention_days=$RUN_RETENTION_DAYS heartbeat_retention_min=$HEARTBEAT_RETENTION_MIN disk_artifact_retention_days=$DISK_ARTIFACT_RETENTION_DAYS trash_archive_minutes=$TRASH_ARCHIVE_MINUTES trash_archive_min_kb=$TRASH_ARCHIVE_MIN_KB trash_archive_dirname=$TRASH_ARCHIVE_DIRNAME alert_pct=$ALERT_PCT"

  while IFS= read -r -d '' ws; do
    cleanup_pid_files "$ws"
    cleanup_heartbeat_files "$ws"
    cleanup_pycaches "$ws"
    cleanup_runs_dirs "$ws"
    cleanup_cycle_logs "$ws"
    cleanup_disk_monitor_artifacts "$ws"
    cleanup_trash_dirs "$ws"
  done < <(find "$WORKSPACES_ROOT" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)

  find "$WORKSPACES_ROOT" -type d -empty -delete 2>/dev/null || true
  write_report

  log "summary apply=$APPLY scanned=$SCANNED_COUNT removed=$REMOVED_COUNT skipped_undeletable=$SKIPPED_UNDELETABLE_COUNT failed=$FAILED_COUNT reclaimed_kb=$RECLAIMED_KB report=$REPORT_PATH"
}

main "$@"
