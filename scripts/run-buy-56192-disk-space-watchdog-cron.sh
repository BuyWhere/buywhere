#!/usr/bin/env bash
# run-buy-56192-disk-space-watchdog-cron.sh — BUY-56192 / BUY-48198
# Disk-space watchdog for the root filesystem. Monitors free space on /.
# Warns at <20GB. Creates a critical Paperclip incident at <5GB.
# Runs every 5 minutes via cron. Idempotent: state-file deduplication
# prevents incident spam (30 min dedup for critical, 60 min warn).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/buy-56192-disk-space-watchdog.log"
mkdir -p "$REPO_ROOT/logs"

# Source Paperclip credentials (if not already in environment)
# shellcheck source=/dev/null
if [[ -f /home/paperclip/.paperclip_env ]]; then
    . /home/paperclip/.paperclip_env
fi

# -- database snapshot helper -------------------------------------------------
record_snapshot() {
    local total_bytes="$1" used_bytes="$2" free_bytes="$3" usage_pct="$4"
    local db_url="${DATABASE_URL:-}"
    if [[ -z "$db_url" ]]; then
        log "WARN: DATABASE_URL not set -- skipping DB snapshot"
        return 0
    fi
    psql "$db_url" -c "
        INSERT INTO monitoring.disk_space
            (measured_at, mount_point, total_bytes, used_bytes, free_bytes, usage_pct, alert_threshold)
        VALUES
            (now(), '/', $total_bytes, $used_bytes, $free_bytes, $usage_pct, 85.00)
    " >/dev/null 2>&1 && log "DB snapshot recorded" || log "WARN: DB snapshot failed"
}

# Free space in GB (round down) for the root filesystem
FREE_GB=$(df -BG / 2>/dev/null | awk 'NR==2 {gsub(/G/,"",$4); print $4}' || echo "0")
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# State directory for deduplication
STATE_DIR="/tmp/buy-56192-disk-space-watchdog"
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

# Capture raw bytes for DB snapshot
DF_LINE=$(df -B1 / 2>/dev/null | awk 'NR==2' || true)
TOTAL_BYTES=$(echo "$DF_LINE" | awk '{print $2}')
USED_BYTES=$(echo "$DF_LINE" | awk '{print $3}')
FREE_B1=$(echo "$DF_LINE" | awk '{print $4}')
USAGE_PCT=$(echo "$DF_LINE" | awk '{gsub(/%/,"",$5); print $5}')

# Record snapshot regardless of threshold
record_snapshot "$TOTAL_BYTES" "$USED_BYTES" "$FREE_B1" "$USAGE_PCT"

CRITICAL_GB=5
WARN_GB=20

if [[ "$FREE_GB" -lt "$CRITICAL_GB" ]]; then
    log "CRITICAL: Root filesystem free space below ${CRITICAL_GB}GB ($FREE_GB GB remaining)"
    create_incident \
        "CRITICAL: Disk space low on root filesystem ($FREE_GB GB remaining)" \
        "critical" \
        "Free disk space on the root filesystem is critically low: **$FREE_GB GB** remaining (threshold: ${CRITICAL_GB}GB).\n\nTimestamp: $TS\n\nAutomated incident — disk-space watchdog (BUY-56192/BUY-48198)."
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
