#!/usr/bin/env bash
# buy72215-stale-keeper.sh — BUY-72215 / BUY-72219
# Cron wrapper for the catalog DB stale-session killer. Runs every 5 minutes.
#
# - cds to the repo root so node can resolve the `pg` package and the script
#   can read data/.catalog_db_url.
# - flock(1) guards against overlapping runs (rate-limit safety).
# - Logs to data/buy30620-stale-kills.log (script also appends per-run).
set -euo pipefail

REPO_ROOT="${BUYWHERE_REPO_ROOT:-/home/paperclip/buywhere}"
SCRIPT="$REPO_ROOT/scripts/buy72215-stale-session-killer.mjs"
LOCKFILE="${BUY72215_LOCKFILE:-$REPO_ROOT/data/buy72215-stale-keeper.lock}"

if [[ ! -f "$SCRIPT" ]]; then
  echo "[$(date -u +%FT%TZ)] buy72215 stale-keeper: $SCRIPT missing" >> "$REPO_ROOT/logs/buy72215-stale-keeper.log" 2>/dev/null || true
  echo "ERROR: $SCRIPT not found (BUYWHERE_REPO_ROOT=$REPO_ROOT)" >&2
  exit 1
fi

cd "$REPO_ROOT"

mkdir -p "$REPO_ROOT/data" 2>/dev/null || true
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  # flock -n returns immediately if another run holds the lock (rate-limit
  # safety). This is the expected skip path when a prior run overlaps.
  echo "[$(date -u +%FT%TZ)] buy72215 stale-keeper: previous run still active, skipping" \
    >> "$REPO_ROOT/logs/buy72215-stale-keeper.log" 2>/dev/null || true
  exit 0
fi
exec node "$SCRIPT" >> "$REPO_ROOT/logs/buy72215-stale-keeper.log" 2>&1
