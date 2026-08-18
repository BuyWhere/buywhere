#!/usr/bin/env bash
# BUY-70996 — Drain lane rotation cron wrapper.
# Runs every 30 minutes via crontab.
# Chains analyzer → rotator to bias drain lanes toward net-new inserts.
set -euo pipefail

SCRIPT_DIR="/home/paperclip/buywhere/scripts"
REPO_ROOT="/home/paperclip/buywhere"
LOG_DIR="$REPO_ROOT/data/reports"
SCHEDULER="$SCRIPT_DIR/drain_lane_scheduler.mjs"
CATALOG_DB_URL=$(cat "$REPO_ROOT/data/.catalog_db_url" 2>/dev/null || true)

mkdir -p "$LOG_DIR"

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ -z "$CATALOG_DB_URL" ]; then
  echo "[$TS] drain_lane_cron: ERROR — no .catalog_db_url found" >> "$LOG_DIR/drain_lane_scheduler.log"
  exit 1
fi

echo "[$TS] drain_lane_cron: starting rotation cycle" >> "$LOG_DIR/drain_lane_scheduler.log"

DATABASE_URL="$CATALOG_DB_URL" node "$SCHEDULER" --hours 6 >> "$LOG_DIR/drain_lane_scheduler.log" 2>&1
EXIT_CODE=$?

TS2=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if [ $EXIT_CODE -eq 0 ]; then
  echo "[$TS2] drain_lane_cron: rotation cycle complete" >> "$LOG_DIR/drain_lane_scheduler.log"
else
  echo "[$TS2] drain_lane_cron: rotation cycle FAILED (exit $EXIT_CODE)" >> "$LOG_DIR/drain_lane_scheduler.log"
fi
