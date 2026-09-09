#!/usr/bin/env bash
# WC cycle artifact cleanup with reversible trash moves and disk alerting.

set -euo pipefail

WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
WORKSPACE_DIR="${WORKSPACE_DIR:-}"
KEEP_HOURS="${KEEP_HOURS:-48}"
APPLY=0
ALERT_PCT="${ALERT_PCT:-90}"
LOG_PATH="${LOG_PATH:-}"
REPORT_PATH="${REPORT_PATH:-}"
TRASH_RETENTION_HOURS="${TRASH_RETENTION_HOURS:-48}"
WORKSPACE_COUNT=0
CURRENT_WORKSPACE_DIR=""

usage() {
  cat <<'EOF'
Usage: wc-cycle-cleanup.sh [--apply] [--keep=48] [--workspace-dir=/abs/path] [--alert-pct=90]
Default behavior scans all worker workspaces under WORKSPACES_ROOT.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --apply)
      APPLY=1
      ;;
    --keep=*)
      KEEP_HOURS="${arg#*=}"
      ;;
    --workspace-dir=*)
      WORKSPACE_DIR="${arg#*=}"
      ;;
    --alert-pct=*)
      ALERT_PCT="${arg#*=}"
      ;;
    --log-path=*)
      LOG_PATH="${arg#*=}"
      ;;
    --report-path=*)
      REPORT_PATH="${arg#*=}"
      ;;
    --trash-retention-hours=*)
      TRASH_RETENTION_HOURS="${arg#*=}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log() {
  echo "[$(ts)] $*"
}

json_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g'
}

file_kb() {
  local bytes
  bytes=$(stat -c '%s' -- "$1" 2>/dev/null || echo 0)
  awk -v b="$bytes" 'BEGIN{printf "%d", (b + 1023) / 1024}'
}

