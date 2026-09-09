#!/usr/bin/env bash
# worker-node-disk-enforcement.sh — BUY-57336
# Worker node disk-space enforcement engine.
#
# Scans all worker workspaces under WORKSPACES_ROOT for disk usage.
# When a workspace exceeds a configurable threshold, triggers:
#   1. wc-cycle-cleanup.sh --apply on that workspace
#   2. Paperclip incident creation if still above threshold after cleanup
#
# Designed to run every 10 minutes via cron (setup-buy-57336).
set -euo pipefail


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WC_CLEANUP="$REPO_ROOT/scripts/wc-cycle-cleanup.sh"
LOG_FILE="$REPO_ROOT/logs/buy-57336-disk-enforcement.log"
STATE_DIR="/tmp/buy-57336-disk-enforcement"

WORKSPACES_ROOT="${WORKSPACES_ROOT:-/paperclip/instances/default/workspaces}"
ENFORCE_PCT="${ENFORCE_PCT:-85}"
CRITICAL_PCT="${CRITICAL_PCT:-95}"
KEEP_HOURS="${KEEP_HOURS:-48}"
DRY_RUN="${DRY_RUN:-0}"

mkdir -p "$REPO_ROOT/logs" "$STATE_DIR"

# Source Paperclip credentials
if [[ -f /home/paperclip/.paperclip_env ]]; then
    . /home/paperclip/.paperclip_env
fi

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

log() { echo "[$TS] $1"; }
log_file() { echo "[$TS] $1" >> "$LOG_FILE"; }


usage() {
  cat <<EOF
Usage: worker-node-disk-enforcement.sh [--apply] [--enforce-pct=85] [--critical-pct=95]
  [--workspace-dir=/path] [--keep=48]

Scans all worker workspaces and enforces disk-space thresholds.
  --apply         Actually run cleanup and create incidents (default: dry-run)
  --enforce-pct   Disk usage % that triggers cleanup (default: 85)
  --critical-pct  Disk usage % that triggers incident (default: 95)
  --workspace-dir Target a single workspace instead of all
  --keep          Hours of ndjson retention for cleanup (default: 48)
EOF
}

for arg in "$@"; do
  case "$arg" in
    --apply) DRY_RUN=0 ;;
    --dry-run) DRY_RUN=1 ;;
    --enforce-pct=*) ENFORCE_PCT="${arg#*=}" ;;
    --critical-pct=*) CRITICAL_PCT="${arg#*=}" ;;
    --workspace-dir=*) WORKSPACE_DIR="${arg#*=}" ;;
    --keep=*) KEEP_HOURS="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; usage >&2; exit 2 ;;
  esac
done


disk_used_pct() {
  local path="$1"
  df -Pk "$path" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}'
}

disk_free_gb() {
  local path="$1"
  df -BG "$path" 2>/dev/null | awk 'NR==2 {gsub(/G/,"",$4); print $4}' || echo "0"
}

create_incident() {
  local title="$1"
  local priority="$2"
  local body="$3"
  local incident_state_file="$4"

  local api_key="${PAPERCLIP_API_KEY:-}"
  local api_url="${PAPERCLIP_API_URL:-}"
  local company_id="${PAPERCLIP_COMPANY_ID:-}"

  if [[ -z "$api_key" || -z "$api_url" || -z "$company_id" ]]; then
    log_file "ERROR: Cannot create incident — Paperclip credentials not available"
    return 1
  fi

  if [[ -f "$incident_state_file" ]]; then
    local age_m now elapsed
    age_m=$(stat -c %Y "$incident_state_file" 2>/dev/null || echo 0)
    now=$(date +%s)
    elapsed=$(( (now - age_m) / 60 ))
    if [[ "$elapsed" -lt 30 ]]; then
      log_file "SKIP: Incident already created ${elapsed}m ago (within 30m dedup) — $title"
      return 0
    fi
  fi

  if [[ "$DRY_RUN" = "1" ]]; then
    log "[DRY-RUN] Would create incident: $title (priority=$priority)"
    log_file "[DRY-RUN] Would create incident: $title (priority=$priority)"
    return 0
  fi

  local response issue_id
  response=$(curl -sS -X POST "$api_url/api/companies/$company_id/issues" \
    -H "Authorization: Bearer $api_key" \
    -H "Content-Type: application/json" \
    --data-raw "$(jq -nc \
      --arg title "$title" \
      --arg body "$body" \
      --arg priority "$priority" \
      '{title:$title, description:$body, priority:$priority, status:"todo"}')" \
    2>/dev/null || echo '{"error":"curl failed"}')

  issue_id=$(echo "$response" | jq -r '.id // empty' 2>/dev/null)
  if [[ -n "$issue_id" ]]; then
    echo "$issue_id" > "$incident_state_file"
    log_file "Created incident $issue_id: $title"
    log "Created incident $issue_id: $title"
  else
    log_file "Failed to create incident: response=$response"
  fi
}

