#!/usr/bin/env bash
set -euo pipefail

LOGDIR="${1:-/tmp/mcp-uptime-24h}"
LOGFILE="$LOGDIR/uptime.log"
SUMMARYFILE="$LOGDIR/summary.json"
INTERVAL_SECONDS=300
WINDOW_HOURS=24

PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-https://paperclip.richteo.com}"
PAPERCLIP_API_KEY="${PAPERCLIP_API_KEY:-}"
ISSUE_ID="BUY-13511"
PARENT_ISSUE_ID="BUY-11816"

mkdir -p "$LOGDIR"

write_summary() {
  local total="$1" passed="$2" failed="$3" start_ts="$4"
  local pct="0"
  if [ "$total" -gt 0 ]; then
    pct=$(echo "scale=4; $passed * 100 / $total" | bc -l 2>/dev/null || echo "0")
  fi
  cat > "$SUMMARYFILE" <<JSON
{
  "totalChecks": $total,
  "passed": $passed,
  "failed": $failed,
  "uptimePct": $pct,
  "startTimestamp": "$start_ts",
  "lastUpdated": "$(date -u -Iseconds)",
  "windowHours": $WINDOW_HOURS,
  "intervalSeconds": $INTERVAL_SECONDS
}
JSON
}

log_result() {
  local ts="$1" url="$2" http_code="$3" duration_s="$4" error="$5"
  local line="$ts | $url | HTTP $http_code | ${duration_s}s | ${error:-ok}"
  echo "$line" >> "$LOGFILE"
  echo "$line"
}

post_completion_comment() {
  local total="$1" passed="$2" failed="$3" pct="$4" log_path="$5" summary_path="$6"
  local comment_body="## 24h Uptime Monitoring Complete

Monitoring window closed at $(date -u -Iseconds).

| Metric | Value |
|--------|-------|
| Total Checks | $total |
| Passed | $passed |
| Failed | $failed |
| Uptime | ${pct}% |
| Window | ${WINDOW_HOURS}h |
| Interval | ${INTERVAL_SECONDS}s |

Log: \`$log_path\`
Summary: \`$summary_path\`

**Recommendation:** Review the data above. If uptime >= 99.9% with no incident windows, recommend closing [BUY-11816](/BUY/issues/BUY-11816)."

  if [ -n "$PAPERCLIP_API_KEY" ]; then
    curl -s -X POST "$PAPERCLIP_API_URL/api/issues/$ISSUE_ID/comments" \
      -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg body "$comment_body" '{body: $body}')" > /dev/null 2>&1 || true

    # Also post to parent
    curl -s -X POST "$PAPERCLIP_API_URL/api/issues/$PARENT_ISSUE_ID/comments" \
      -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg body "$comment_body" '{body: $body}')" > /dev/null 2>&1 || true
  fi
}

cleanup() {
  echo "--- MONITORING STOPPED at $(date -u -Iseconds) ---" >> "$LOGFILE"
  write_summary "$total" "$passed" "$failed" "$start_ts_iso"
  exit 0
}

trap cleanup SIGTERM SIGINT

START_TS=$(date +%s)
start_ts_iso=$(date -u -Iseconds -d "@$START_TS")
END_TS=$((START_TS + WINDOW_HOURS * 3600))
total=0
passed=0
failed=0

echo "=== MONITORING STARTED at $start_ts_iso ===" >> "$LOGFILE"
echo "Window: $WINDOW_HOURS hours, Interval: ${INTERVAL_SECONDS}s" >> "$LOGFILE"
echo "Target: https://api.buywhere.ai/mcp" >> "$LOGFILE"
echo "---" >> "$LOGFILE"

URLS=("https://api.buywhere.ai/mcp" "https://api.buywhere.ai/")

while true; do
  NOW=$(date +%s)
  if [ "$NOW" -ge "$END_TS" ]; then
    echo "--- 24h WINDOW COMPLETE at $(date -u -Iseconds) ---" >> "$LOGFILE"
    write_summary "$total" "$passed" "$failed" "$start_ts_iso"
    local pct=$(echo "scale=2; if ($total > 0) $passed * 100 / $total else 0" | bc -l 2>/dev/null || echo "0")
    post_completion_comment "$total" "$passed" "$failed" "$pct" "$LOGFILE" "$SUMMARYFILE"
    exit 0
  fi

  TS=$(date -u -Iseconds)

  for URL in "${URLS[@]}"; do
    ERR=""
    HTTP_CODE="000"
    DURATION_S=""
    START_CURL=$(date +%s%N)

    set +e
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null)
    CURL_EXIT=$?
    END_CURL=$(date +%s%N)
    set -e

    DURATION_MS=$(( (END_CURL - START_CURL) / 1000000 ))
    DURATION_S=$(echo "scale=3; $DURATION_MS / 1000" | bc -l 2>/dev/null || echo "$DURATION_MS")

    total=$((total + 1))

    if [ $CURL_EXIT -ne 0 ]; then
      ERR="curl_exit_$CURL_EXIT"
      HTTP_CODE="000"
      failed=$((failed + 1))
    elif [ "$HTTP_CODE" = "200" ]; then
      passed=$((passed + 1))
    else
      ERR="http_$HTTP_CODE"
      failed=$((failed + 1))
    fi

    log_result "$TS" "$URL" "$HTTP_CODE" "$DURATION_S" "$ERR"
  done

  write_summary "$total" "$passed" "$failed" "$start_ts_iso"
  sleep "$INTERVAL_SECONDS"
done
