#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if WORKTREE_ROOT="$(git -C "${SCRIPT_DIR}/.." rev-parse --show-toplevel 2>/dev/null)"; then
  WORKDIR="$WORKTREE_ROOT"
else
  WORKDIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi

OUTPUT_DIR="${WORKDIR}/data"
PID_DIR="${OUTPUT_DIR}/fetch-qa-pids"
MONITOR_LOG="/tmp/fetch-qa-monitor.log"
CHECK_INTERVAL=300
STALE_THRESHOLD=1800
STATE_FILE="${OUTPUT_DIR}/fetch-qa-watchdog-state.txt"
FAILURE_THRESHOLD=2

declare -i RESTART=0
declare -i STALE=0
declare -i FAILED_ROUTINES=0
declare -A ROUTINE_FAILS=()

mkdir -p "$PID_DIR" 2>/dev/null || true

log() {
    echo "[$(date '+%Y-%m-%dT%H:%M:%S')] $1" | tee -a "$MONITOR_LOG"
}

load_failure_state() {
    if [[ ! -f "$STATE_FILE" ]]; then
        return 0
    fi

    while IFS='=' read -r routine fails; do
        if [[ -n "$routine" && "$routine" != \#* ]]; then
            ROUTINE_FAILS["$routine"]="$fails"
        fi
    done < "$STATE_FILE"
}

save_failure_state() {
    mkdir -p "$OUTPUT_DIR"
    : > "$STATE_FILE"
    for routine in "${!ROUTINE_FAILS[@]}"; do
        printf "%s=%s\n" "$routine" "${ROUTINE_FAILS[$routine]}" >> "$STATE_FILE"
    done
}

alert_fetch_qa() {
    local routine_name="$1"
    local failures="$2"
    log "ALERT: $routine_name has ${failures} consecutive dispatch failures"

    if [[ -n "${FETCH_QA_ALERT_WEBHOOK:-}" ]]; then
        curl -sS -X POST -H "Content-Type: application/json" \
            -d "{\"text\":\"Fetch QA frontend watchdog alert: ${routine_name} has ${failures} consecutive dispatch failures.\"}" \
            "$FETCH_QA_ALERT_WEBHOOK" >/dev/null 2>&1 || true
    fi
}

check_routine_alive() {
    local routine_name="$1"
    local pid_file="${PID_DIR}/${routine_name}.pid"
    local pattern="$2"

    if [[ -f "$pid_file" ]]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            local cmd
            cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
            if [[ "$cmd" =~ $pattern ]]; then
                return 0
            fi
        fi
    fi

    while IFS= read -r line; do
        local live_pid
        local cmd
        live_pid=$(echo "$line" | awk '{print $1}')
        cmd=$(echo "$line" | cut -d' ' -f2-)
        if [[ -n "$live_pid" && "$cmd" =~ $pattern ]]; then
            echo "$live_pid" > "$pid_file"
            return 0
        fi
    done < <(pgrep -af "$pattern")

    return 1
}

check_data_fresh() {
    local data_dir="$1"
    local max_age="${2:-900}"

    if [[ ! -d "$data_dir" ]]; then
        return 1
    fi

    local newest_mtime
    newest_mtime=$(find "$data_dir" -maxdepth 1 -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
    if [[ -z "$newest_mtime" ]]; then
        return 1
    fi

    local now
    now=$(date +%s)
    local age=$((now - newest_mtime))

    if [[ $age -gt $max_age ]]; then
        return 1
    fi
    return 0
}

check_frontend_routine() {
    local routine_name="$1"
    local data_dir="$2"
    local pattern="$3"
    local max_stale="${4:-900}"

    log "Checking frontend routine: $routine_name"

    local running=0
    local stale=0
    local fail_count

    if ! check_routine_alive "$routine_name" "$pattern"; then
        log "  WARN: $routine_name is NOT running"
        running=1
        RESTART=1
    fi

    if ! check_data_fresh "$data_dir" "$max_stale"; then
        log "  WARN: $routine_name data is stale (>${max_stale}s without update)"
        stale=1
        STALE=1
    fi

    if [[ $running -eq 0 && $stale -eq 0 ]]; then
        log "  OK: $routine_name dispatch check passed"
        ROUTINE_FAILS["$routine_name"]=0
        return 0
    fi

    fail_count=$(( ${ROUTINE_FAILS[$routine_name]:-0} + 1 ))
    ROUTINE_FAILS["$routine_name"]="$fail_count"
    FAILED_ROUTINES=$((FAILED_ROUTINES + 1))

    if [[ $fail_count -ge $FAILURE_THRESHOLD ]]; then
        alert_fetch_qa "$routine_name" "$fail_count"
    fi
}

load_failure_state

FRONTEND_ROUTINES=(
    "carousell-sg:data/carousell-sg:python3 -m scrapers\\.carousell_sg.*--continuous:900"
    "shopee-main:data/shopee-main:python3 -m scrapers\\.shopee_sg.*--continuous:900"
    "fairprice-scrape:data/fairprice_scrape:python3 -m scrapers\\.fairprice_sg.*--continuous:900"
    "guardian-sg:data/guardian_sg:python3 -m scrapers\\.guardian_sg.*--continuous:900"
    "watsons-sg:data/watsons_sg:python3 -m scrapers\\.watsons_sg.*--continuous:900"
)

for entry in "${FRONTEND_ROUTINES[@]}"; do
    IFS=':' read -r name datadir pattern max_stale <<< "$entry"
    if [[ -d "$WORKDIR/$datadir" ]]; then
        check_frontend_routine "$name" "$WORKDIR/$datadir" "$pattern" "$max_stale"
    fi
done

save_failure_state

if [[ $FAILED_ROUTINES -gt 0 ]]; then
    log "Action: Alerting on frontend routine issues"
fi

log "Fetch QA frontend watchdog cycle complete"
return 0
