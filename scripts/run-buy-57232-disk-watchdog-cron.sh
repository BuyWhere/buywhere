#!/usr/bin/env bash
# run-buy-57232-disk-space-watchdog-cron.sh — BUY-57232 / BUY-48198
# Disk-space watchdog for the root filesystem (/dev/vda1). Warns at <20GB.
# Creates a critical Paperclip incident at <5GB. Runs every 5 minutes via cron.
# Idempotent: state-file dedup prevents incident spam (30 min critical, 60 min warn).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/buy-57232-disk-space-watchdog.log"
STATE_DIR="/tmp/buy-57232-disk-space-watchdog"
mkdir -p "$REPO_ROOT/logs" "$STATE_DIR"
STATE_FILE="$STATE_DIR/last-incident-id"
WARN_FILE="$STATE_DIR/last-warn-run"

# Source Paperclip credentials (if not already in environment)
# shellcheck source=/dev/null
if [[ -f /home/paperclip/.paperclip_env ]]; then
    . /home/paperclip/.paperclip_env
fi

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

log() {
    echo "[$TS] $1" >> "$LOG_FILE"
}

# Create a Paperclip incident via the API. Dedup: skip if an incident was created
# within the last 30 minutes.
create_incident() {
    local title="$1"
    local priority="$2"
    local body="$3"

    local api_key="${PAPERCLIP_API_KEY:-}"
    local api_url="${PAPERCLIP_API_URL:-}"
    local company_id="${PAPERCLIP_COMPANY_ID:-}"

    if [[ -z "$api_key" || -z "$api_url" || -z "$company_id" ]]; then
        log "ERROR: Cannot create incident — Paperclip credentials not available"
        return 1
    fi

    if [[ -f "$STATE_FILE" ]]; then
        local age_m now elapsed
        age_m=$(stat -c %Y "$STATE_FILE" 2>/dev/null || echo 0)
        now=$(date +%s)
        elapsed=$(( (now - age_m) / 60 ))
        if [[ "$elapsed" -lt 30 ]]; then
            log "SKIP: Incident already created ${elapsed}m ago (within 30m dedup)"
            return 0
        fi
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
        echo "$issue_id" > "$STATE_FILE"
        log "Created incident $issue_id: $title"
    else
        log "Failed to create incident: response=$response"
    fi
}

# Free space in GB (round down) for /dev/vda1; fall back to / if device missing.
FREE_GB=$(df -BG /dev/vda1 2>/dev/null | awk 'NR==2 {gsub(/G/,"",$4); print $4}' || true)
if [[ -z "$FREE_GB" ]]; then
    FREE_GB=$(df -BG / 2>/dev/null | awk 'NR==2 {gsub(/G/,"",$4); print $4}' || echo "0")
fi

CRITICAL_GB=5
WARN_GB=20

if [[ "$FREE_GB" -lt "$CRITICAL_GB" ]]; then
    log "CRITICAL: /dev/vda1 free space below ${CRITICAL_GB}GB ($FREE_GB GB remaining)"
    create_incident \
        "CRITICAL: Disk space low on /dev/vda1 ($FREE_GB GB remaining) — BUY-57232/BUY-48198" \
        "critical" \
        "Free disk space on /dev/vda1 is critically low: **$FREE_GB GB** remaining (threshold: ${CRITICAL_GB}GB).\n\nTimestamp: $TS\n\nAutomated incident — disk-space watchdog (BUY-57232/BUY-48198)."
    exit 2
elif [[ "$FREE_GB" -lt "$WARN_GB" ]]; then
    log "WARN: /dev/vda1 free space below ${WARN_GB}GB ($FREE_GB GB remaining)"
    if [[ ! -f "$WARN_FILE" ]] || [[ -n $(find "$WARN_FILE" -mmin +60 2>/dev/null) ]]; then
        touch "$WARN_FILE"
        log "WARN: Persistent low disk warning at $FREE_GB GB"
    fi
    exit 1
else
    log "OK: /dev/vda1 free space $FREE_GB GB"
    rm -f "$STATE_FILE" 2>/dev/null || true
    exit 0
fi
