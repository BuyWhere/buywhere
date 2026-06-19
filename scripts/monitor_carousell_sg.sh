#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REAL_DATA_DIR="/home/paperclip/buywhere-api/data/carousell-sg"
OUTPUT_DIR="${REAL_DATA_DIR}"
PID_FILE="${REAL_DATA_DIR}/scraper.pid"
WRAPPER_PID_FILE="${REAL_DATA_DIR}/wrapper.pid"
LOG_FILE="${REAL_DATA_DIR}/scraper.log"
MONITOR_LOG="/tmp/carousell-sg-monitor.log"

export REDIS_URL="redis://localhost:6380"

SCRAPER_CMD=(python3 -m scrapers.carousell_sg --scrape-only --continuous --refresh-interval 14400)
SCRAPER_PROC_PATTERN="python3 -m scrapers\.carousell_sg .*--continuous"

declare -i RESTART=0
declare -i JSONL_NEW=0

check_alive() {
    if [[ -f "$PID_FILE" ]]; then
        pid=$(cat "$PID_FILE")
        if [[ -n "$pid" ]] && ps -p "$pid" > /dev/null; then
            return 0
        fi
    fi
    return 1
}

check_jsonl_fresh() {
    local newest_mtime
    newest_mtime=$(find "$OUTPUT_DIR" -maxdepth 1 -name "products_*.jsonl" -type f -printf "%T@\n" 2>/dev/null | sort -n | tail -1)
    if [[ -z "$newest_mtime" ]]; then
        return 1
    fi
    local now
    now=$(date +%s)
    local age=$((now - newest_mtime))
    [[ "$age" -lt 900 ]] || return 1
}

log() {
    echo "[$(date +%Y-%m-%dT%H:%M:%S)] $1" | tee -a "$MONITOR_LOG"
}

if check_alive; then
    log "OK: Carousell SG scraper daemon is running"
else
    log "WARN: Carousell SG scraper daemon is NOT running - will restart"
    RESTART=1
fi

if [[ $RESTART -eq 1 ]] || ! check_jsonl_fresh; then
    log "Action: Restarting Carousell SG scraper..."
    pgrep -af "python3 -m scrapers.carousell_sg" | while read -r line; do
        pid=$(echo "$line" | awk {print })
        kill "$pid" 2>/dev/null || true
    done
    nohup bash "${SCRIPT_DIR}/carousell_sg_daemon_wrapper.sh" >> "$LOG_FILE" 2>&1 &
    echo "$!" > "$WRAPPER_PID_FILE"
    log "Started wrapper with PID $!"
fi

log "Monitor cycle complete"