enforce_workspace() {
  local workspace_dir="$1"
  local ws_name
  ws_name="$(basename "$workspace_dir")"
  local disk_pct
  disk_pct=$(disk_used_pct "$workspace_dir")
  local disk_gb
  disk_gb=$(disk_free_gb "$workspace_dir")
  local incident_state="$STATE_DIR/$ws_name.incident"

  log_file "workspace=$ws_name disk_before=${disk_pct}% free=${disk_gb}GB enforce_threshold=${ENFORCE_PCT}% critical_threshold=${CRITICAL_PCT}%"

  # If disk is below enforce threshold, skip (but check if incident can be cleared)
  if [[ "$disk_pct" -lt "$ENFORCE_PCT" ]]; then
    # Clear any outstanding incident state if disk recovered
    if [[ -f "$incident_state" ]]; then
      log_file "workspace=$ws_name disk recovered (${disk_pct}% < ${ENFORCE_PCT}%) — clearing incident state"
      rm -f "$incident_state"
    fi
    return 0
  fi

  # Disk is above enforce threshold — run cleanup
  log_file "workspace=$ws_name disk=${disk_pct}% exceeds enforce=${ENFORCE_PCT}% — triggering cleanup"

  if [[ -x "$WC_CLEANUP" ]]; then
    local cleanup_args=("--apply" "--keep=$KEEP_HOURS" "--workspace-dir=$workspace_dir" "--alert-pct=$CRITICAL_PCT")
    if [[ "$DRY_RUN" = "1" ]]; then
      log "[DRY-RUN] Would run: bash $WC_CLEANUP ${cleanup_args[*]}"
      log_file "[DRY-RUN] Would run: bash $WC_CLEANUP ${cleanup_args[*]}"
    else
      log "Running: bash $WC_CLEANUP ${cleanup_args[*]}"
      log_file "Running: bash $WC_CLEANUP ${cleanup_args[*]}"
      bash "$WC_CLEANUP" "${cleanup_args[@]}" 2>&1 | while IFS= read -r cl; do log_file "  cleanup: $cl"; done
    fi
  else
    log_file "WARNING: wc-cycle-cleanup.sh not found at $WC_CLEANUP — skipping cleanup"
  fi

  # Re-check disk after cleanup
  disk_pct=$(disk_used_pct "$workspace_dir")
  log_file "workspace=$ws_name disk_after_cleanup=${disk_pct}%"

  # If still above critical threshold, create incident
  if [[ "$disk_pct" -ge "$CRITICAL_PCT" ]]; then
    local title="CRITICAL: worker workspace $ws_name at ${disk_pct}% disk — BUY-57336"
    local body="Worker workspace **$ws_name** is at **${disk_pct}%** disk usage (path: $workspace_dir).\\n\\nThresholds: enforce at ${ENFORCE_PCT}%, critical at ${CRITICAL_PCT}%.\\nFree space: ${disk_gb}GB.\\nCleanup retention: ${KEEP_HOURS}h.\\nTimestamp: $TS\\n\\nAutomated enforcement — BUY-57336 worker node disk-space enforcement."

    log "workspace=$ws_name disk=${disk_pct}% exceeds critical=${CRITICAL_PCT}% — creating incident"
    create_incident "$title" "critical" "$body" "$incident_state"
  elif [[ "$disk_pct" -ge "$ENFORCE_PCT" ]]; then
    # Above enforce but below critical — warning
    log_file "workspace=$ws_name disk=${disk_pct}% still above enforce=${ENFORCE_PCT}% but below critical=${CRITICAL_PCT}%"
  fi
}

main() {
  log_file "=== BUY-57336 disk enforcement starting ==="
  log_file "workspaces_root=$WORKSPACES_ROOT enforce_pct=$ENFORCE_PCT critical_pct=$CRITICAL_PCT keep_hours=$KEEP_HOURS dry_run=$DRY_RUN"

  local exit_code=0

  if [[ -n "${WORKSPACE_DIR:-}" ]]; then
    # Single workspace mode
    enforce_workspace "$WORKSPACE_DIR"
  else
    # Scan all workspaces
    while IFS= read -r -d '' ws_dir; do
      enforce_workspace "$ws_dir"
    done < <(
      find "$WORKSPACES_ROOT" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null
    )
  fi

  # Report summary
  log "BUY-57336 enforcement complete. dry_run=$DRY_RUN enforce_pct=$ENFORCE_PCT critical_pct=$CRITICAL_PCT"
  log "Check $LOG_FILE for details."
  log_file "=== BUY-57336 disk enforcement complete ==="

  return "$exit_code"
}

main "$@"
