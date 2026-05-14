#!/bin/bash
set -euo pipefail

OUTPUT_DIR="/home/paperclip/buywhere-api/data/carousell-sg"
PID_FILE="$OUTPUT_DIR/scraper.pid"
LOG_FILE="$OUTPUT_DIR/scraper.log"
MONITOR_LOG="/tmp/carousell-sg-monitor.log"

SCRAPER_CMD="python3 -m scrapers.carousell_sg --scrape-only --continuous --refresh-interval 14400"
WORKDIR="/home/paperclip/buywhere-api"

declare -i RESTART=0
declare -i JSONL_NEW=0

check_alive() {
    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    if pgrep -f "python3 -m scrapers.carousell_sg.*--continuous" >/dev/null 2>&1; then
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
    if [[ $age -lt 900 ]]; then
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
    pkill -f "python3 -m scrapers.carousell_sg" 2>/dev/null || true
    sleep 2
    cd "$WORKDIR"
    nohup $SCRAPER_CMD >> "$LOG_FILE" 2>&1 &
    NEW_PID=$!
    echo "$NEW_PID" > "$PID_FILE"
    log "Started with PID $NEW_PID"
fi

log "Monitor cycle complete"