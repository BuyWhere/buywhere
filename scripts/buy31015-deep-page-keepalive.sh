#!/usr/bin/env bash
# BUY-31015 WooCommerce deep-page keep-alive (BUY-51993).
#
# Cron owner every 2 minutes. This script:
#   1) Checks if the supervisor reports a live worker.
#   2) If dead, restarts via `buy31015-deep-page-supervisor.mjs --restart`.
#   3) Persists `data/buy31015-deep-page-keep-alive-state.json` for the
#      8-minute GitHub Action reporting tick to show cycle and discovery progress.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUPERVISOR="$SCRIPT_DIR/buy31015-deep-page-supervisor.mjs"
KEEP_STATE_FILE="$REPO_ROOT/data/buy31015-deep-page-keep-alive-state.json"
WORKER_STATUS_FILE="$REPO_ROOT/data/buy31015-deep-page-status.json"
PIDFILE="$REPO_ROOT/data/.buy31015-deep-page.pid"
TS_NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p "$REPO_ROOT/data" "$REPO_ROOT/logs"


ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
say() { echo "[$(ts)] keepalive: $*"; }
# Source lane env vars (BUYWHERE_API_URL, BUYWHERE_API_KEY, etc.) so the
# supervisor inherits them and passes them to the worker.  Without this,
# the worker falls back to localhost:8000 and every ingest call fails.
LANE_ENV="$REPO_ROOT/data/.env.buy31015-lane"
if [ -f "$LANE_ENV" ]; then
  set -a
  . "$LANE_ENV"
  set +a
else
  say "WARNING: $LANE_ENV not found; worker will default to localhost:8000"
fi

read_int() {
  local file="$1"
  local key="$2"
  local fallback="${3:-0}"
  python3 - "$file" "$key" "$fallback" <<'PY'
import json, sys
path, key, fallback = sys.argv[1:4]
try:
    data = json.load(open(path))
    value = data.get(key)
    if isinstance(value, bool):
        value = int(value)
    print(int(value))
except Exception:
    print(fallback)
PY
}

# 1) Gather latest worker status metrics (if available)
CYCLE="$(read_int "$WORKER_STATUS_FILE" "cycle" "0")"
ROWS_INSERTED="$(read_int "$WORKER_STATUS_FILE" "rowsInserted" "0")"
ROWS_UPDATED="$(read_int "$WORKER_STATUS_FILE" "rowsUpdated" "0")"
ROWS_PER_HOUR="$(read_int "$WORKER_STATUS_FILE" "rowsPerHour" "0")"
MERCHANTS_VISITED="$(read_int "$WORKER_STATUS_FILE" "merchantsVisited" "0")"
TOTAL_MERCHANTS="$(read_int "$WORKER_STATUS_FILE" "totalMerchants" "0")"
ROWS_INGESTED="$((ROWS_INSERTED + ROWS_UPDATED))"

CONSECUTIVE_DEAD=0
if [ -f "$KEEP_STATE_FILE" ]; then
  CONSECUTIVE_DEAD=$(read_int "$KEEP_STATE_FILE" "consecutive_dead" "0")
fi

ALIVE_PID=""
FINAL_STATUS="DEAD"
if CHECK_OUTPUT="$(node "$SUPERVISOR" --check 2>&1)"; then
  FINAL_STATUS="RUNNING"
  ALIVE_PID="$(printf '%s\n' "$CHECK_OUTPUT" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
  CONSECUTIVE_DEAD=0
fi

ACTION="noop"
if [ "$FINAL_STATUS" = "DEAD" ]; then
  ACTION="restart"
  if [ -f "$PIDFILE" ]; then
    OLD_PID="$(cut -d'|' -f1 "$PIDFILE" 2>/dev/null || true)"
    if [ -n "${OLD_PID:-}" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      say "stopping stale pid=${OLD_PID} before restart"
      kill "$OLD_PID" 2>/dev/null || true
      sleep 1
      kill -9 "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi

  RESTART_OUTPUT="$(node "$SUPERVISOR" --restart 2>&1 || true)"
  NEW_PID="$(printf '%s\n' "$RESTART_OUTPUT" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
  if [ -z "$NEW_PID" ] && [ -f "$PIDFILE" ]; then
    NEW_PID="$(cut -d'|' -f1 "$PIDFILE" 2>/dev/null || true)"
  fi
  ALIVE_PID="$NEW_PID"

  if node "$SUPERVISOR" --check >/dev/null 2>&1; then
    FINAL_STATUS="RUNNING"
    ACTION="restarted"
  else
    ACTION="restart_failed"
  fi

  CONSECUTIVE_DEAD=$((CONSECUTIVE_DEAD + 1))
fi

python3 - "$KEEP_STATE_FILE" "$TS_NOW" "$FINAL_STATUS" "$ACTION" "$CONSECUTIVE_DEAD" \
  "$CYCLE" "$ROWS_INGESTED" "$ROWS_PER_HOUR" "$MERCHANTS_VISITED" "$TOTAL_MERCHANTS" "$ALIVE_PID" <<'PY'
import json
import os
import sys

path, ts, status, action, consecutive, cycle, rows_ingested, rows_per_hour, merchants, total, pid = sys.argv[1:12]
first_dead_at = ts
if status != "RUNNING" and os.path.exists(path):
    try:
        with open(path) as f:
            prev = json.load(f)
        prev_dead = prev.get("first_dead_at")
        if isinstance(prev_dead, str) and prev_dead:
            first_dead_at = prev_dead
    except Exception:
        pass
row = {
    "ts": ts,
    "alive_status": status,
    "last_action": action,
    "consecutive_dead": int(consecutive),
    "cycle": int(cycle),
    "rows_ingested": int(rows_ingested),
    "rows_per_hour": int(rows_per_hour),
    "merchants_visited": int(merchants),
    "total_merchants": int(total) if str(total).isdigit() and int(total) >= 0 else 0,
    "pid": pid if pid else None,
}
if status == "RUNNING":
    row["first_dead_at"] = None
else:
    row["first_dead_at"] = first_dead_at

tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(row, f, indent=2)
os.replace(tmp, path)
PY

say "status=$FINAL_STATUS action=$ACTION pid=${ALIVE_PID:-0} cycle=$CYCLE rows=$ROWS_INGESTED row/hr=$ROWS_PER_HOUR merchants=$MERCHANTS_VISITED/$TOTAL_MERCHANTS dead_streak=$CONSECUTIVE_DEAD"
