#!/usr/bin/env bash
# scripts/check-frontend-health.sh — Fetch QA frontend UI health check (BUY-17936)
# Intended to run as a cron job every 5 minutes.
# Usage: ./scripts/check-frontend-health.sh
#   FRONTEND_URL — Frontend base URL (default: https://buywhere.ai)
#   FRONTEND_HEALTH_PATH — Health endpoint/path to validate (default: /health-check)
#   LOG_DIR — directory for uptime log (default: /var/log/buywhere)
#   LOG_FILE — full path to log file (overrides LOG_DIR)
set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-https://buywhere.ai}"
FRONTEND_HEALTH_PATH="${FRONTEND_HEALTH_PATH:-/health-check}"
LOG_FILE="${LOG_FILE:-${LOG_DIR:-/var/log/buywhere}/frontend-ui-health.ndjson}"
TARGET_URL="${FRONTEND_URL%/}${FRONTEND_HEALTH_PATH}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TMP_FILE="$(mktemp)"

mkdir -p "$(dirname "$LOG_FILE")"
trap 'rm -f "$TMP_FILE"' EXIT

START_NS=$(date +%s%N)
HTTP_CODE=$(curl -s -o "$TMP_FILE" -w "%{http_code}|%{content_type}|%{size_download}|%{url_effective}" --max-time 12 "$TARGET_URL" 2>/dev/null || echo "000||0|")
END_NS=$(date +%s%N)
LATENCY_MS=$(( (END_NS - START_NS) / 1000000 ))

HTTP_RAW=$(printf "%s" "$HTTP_CODE")
HTTP_STATUS=$(printf "%s" "$HTTP_RAW" | awk -F'|' '{print $1}')
CONTENT_TYPE=$(printf "%s" "$HTTP_RAW" | awk -F'|' '{print $2}')
BODY_SIZE=$(printf "%s" "$HTTP_RAW" | awk -F'|' '{print $3}')
FINAL_URL=$(printf "%s" "$HTTP_RAW" | awk -F'|' '{print $4}')

if [ "$HTTP_STATUS" = "200" ]; then
  if grep -q "<title" "$TMP_FILE" 2>/dev/null && grep -q "BuyWhere" "$TMP_FILE" 2>/dev/null; then
    RESULT="up"
  else
    RESULT="degraded"
  fi
else
  RESULT="down"
fi

echo "{\"ts\":\"$TS\",\"result\":\"$RESULT\",\"http_code\":$HTTP_STATUS,\"latency_ms\":$LATENCY_MS,\"content_type\":\"${CONTENT_TYPE}\",\"body_size\":$BODY_SIZE,\"target_url\":\"$TARGET_URL\",\"final_url\":\"$FINAL_URL\"}" >> "$LOG_FILE"

# Keep only 90 days at 5-minute frequency (25,920 entries)
tail -n 25920 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"

echo "[$TS] frontend-ui-health result=$RESULT http=$HTTP_STATUS latency=${LATENCY_MS}ms size=${BODY_SIZE} target=$TARGET_URL"
