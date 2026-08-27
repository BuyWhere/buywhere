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

mkdir -p "$LOG_DIR" "$STATE_DIR"

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
PARENT_IDENT="BUY-29861"
PARENT_UUID_CACHE="$STATE_DIR/.parent-uuid-$PARENT_IDENT"

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
PAPERCLIP_TMPDIR="${PAPERCLIP_TMPDIR:-/tmp}"
DISPATCHER_STDOUT="$PAPERCLIP_TMPDIR/dispatcher-stdout.log"
DISPATCHER_STDERR="$PAPERCLIP_TMPDIR/dispatcher-stderr.log"
(cd "$WORKSPACE" && CANONICAL_DATABASE_URL="$CATALOG_DB_URL" node scripts/dispatcher_v6_hourly.js --json 1>"$DISPATCHER_STDOUT" 2>"$DISPATCHER_STDERR") || {
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
#
# Filing paths (tried in order):
#   1) direct API: PAPERCLIP_API_KEY present in /home/paperclip/.paperclip_env
#      or in the cron environment.
#   2) queue pickup: append to $WORKSPACE/data/.dispatcher-pending.jsonl and
#      let the buywhere-board-groomer (root cron, hourly :41) file it via
#      the privileged /root/.console-provision/board.token. See BUY-72592.
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

  FILED=0

  # Resolve parent issue UUID (cached 1h to avoid an API call per filing).
  PARENT_UUID=""
  if [[ -s "$PARENT_UUID_CACHE" ]]; then
    CACHE_AGE=$(( $(date +%s) - $(stat -c %Y "$PARENT_UUID_CACHE" 2>/dev/null || echo 0) ))
    if [[ "$CACHE_AGE" -lt 3600 ]]; then
      PARENT_UUID="$(cat "$PARENT_UUID_CACHE" 2>/dev/null || true)"
    fi
  fi
  if [[ -z "$PARENT_UUID" ]]; then
    PARENT_LOOKUP=$(curl -sS -m 15 -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
      "$PAPERCLIP_API_URL/api/issues/$PARENT_IDENT" 2>/dev/null || true)
    PARENT_UUID=$(echo "$PARENT_LOOKUP" | jq -r '.id // empty' 2>/dev/null || true)
    if [[ -n "$PARENT_UUID" ]]; then
      printf '%s' "$PARENT_UUID" > "$PARENT_UUID_CACHE"
    fi
  fi

  # Path 1: direct API call when a key is available
  if [[ -n "$PAPERCLIP_API_KEY" ]]; then
    if [[ -n "$PARENT_UUID" ]]; then
      PAYLOAD=$(jq -nc \
        --arg title "HOURLY THROUGHPUT FAILURE — $HOUR_LABEL" \
        --arg body "$ISSUE_BODY" \
        --arg parent "$PARENT_UUID" \
        --arg priority "critical" \
        '{title:$title, description:$body, priority:$priority, status:"todo", parentId:$parent}')
    else
      PAYLOAD=$(jq -nc \
        --arg title "HOURLY THROUGHPUT FAILURE — $HOUR_LABEL" \
        --arg body "$ISSUE_BODY" \
        --arg priority "critical" \
        '{title:$title, description:$body, priority:$priority, status:"todo"}')
    fi
    RESPONSE=$(curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
      -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
      -H "Content-Type: application/json" \
      --data-raw "$PAYLOAD" \
      2>/dev/null || echo '{"error":"curl failed"}')

    NEW_ISSUE_ID=$(echo "$RESPONSE" | jq -r '.identifier // empty' 2>/dev/null)
    NEW_ISSUE_UUID=$(echo "$RESPONSE" | jq -r '.id // empty' 2>/dev/null)
    if [[ -n "$NEW_ISSUE_ID" ]]; then
      log "Filed child issue (direct): $NEW_ISSUE_ID"
      touch "$DEDUP_FILE"
      FILED=1
      # Backfill the canonical_throughput_hourly.failure_issue_id link so each
      # FAIL row is traceable to its ticket. Best-effort (non-fatal): if the
      # DB write is unavailable the ticket is still filed. BUY-69678.
      if [[ -n "$NEW_ISSUE_UUID" ]]; then
        HOUR_SQL=$(echo "$DISPATCHER_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    hs = data.get('metrics', {}).get('hour_start', '')
    print(hs)
except:
    print('')
")
        if [[ -n "$HOUR_SQL" ]]; then
          if psql "$CATALOG_DB_URL" -qtA -c "UPDATE canonical_throughput_hourly SET failure_issue_id = '$NEW_ISSUE_UUID' WHERE hour_start = '$HOUR_SQL'::timestamptz AND (failure_issue_id IS NULL OR failure_issue_id = '')" >/dev/null 2>&1; then
            log "Backfilled failure_issue_id=$NEW_ISSUE_UUID for $HOUR_SQL"
          else
            log_err "Backfill UPDATE failed for $HOUR_SQL (ticket $NEW_ISSUE_ID already filed)"
          fi
        fi
      fi
    else
      log_err "Direct-file path failed: $RESPONSE"
    fi
  else
    log "No PAPERCLIP_API_KEY in env — falling through to queue path"
  fi

  # Path 2: queue for board-groomer pickup. Always run when direct path
  # didn't succeed, so a hard outage of the filing path can't lose a ticket.
  if [[ "$FILED" -eq 0 ]]; then
    QUEUE_FILE="$WORKSPACE/data/.dispatcher-pending.jsonl"
    mkdir -p "$(dirname "$QUEUE_FILE")" 2>/dev/null || true
    QUEUE_RECORD=$(jq -nc \
      --arg hour "$HOUR_LABEL" \
      --arg verdict "$VERDICT" \
      --arg delta "$DELTA_INS" \
      --arg body "$ISSUE_BODY" \
      --arg report "$REPORT" \
      --arg cron_ts "$(ts)" \
      --arg dedup "$DEDUP_FILE" \
      '{hour:$hour, verdict:$verdict, delta_ins_from_stats:$delta, body:$body, report:$report, cron_ts:$cron_ts, dedup_file:$dedup}')
    if printf '%s\n' "$QUEUE_RECORD" >> "$QUEUE_FILE" 2>/dev/null; then
      log "Queue path: appended to $QUEUE_FILE (groomer will file within :41 of next hourly tick)"
    else
      log_err "Queue path FAILED — could not write to $QUEUE_FILE"
    fi
  fi
else
  log "PASS — no failure issue needed"
fi

# Trim log
[[ -f "$LOG_FILE" ]] && tail -500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
log "Done."
