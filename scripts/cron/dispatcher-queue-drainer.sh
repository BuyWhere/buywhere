#!/usr/bin/env bash
# dispatcher-queue-drainer.sh — BUY-72592
# Hourly drain of dispatcher FAIL findings queued by run-dispatcher-hourly.sh.
# Reads /home/paperclip/buywhere/data/.dispatcher-pending.jsonl and files
# each entry as a child issue of BUY-29861 via the Paperclip API. Skips
# entries the dispatcher already filed directly, and respects the same
# /tmp/buy-69678-dispatcher/last-filed-$HOUR dedup the dispatcher uses.
#
# Auth model: this script does NOT carry a long-lived token. It is invoked
# hourly from a user-cron entry that sources PAPERCLIP_API_KEY from
# /home/paperclip/.paperclip_env at run-time. If no key is present at
# invocation time, the queue entries are left in place for the next run
# (or the privileged buywhere-board-groomer pickup path). See BUY-72592.
#
# Run cadence: hourly (e.g. 0 * * * * paperclip ...).
set -euo pipefail

WORKSPACE="/home/paperclip/buywhere"
QUEUE_FILE="$WORKSPACE/data/.dispatcher-pending.jsonl"
STATE_DIR="/tmp/buy-69678-dispatcher"
LOG_FILE="$WORKSPACE/logs/dispatcher-queue-drainer.log"
PARENT_IDENT="BUY-29861"
PARENT_UUID_CACHE="$STATE_DIR/.parent-uuid-$PARENT_IDENT"

mkdir -p "$(dirname "$LOG_FILE")" "$STATE_DIR" 2>/dev/null || true

ts() { date -u +%Y-%m-%dT%H:%MZ; }
log() { echo "[$(ts)] $*" >> "$LOG_FILE"; }

# Source Paperclip credentials (if present)
if [[ -f /home/paperclip/.paperclip_env ]]; then
  set +u
  # shellcheck source=/dev/null
  . /home/paperclip/.paperclip_env
  set -u
fi

PAPERCLIP_API_KEY="${PAPERCLIP_API_KEY:-}"
PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-https://paperclip.richteo.com}"
PAPERCLIP_COMPANY_ID="${PAPERCLIP_COMPANY_ID:-177bc805-e3c8-4336-84cb-8e1e482d5a17}"

if [[ -z "$PAPERCLIP_API_KEY" ]]; then
  log "SKIP: PAPERCLIP_API_KEY not available — leaving queue untouched"
  exit 0
fi

if [[ ! -s "$QUEUE_FILE" ]]; then
  log "Queue empty"
  exit 0
fi

# Resolve parent UUID (cached for an hour to avoid an API call per filing)
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
  PARENT_UUID=$(printf '%s' "$PARENT_LOOKUP" | jq -r '.id // empty' 2>/dev/null || true)
  if [[ -n "$PARENT_UUID" ]]; then
    printf '%s' "$PARENT_UUID" > "$PARENT_UUID_CACHE"
  else
    # Fall back to no-parent filing (matches the dispatcher wrapper's
    # historical behaviour and the existing manual BUY-72591 shape).
    log "WARN: unable to resolve parent UUID for $PARENT_IDENT — filing without parent link"
  fi
fi

# Materialize queue into a working file so we can prune atomically
WORK_FILE="$(mktemp -p "${PAPERCLIP_TMPDIR:-/tmp}" -t dispatcher-queue.XXXXXX)"
trap 'rm -f "$WORK_FILE"' EXIT

FILED=0
SKIPPED=0
LEFT=0

# Read each line, attempt to file, then write remaining entries to WORK_FILE.
# We use `while read` on a redirected fd to avoid subshell surprises.
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  HOUR="$(echo "$line" | jq -r '.hour // empty' 2>/dev/null || true)"
  BODY="$(echo "$line" | jq -r '.body // empty' 2>/dev/null || true)"
  DEDUP_FILE="$(echo "$line" | jq -r '.dedup_file // empty' 2>/dev/null || true)"

  if [[ -z "$HOUR" || -z "$BODY" ]]; then
    log "DROP malformed queue entry: $line"
    continue
  fi

  # Honor the dispatcher's dedup — if dispatcher already filed directly, drop this entry.
  if [[ -f "$STATE_DIR/last-filed-$HOUR" ]]; then
    log "DROP hour=$HOUR (already filed by dispatcher)"
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  log "Filing hour=$HOUR as child of $PARENT_IDENT"
  if [[ -n "$PARENT_UUID" ]]; then
    PAYLOAD=$(jq -nc \
      --arg title "HOURLY THROUGHPUT FAILURE - $HOUR" \
      --arg body "$BODY" \
      --arg parent "$PARENT_UUID" \
      --arg priority "critical" \
      '{title:$title, description:$body, priority:$priority, status:"todo", parentId:$parent}')
  else
    PAYLOAD=$(jq -nc \
      --arg title "HOURLY THROUGHPUT FAILURE - $HOUR" \
      --arg body "$BODY" \
      --arg priority "critical" \
      '{title:$title, description:$body, priority:$priority, status:"todo"}')
  fi
  RESPONSE=$(curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
    -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
    -H "Content-Type: application/json" \
    --data-raw "$PAYLOAD" 2>/dev/null || echo '{"error":"curl failed"}')

  NEW_ISSUE_ID=$(echo "$RESPONSE" | jq -r '.identifier // .id // empty' 2>/dev/null || true)
  if [[ -n "$NEW_ISSUE_ID" ]]; then
    log "Filed hour=$HOUR child=$NEW_ISSUE_ID"
    touch "$STATE_DIR/last-filed-$HOUR"
    FILED=$((FILED+1))
    # Successfully filed — drop from queue.
    continue
  fi

  # Filing failed — keep this entry in the queue for the next run.
  log "Filing failed for hour=$HOUR response=$RESPONSE — keeping in queue"
  printf '%s\n' "$line" >> "$WORK_FILE"
  LEFT=$((LEFT+1))
done < "$QUEUE_FILE"

# Whatever is in WORK_FILE is the new queue (only entries that failed to file).
# If WORK_FILE is empty (every entry was filed successfully), the queue is now empty.
if [[ -s "$WORK_FILE" ]]; then
  mv "$WORK_FILE" "$QUEUE_FILE.new"
  # Run the 24h prune step on the new queue.
  CUTOFF_ISO=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%MZ 2>/dev/null || date -u +%Y-%m-%dT%H:%MZ)
  PRUNED=0
  KEPT=0
  PRUNE_FILE="$(mktemp -p "${PAPERCLIP_TMPDIR:-/tmp}" -t dispatcher-prune.XXXXXX)"
  while IFS= read -r qline; do
    [[ -z "$qline" ]] && continue
    QTS=$(printf '%s' "$qline" | jq -r '.cron_ts // empty' 2>/dev/null || true)
    if [[ -n "$QTS" && "$QTS" < "$CUTOFF_ISO" ]]; then
      log "PRUNE stale queue entry hour=$(printf '%s' "$qline" | jq -r '.hour // "?"' 2>/dev/null) cron_ts=$QTS"
      PRUNED=$((PRUNED+1))
      continue
    fi
    printf '%s\n' "$qline"
    KEPT=$((KEPT+1))
  done < "$QUEUE_FILE.new" > "$PRUNE_FILE"
  mv "$PRUNE_FILE" "$QUEUE_FILE"
  rm -f "$QUEUE_FILE.new"
  log "Queue retained=$KEPT pruned=$PRUNED"
else
  : > "$QUEUE_FILE"
fi

log "Done — filed=$FILED skipped=$SKIPPED kept=$LEFT"