append_jsonl() {
  local file="$1"
  local reason="$2"
  local action="$3"
  local kb="$4"
  mkdir -p "$(dirname "$LOG_PATH")"
  printf '{"ts":"%s","file":"%s","kb":%s,"reason":"%s","action":"%s"}\n' \
    "$(ts)" \
    "$(printf '%s' "${file#$CURRENT_WORKSPACE_DIR/}" | json_escape)" \
    "$kb" \
    "$(printf '%s' "$reason" | json_escape)" \
    "$(printf '%s' "$action" | json_escape)" >> "$LOG_PATH"
}

is_open_file() {
  if ! command -v lsof >/dev/null 2>&1; then
    return 1
  fi
  # Zero-byte files cannot be meaningfully open at scale — skip lsof which is expensive on 50K+ files.
  if [ "$(stat -c '%s' -- "$1" 2>/dev/null || echo 0)" -eq 0 ]; then
    return 1
  fi
  lsof -- "$1" >/dev/null 2>&1
}

trash_target_for() {
  local file="$1"
  printf '%s/%s/%s' "$TRASH_DIR" "$(dirname "${file#$CURRENT_WORKSPACE_DIR/}")" "$(basename "$file")"
}

move_to_trash() {
  local file="$1"
  local reason="$2"
  local kb target action
  kb=$(file_kb "$file")
  target=$(trash_target_for "$file")

  if [ "$APPLY" = "1" ]; then
    if [ ! -f "$file" ]; then
      log "skip-gone path=$file"
      return 0
    fi
    mkdir -p "$(dirname "$target")"
    mv -- "$file" "$target" 2>/dev/null || { log "skip-race path=$file"; return 0; }
    action="trash"
  else
    action="dryrun"
  fi

  append_jsonl "$file" "$reason" "$action" "$kb"
  log "$([ "$APPLY" = "1" ] && echo trashed || echo would-trash) reason=$reason kb=$kb path=$file"
  MOVED_COUNT=$((MOVED_COUNT + 1))
  RECLAIMED_KB=$((RECLAIMED_KB + kb))
}

cleanup_main_file() {
  local file="$1"
  local sidecar

  SCANNED_COUNT=$((SCANNED_COUNT + 1))
  if is_open_file "$file"; then
    SKIPPED_OPEN_COUNT=$((SKIPPED_OPEN_COUNT + 1))
    log "skip-open path=$file"
    return 0
  fi

  move_to_trash "$file" "stale_cycle_ndjson"

  for sidecar in "$file.ingested.json" "${file%.ndjson}.summary.json" "${file}.summary.json"; do
    if [ -f "$sidecar" ]; then
      move_to_trash "$sidecar" "sidecar_for_stale_cycle_ndjson"
    fi
  done
}

purge_old_trash() {
  if [ ! -d "$TRASH_BASE" ]; then
    return 0
  fi

  while IFS= read -r -d '' path; do
    local kb
    kb=$(file_kb "$path")
    if [ "$APPLY" = "1" ]; then
      rm -f -- "$path"
      append_jsonl "$path" "trash_retention_expired" "delete" "$kb"
    else
      append_jsonl "$path" "trash_retention_expired" "would-delete" "$kb"
    fi
    PURGED_COUNT=$((PURGED_COUNT + 1))
  done < <(
    find "$TRASH_BASE" -type f \
      ! -path "$TRASH_DIR/*" \
      -mmin +"$((TRASH_RETENTION_HOURS * 60))" \
      -print0 2>/dev/null
  )

  find "$TRASH_BASE" -type d -empty -delete 2>/dev/null || true
}

write_report() {
  local report_scope disk_after_pct disk_used_kb disk_free_kb alert_required
  report_scope="${WORKSPACE_DIR:-$WORKSPACES_ROOT}"
  disk_after_pct=$(df -Pk "$report_scope" | awk 'NR==2 {gsub("%","",$5); print $5}')
  disk_used_kb=$(df -Pk "$report_scope" | awk 'NR==2 {print $3}')
  disk_free_kb=$(df -Pk "$report_scope" | awk 'NR==2 {print $4}')
  alert_required=0
  if [ "${disk_after_pct:-0}" -gt "$ALERT_PCT" ]; then
    alert_required=1
    log "ALERT disk_after_pct=$disk_after_pct exceeds threshold=$ALERT_PCT scope=$report_scope"
  fi

  mkdir -p "$(dirname "$REPORT_PATH")"
  cat > "$REPORT_PATH" <<EOF
{
  "ts": "$(ts)",
  "workspace_dir": "${WORKSPACE_DIR:-}",
  "workspaces_root": "$WORKSPACES_ROOT",
  "workspace_count": $WORKSPACE_COUNT,
  "apply": $APPLY,
  "keep_hours": $KEEP_HOURS,
  "trash_retention_hours": $TRASH_RETENTION_HOURS,
  "scanned_count": $SCANNED_COUNT,
  "moved_count": $MOVED_COUNT,
  "purged_count": $PURGED_COUNT,
  "skipped_open_count": $SKIPPED_OPEN_COUNT,
  "reclaimed_kb": $RECLAIMED_KB,
  "disk_after_pct": $disk_after_pct,
  "disk_used_kb": $disk_used_kb,
  "disk_free_kb": $disk_free_kb,
  "alert_threshold_pct": $ALERT_PCT,
  "alert_required": $alert_required
}
EOF

  if [ "$alert_required" = "1" ]; then
    return 10
  fi
  return 0
}

default_log_path() {
  if [ -n "$WORKSPACE_DIR" ]; then
    printf '%s\n' "$WORKSPACE_DIR/data/_wc_cleanup_log.jsonl"
  else
    printf '%s\n' "$WORKSPACES_ROOT/logs/buy53095_wc_cycle_cleanup_log.jsonl"
  fi
}

default_report_path() {
  if [ -n "$WORKSPACE_DIR" ]; then
    printf '%s\n' "$WORKSPACE_DIR/data/_wc_cleanup_report.json"
  else
    printf '%s\n' "$WORKSPACES_ROOT/logs/buy53095_wc_cycle_cleanup_report.json"
  fi
}

iter_candidate_workspaces() {
  if [ -n "$WORKSPACE_DIR" ]; then
    printf '%s\0' "$WORKSPACE_DIR"
    return 0
  fi

  find "$WORKSPACES_ROOT" -mindepth 2 -maxdepth 3 -type d -name data -print0 2>/dev/null \
    | xargs -0 -n1 dirname \
    | awk '!seen[$0]++ { print }' \
    | while IFS= read -r workspace_dir; do
        printf '%s\0' "$workspace_dir"
      done
}

cleanup_workspace() {
  local workspace_dir="$1"
  local data_dir="$workspace_dir/data"

  CURRENT_WORKSPACE_DIR="$workspace_dir"
  # If data/ subdir does not exist or contains no cycle files, check workspace root
  if [ ! -d "$data_dir" ] || ! find "$data_dir" -maxdepth 2 -name 'cycle-*.ndjson' -print -quit 2>/dev/null | grep -q .; then
    if find "$workspace_dir" -maxdepth 2 -name 'cycle-*.ndjson' -print -quit 2>/dev/null | grep -q .; then
      data_dir="$workspace_dir"
    elif [ ! -d "$data_dir" ]; then
      return 0
    fi
  fi

  local has_ndjson=0
  if find "$data_dir" -type f \
    \( -name 'cycle-*.ndjson' -o -name 'wc-deep-cycle-*.ndjson' \) \
    ! -path '*/_trash/*' -print -quit 2>/dev/null | grep -q .; then
    has_ndjson=1
  elif [ "$data_dir" != "$workspace_dir" ] && find "$workspace_dir" -maxdepth 2 -type f \
    \( -name 'cycle-*.ndjson' -o -name 'wc-deep-cycle-*.ndjson' \) \
    ! -path '*/_trash/*' ! -path '*/data/*' -print -quit 2>/dev/null | grep -q .; then
    has_ndjson=1
  fi

  if [ "$has_ndjson" = "0" ]; then
    if [ -d "$data_dir/_trash" ]; then
      TRASH_BASE="$data_dir/_trash"
      TRASH_DIR="$TRASH_BASE/$(date -u +%F)"
      purge_old_trash
    fi
    return 0
  fi

  WORKSPACE_COUNT=$((WORKSPACE_COUNT + 1))
  TRASH_BASE="$data_dir/_trash"
  TRASH_DIR="$TRASH_BASE/$(date -u +%F)"

  log "starting workspace=$workspace_dir apply=$APPLY keep_hours=$KEEP_HOURS alert_pct=$ALERT_PCT"

  # Use the location where ndjson files were detected
  local find_base="$data_dir"

  while IFS= read -r -d '' file; do
    cleanup_main_file "$file"
  done < <(
    find "$find_base" -maxdepth 2 -type f \
      \( -name 'cycle-*.ndjson' -o -name 'wc-deep-cycle-*.ndjson' \) \
      -mmin +"$((KEEP_HOURS * 60))" \
      ! -path '*/_trash/*' \
      -print0 2>/dev/null
  )

  purge_old_trash
}

main() {
  local workspace_dir

  LOG_PATH="${LOG_PATH:-$(default_log_path)}"
  REPORT_PATH="${REPORT_PATH:-$(default_report_path)}"

  SCANNED_COUNT=0
  MOVED_COUNT=0
  PURGED_COUNT=0
  SKIPPED_OPEN_COUNT=0
  RECLAIMED_KB=0

  while IFS= read -r -d '' workspace_dir; do
    cleanup_workspace "$workspace_dir"
  done < <(iter_candidate_workspaces)

  write_report
}

main "$@"
