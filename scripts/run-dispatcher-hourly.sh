#!/usr/bin/env bash
# BUY-69678: Hourly throughput dispatcher wrapper
# Runs dispatcher_v6_hourly.js, files child issue on BUY-29861 when throughput < 150K.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="/home/paperclip/buywhere"
LOG_DIR="$WORKSPACE/logs"
LOG_FILE="$LOG_DIR/dispatcher-hourly.log"
RESULT_FILE="$WORKSPACE/data/.last-dispatcher-result.json"
STATE_DIR="/tmp/buy-69678-dispatcher"
TMP_DIR="${PAPERCLIP_TMPDIR:-${TMPDIR:-/tmp}/buy-69678-dispatcher}"

mkdir -p "$LOG_DIR" "$STATE_DIR" "$TMP_DIR"

ts() { date -u +%Y-%m-%dT%H:%TZ; }
log() { echo "[$(ts)] $*" | tee -a "$LOG_FILE"; }
log_err() { echo "[$(ts)] ERROR: $*" | tee -a "$LOG_FILE" >&2; }

# Load Paperclip credentials
if [[ -f /home/paperclip/.paperclip_env ]]; then
  . /home/paperclip/.paperclip_env 2>/dev/null || true
fi

PAPERCLIP_API_KEY="${PAPERCLIP_API_KEY:-}"
PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-https://paperclip.richteo.com}"
PAPERCLIP_COMPANY_ID="${PAPERCLIP_COMPANY_ID:-177bc805-e3c8-4336-84cb-8e1e482d5a17}"

# Canonical DB URL from data/.catalog_db_url
CATALOG_DB_URL_FILE="$WORKSPACE/data/.catalog_db_url"
if [[ ! -f "$CATALOG_DB_URL_FILE" ]]; then
  log_err "MISSING: $CATALOG_DB_URL_FILE — cannot run dispatcher"
  exit 1
fi
CATALOG_DB_URL="$(cat "$CATALOG_DB_URL_FILE" | tr -d '[:space:]')"
if [[ -z "$CATALOG_DB_URL" ]]; then
  log_err "EMPTY: $CATALOG_DB_URL_FILE"
  exit 1
fi

# Run the dispatcher
log "Starting dispatcher_v6_hourly.js..."
DISPATCHER_STDOUT="$TMP_DIR/dispatcher-stdout.json"
DISPATCHER_STDERR="$TMP_DIR/dispatcher-stderr.log"
(cd "$WORKSPACE" && CANONICAL_DATABASE_URL="$CATALOG_DB_URL" \
  node scripts/dispatcher_v6_hourly.js --json 1>"$DISPATCHER_STDOUT" 2>"$DISPATCHER_STDERR") || {
  log_err "Dispatcher failed (exit $?)"
  exit 1
}
DISPATCHER_OUTPUT="$(cat "$DISPATCHER_STDOUT")"
[[ -s "$DISPATCHER_STDERR" ]] && log "Dispatcher stderr: $(head -5 "$DISPATCHER_STDERR")"

# Parse JSON result
VERDICT=$(echo "$DISPATCHER_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('decision', {}).get('verdict', 'UNKNOWN'))
except:
    print('PARSE_ERROR')
")

SHOULD_FILE=$(echo "$DISPATCHER_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(str(data.get('shouldFileFailureTicket', False)).lower())
except:
    print('true')
")

DELTA_INS=$(echo "$DISPATCHER_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    m = data.get('metrics', {})
    v = m.get('delta_ins_from_stats')
    print(v if v is not None else 'NULL')
except:
    print('NULL')
")

HOUR_LABEL=$(echo "$DISPATCHER_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    hs = data.get('metrics', {}).get('hour_start', '')
    print(hs[:13].replace('-','').replace(':','T') + 'Z' if hs else 'unknown')
except:
    print('unknown')
")

REPORT=$(echo "$DISPATCHER_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('report', ''))
except:
    print('')
")

log "Verdict: $VERDICT | delta_ins_from_stats: $DELTA_INS | hour: $HOUR_LABEL"

# Save result
echo "$DISPATCHER_OUTPUT" > "$RESULT_FILE" 2>/dev/null || true

# File child issue on BUY-29861 when throughput < 150K
if [[ "$SHOULD_FILE" == "true" && "$VERDICT" == "FAIL" ]]; then
  DEDUP_FILE="$STATE_DIR/last-filed-$HOUR_LABEL"
  if [[ -f "$DEDUP_FILE" ]]; then
    AGE_M=$(( ($(date +%s) - $(stat -c %Y "$DEDUP_FILE" 2>/dev/null || echo 0)) / 60 ))
    if [[ "$AGE_M" -lt 30 ]]; then
      log "SKIP: Already filed failure for $HOUR_LABEL (${AGE_M}m ago)"
      exit 0
    fi
  fi

  log "Filing failure child issue on BUY-29861 for hour $HOUR_LABEL..."

  ISSUE_BODY="# HOURLY THROUGHPUT FAILURE — $HOUR_LABEL

**Verdict:** $VERDICT
**delta_ins_from_stats:** $DELTA_INS
**Target:** 150,000 inserts/hour

## Report

$REPORT

---
*Filed automatically by dispatcher_v6_hourly cron (BUY-69678)*"

  if [[ -n "$PAPERCLIP_API_KEY" ]]; then
    RESPONSE=$(curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
      -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
      -H "Content-Type: application/json" \
      --data-raw "$(jq -nc \
        --arg title "HOURLY THROUGHPUT FAILURE — $HOUR_LABEL" \
        --arg body "$ISSUE_BODY" \
        --arg parent "BUY-29861" \
        --arg priority "critical" \
        '{title:$title, description:$body, priority:$priority, status:"todo", parentIdentifier:$parent}')" \
      2>/dev/null || echo '{"error":"curl failed"}')

    NEW_ISSUE_ID=$(echo "$RESPONSE" | jq -r '.identifier // .id // empty' 2>/dev/null)
    if [[ -n "$NEW_ISSUE_ID" ]]; then
      log "Filed child issue: $NEW_ISSUE_ID"
      touch "$DEDUP_FILE"
    else
      log_err "Failed to file child issue: $RESPONSE"
    fi
  else
    log_err "PAPERCLIP_API_KEY not set — cannot file child issue"
  fi
else
  log "PASS — no failure issue needed"
fi

# Trim log
[[ -f "$LOG_FILE" ]] && tail -500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
log "Done."
