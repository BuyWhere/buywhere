#!/usr/bin/env bash
# run-buy-56114-disk-space-watchdog-cron.sh — BUY-56114 / BUY-56153 / BUY-48198
# Canonical disk-space watchdog (consolidated from BUY-56044, BUY-56093, BUY-56113, BUY-56114).
# Monitors root filesystem free space. Warns at <20GB. Creates critical Paperclip
# incident at <5GB. Runs every 5 minutes via cron. Idempotent: state-file
# deduplication prevents incident spam (30 min dedup, 60 min warn).
#
# Also receives appended log entries from carousell-sg-disk-cleanup.sh
# (BUY-56110) so the operator can see cleanup activity in one place.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/buy-56114-disk-space-watchdog.log"
mkdir -p "$REPO_ROOT/logs"

# Free space in GB (round down) for the root filesystem (handles /dev/vda1 or whatever)
FREE_GB=$(df -BG / 2>/dev/null | awk 'NR==2 {gsub(/G/,"",$4); print $4}' || echo "0")
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# State directory for deduplication
STATE_DIR="/tmp/buy-56114-disk-space-watchdog"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/last-incident-id"
WARN_FILE="$STATE_DIR/last-warn-run"

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
        log "ERROR: Cannot create incident — Paperclip credentials not available (PAPERCLIP_API_KEY/PAPERCLIP_API_URL/PAPERCLIP_COMPANY_ID missing)"
        return 1
    fi

    if [[ -f "$STATE_FILE" ]]; then
        local age_m now elapsed
        age_m=$(stat -c %Y "$STATE_FILE" 2>/dev/null || echo 0)
        now=$(date +%s)
        elapsed=$(( (now - age_m) / 60 ))
        if [[ "$elapsed" -lt 30 ]]; then
            log "SKIP: Incident already created ${elapsed}m ago (within 30m dedup window)"
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

CRITICAL_GB=5
WARN_GB=20

if [[ "$FREE_GB" -lt "$CRITICAL_GB" ]]; then
    log "CRITICAL: Root filesystem free space below ${CRITICAL_GB}GB ($FREE_GB GB remaining)"
    create_incident \
        "CRITICAL: Disk space low on root filesystem ($FREE_GB GB remaining)" \
        "critical" \
        "Free disk space on the root filesystem is critically low: **$FREE_GB GB** remaining (threshold: ${CRITICAL_GB}GB).\n\nTimestamp: $TS\n\nThis is an automated incident created by the disk-space watchdog (BUY-56114/BUY-56153/BUY-48198)."
    exit 2
elif [[ "$FREE_GB" -lt "$WARN_GB" ]]; then
    log "WARN: Root filesystem free space below ${WARN_GB}GB ($FREE_GB GB remaining)"
    if [[ ! -f "$WARN_FILE" ]] || [[ -n $(find "$WARN_FILE" -mmin +60 2>/dev/null) ]]; then
        touch "$WARN_FILE"
        log "WARN: Persistent low disk warning at $FREE_GB GB"
    fi
    exit 1
else
    log "OK: Root filesystem free space $FREE_GB GB"
    rm -f "$STATE_FILE" 2>/dev/null || true
    exit 0
fi
