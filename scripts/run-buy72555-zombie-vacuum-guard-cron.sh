#!/usr/bin/env bash
# BUY-72555 hourly catalog.products autovacuum liveness guard.
set -euo pipefail

REPO_ROOT="${BUYWHERE_REPO_ROOT:-/home/paperclip/buywhere}"
SCRIPT="$REPO_ROOT/scripts/buy72555-zombie-vacuum-guard.py"
LOCKFILE="$REPO_ROOT/data/buy72555-zombie-vacuum-guard.lock"
LOG_FILE="$REPO_ROOT/logs/buy72555-zombie-vacuum-guard.log"

mkdir -p "$REPO_ROOT/data" "$REPO_ROOT/logs"

exec 9>"$LOCKFILE"
if ! flock -n 9; then
  echo "[$(date -u +%FT%TZ)] BUY-72555 previous guard run still active, skipping" >> "$LOG_FILE"
  exit 0
fi

cd "$REPO_ROOT"
exec python3 "$SCRIPT" >> "$LOG_FILE" 2>&1
