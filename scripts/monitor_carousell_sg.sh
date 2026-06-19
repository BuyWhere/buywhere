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
WRAPPER_PID_FILE="/home/paperclip/buywhere-api/data/carousell-sg/wrapper.pid"
LOG_FILE="${OUTPUT_DIR}/scraper.log"
MONITOR_LOG="/tmp/carousell-sg-monitor.log"

SCRAPER_CMD=(python3 -m scrapers.carousell_sg --scrape-only --continuous --refresh-interval 14400)
SCRAPER_PROC_PATTERN="python3 -m scrapers\.carousell_sg .*--continuous"

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
    # Check wrapper process (keeps scraper as child, PPID != 1 avoids orphan reaper)
    if [[ -f "$WRAPPER_PID_FILE" ]]; then
        local wpid
        wpid=$(cat "$WRAPPER_PID_FILE")
        if kill -0 "$wpid" 2>/dev/null; then
            return 0
        fi
    fi

    while IFS= read -r line; do
        local live_pid
        local cmd
        live_pid=$(echo "$line" | awk '{print $1}')
        cmd=$(echo "$line" | cut -d' ' -f2-)
        if [[ -n "$live_pid" && "$cmd" =~ $SCRAPER_PROC_PATTERN ]]; then
            ((live_count += 1))
            pid_from_file=1
        fi
    done < <(pgrep -af "python3 -m scrapers.carousell_sg")

    if [[ $pid_from_file -eq 1 ]]; then
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
    while IFS= read -r line; do
        pid=$(echo "$line" | awk '{print $1}')
        cmd=$(echo "$line" | cut -d' ' -f2-)
        if [[ "$cmd" =~ $SCRAPER_PROC_PATTERN ]]; then
            kill "$pid" 2>/dev/null || true
        fi
    done < <(pgrep -af "python3 -m scrapers.carousell_sg")
    # Also kill wrapper daemon if running
    if [[ -f "$WRAPPER_PID_FILE" ]]; then
        wpid=$(cat "$WRAPPER_PID_FILE")
        kill "$wpid" 2>/dev/null || true
        rm -f "$WRAPPER_PID_FILE"
    fi
    sleep 2
    cd "$WORKDIR"
    nohup bash "${SCRIPT_DIR}/carousell_sg_daemon_wrapper.sh" >> "$LOG_FILE" 2>&1 &
    NEW_PID=$!
    echo "$NEW_PID" > "$WRAPPER_PID_FILE"
    log "Started wrapper with PID $NEW_PID"
fi

log "Monitor cycle complete"
