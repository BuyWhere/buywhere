#!/usr/bin/env bash
# BUY-70996 — Drain lane rotation cron wrapper.
# Runs every 30 minutes via crontab.
# Chains analyzer → rotator to bias drain lanes toward net-new inserts.
#
# Env overrides:
#   REPO_ROOT        path to the buywhere repo (default: /home/paperclip/buywhere)
#   DRAIN_HOURS      hours back for analyzer (default: 6)
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/home/paperclip/buywhere}"
SCRIPT_DIR="${SCRIPT_DIR:-$REPO_ROOT/scripts}"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/data/reports}"
SCHEDULER="$SCRIPT_DIR/drain_lane_scheduler.mjs"
CATALOG_DB_URL_FILE="${CATALOG_DB_URL_FILE:-$REPO_ROOT/data/.catalog_db_url}"
CATALOG_DB_URL="${CATALOG_DB_URL:-$(cat "$CATALOG_DB_URL_FILE" 2>/dev/null || true)}"
DRAIN_HOURS="${DRAIN_HOURS:-6}"
LOCK_FILE="${LOCK_FILE:-/tmp/buywhere-drain-lane-rotator.lock}"

mkdir -p "$LOG_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] drain_lane_cron: previous rotation still running; skipping" >> "$LOG_DIR/drain_lane_scheduler.log"
  exit 0
fi

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ -z "$CATALOG_DB_URL" ]; then
  echo "[$TS] drain_lane_cron: ERROR — no .catalog_db_url found at $CATALOG_DB_URL_FILE" >> "$LOG_DIR/drain_lane_scheduler.log"
  exit 1
fi

echo "[$TS] drain_lane_cron: starting rotation cycle (repo=$REPO_ROOT hours=$DRAIN_HOURS)" >> "$LOG_DIR/drain_lane_scheduler.log"

DATABASE_URL="$CATALOG_DB_URL" node "$SCHEDULER" --hours "$DRAIN_HOURS" >> "$LOG_DIR/drain_lane_scheduler.log" 2>&1
EXIT_CODE=$?

TS2=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if [ $EXIT_CODE -eq 0 ]; then
  echo "[$TS2] drain_lane_cron: rotation cycle complete" >> "$LOG_DIR/drain_lane_scheduler.log"
else
  echo "[$TS2] drain_lane_cron: rotation cycle FAILED (exit $EXIT_CODE)" >> "$LOG_DIR/drain_lane_scheduler.log"
fi
