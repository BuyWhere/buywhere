#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if WORKTREE_ROOT="$(git -C "${SCRIPT_DIR}/.." rev-parse --show-toplevel 2>/dev/null)"; then
  WORKDIR="$WORKTREE_ROOT"
else
  WORKDIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
OUTPUT_DIR="${WORKDIR}/data/carousell-sg"
PID_FILE="${OUTPUT_DIR}/scraper.pid"
LOG_FILE="${OUTPUT_DIR}/scraper.log"
MONITOR_LOG="/tmp/carousell-sg-monitor.log"

# BUY-56868 — Cron-launched shells do not inherit SCRAPERAPI_KEY, so
# scraper_scheduler.py exits with "error_no_scraperapi_key" every cycle.
# Source the canonical fleet-secrets file (same pattern as
# scripts/buy52477-r2-heartbeat.sh and scripts/buy31015-deep-page-keepalive.sh)
# so the spawned daemon sees a valid key without depending on the cron env.
SECRETS_FILE="${SECRETS_FILE:-/home/paperclip/.secrets/fleet-secrets.json}"
if [[ -z "${SCRAPERAPI_KEY:-}" && -r "$SECRETS_FILE" ]]; then
  export SCRAPERAPI_KEY="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("SCRAPERAPI_KEY",""))' "$SECRETS_FILE" 2>/dev/null || true)"
  export BRIGHTDATA_ZONE_PASSWORD="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("BRIGHTDATA_ZONE_PASSWORD",""))' "$SECRETS_FILE" 2>/dev/null || true)"
fi

# BUY-56868: Launch via scripts/scraper_scheduler.py --continuous --platform carousell_sg
# (the scraper module does not accept --continuous/--refresh-interval; only the scheduler
# daemon does, and it owns the SCRAPERAPI_KEY validation + inner scraper args.)
SCRAPER_CMD=(python3 scripts/scraper_scheduler.py --continuous --platform carousell_sg)
SCRAPER_PROC_PATTERN="python3 scripts/scraper_scheduler\.py .*--platform carousell_sg"

declare -i RESTART=0
declare -i JSONL_NEW=0

check_alive() {
    local pid_from_file=0
    local live_count=0

    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            local cmd
            cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
            if [[ "$cmd" =~ $SCRAPER_PROC_PATTERN ]]; then
                return 0
            fi
        fi
    fi

    while IFS= read -r line; do
        local live_pid
        local cmd
        live_pid=$(echo "$line" | awk '{print $1}')
        cmd=$(echo "$line" | cut -d' ' -f2-)
        if [[ -n "$live_pid" && "$cmd" =~ $SCRAPER_PROC_PATTERN ]]; then
            ((live_count += 1))
        fi
    done < <(pgrep -af "scraper_scheduler\.py .*--platform carousell_sg")

    if [[ $live_count -ge 1 ]]; then
        return 0
    fi

    return 1
}

check_jsonl_fresh() {
    local newest_mtime
    newest_mtime=$(find "$OUTPUT_DIR" -maxdepth 1 -name 'products_*.jsonl' -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
    if [[ -z "$newest_mtime" ]]; then
        return 1
    fi
    local now
    now=$(date +%s)
    local age=$((now - newest_mtime))
    if [[ $age -lt 14400 ]]; then
        return 0
    fi
    return 1
}

log() {
    echo "[$(date '+%Y-%m-%dT%H:%M:%S')] $1" | tee -a "$MONITOR_LOG"
}

if check_alive; then
    log "OK: Carousell SG scraper daemon is running"
else
    log "WARN: Carousell SG scraper daemon is NOT running - will restart"
    RESTART=1
fi

if ! check_jsonl_fresh; then
    log "WARN: No new JSONL files in last 15 minutes"
    JSONL_NEW=1
fi

if [[ $RESTART -eq 1 ]] || [[ $JSONL_NEW -eq 1 ]]; then
    log "Action: Restarting Carousell SG scraper..."
    while IFS= read -r line; do
        pid=$(echo "$line" | awk '{print $1}')
        cmd=$(echo "$line" | cut -d' ' -f2-)
        if [[ "$cmd" =~ $SCRAPER_PROC_PATTERN ]]; then
            kill "$pid" 2>/dev/null || true
        fi
    done < <(pgrep -af "scraper_scheduler\.py .*--platform carousell_sg")
    sleep 2
    cd "$WORKDIR"
    nohup "${SCRAPER_CMD[@]}" >> "$LOG_FILE" 2>&1 &
    NEW_PID=$!
    echo "$NEW_PID" > "$PID_FILE"
    log "Started with PID $NEW_PID"
fi

log "Monitor cycle complete"
