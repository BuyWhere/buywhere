#!/usr/bin/env bash
# Patch to apply to /usr/local/sbin/buywhere-board-groomer.sh — BUY-72592
#
# Adds: read /home/paperclip/buywhere/data/.dispatcher-pending.jsonl each
#       hour, file each entry as a child of BUY-29861 via paperclipai issue
#       create using the existing root BOARD token, then prune stale entries.
#
# Insertion point: AFTER the existing two `for id in $(...)` loops, before
# the zombie-killer block (which is line 23 in current file). Specifically,
# right after the closing `done` of the throughput-failures loop.
#
# ALSO: bump the existing 2-hour stale cancel guard to NOT cancel tickets
# younger than 4 hours (we want the dispatcher-queue pickup to have a
# fighting chance before being auto-cancelled). Change line 19:
#   `created_at < now()-interval '4 hours'`
# And drop the `offset 1` supersede loop entirely (the new filed tickets
# will arrive via the queue and may legitimately be the newest).
#
# Apply: review the diff below, then as root:
#   cp /usr/local/sbin/buywhere-board-groomer.sh{,.bak.$(date +%s)}
#   patch -p0 /usr/local/sbin/buywhere-board-groomer.sh < board-groomer-queue-patch.sh
#   bash -n /usr/local/sbin/buywhere-board-groomer.sh
#   systemctl is-active paperclip && echo ok

# === replacement block for line 19 (supersede loop) ===
# OLD:
# for id in $(psql "$DB" -At -c "select id from issues where company_id='$BW' and status in ('todo','backlog','blocked') and title like 'HOURLY THROUGHPUT FAILURE%' order by created_at desc offset 1;" 2>/dev/null); do
#   paperclipai issue update "$id" --status cancelled --comment "Auto-groomer: superseded throughput alert (newer alert exists)." --api-base "$API" --api-key "$BOARD" --json >/dev/null 2>&1 && m=$((m+1))
# done
# NEW (drops supersede cancel; respects that the dispatcher creates one ticket
# per failed hour and the queue mechanism may produce them out-of-order):
# (no replacement — the loop is deleted)

# === NEW BLOCK to insert after the supersede loop (currently line 21) ===
q=0
QUEUE_FILE=/home/paperclip/buywhere/data/.dispatcher-pending.jsonl
DEDUP_DIR=/tmp/buy-69678-dispatcher
if [[ -s "$QUEUE_FILE" ]]; then
  while IFS= read -r qline || [[ -n "$qline" ]]; do
    [[ -z "$qline" ]] && continue
    QHOUR=$(printf '%s' "$qline" | jq -r '.hour // empty' 2>/dev/null || true)
    QBODY=$(printf '%s' "$qline" | jq -r '.body // empty' 2>/dev/null || true)
    QTS=$(printf '%s' "$qline" | jq -r '.cron_ts // empty' 2>/dev/null || true)
    [[ -z "$QHOUR" || -z "$QBODY" ]] && continue
    # Skip if dispatcher already filed directly via its own dedup file.
    [[ -f "$DEDUP_DIR/last-filed-$QHOUR" ]] && continue
    # Skip if a ticket for this hour already exists under BUY-29861 (idempotency).
    existing=$(psql "$DB" -At -c "select id from issues where company_id='$BW' and status != 'cancelled' and title = 'HOURLY THROUGHPUT FAILURE - $QHOUR' limit 1;" 2>/dev/null)
    if [[ -n "$existing" ]]; then
      touch "$DEDUP_DIR/last-filed-$QHOUR"
      continue
    fi
    QPAYLOAD=$(jq -nc --arg t "HOURLY THROUGHPUT FAILURE - $QHOUR" --arg b "$QBODY" '{title:$t,description:$b,priority:"critical",status:"todo",parentIdentifier:"BUY-29861"}')
    QRESP=$(curl -sS -X POST "$API/api/companies/$BW/issues" \
      -H "Authorization: Bearer $BOARD" \
      -H "Content-Type: application/json" \
      --data-raw "$QPAYLOAD" 2>/dev/null || echo '{"error":"curl failed"}')
    QID=$(printf '%s' "$QRESP" | jq -r '.identifier // .id // empty' 2>/dev/null || true)
    if [[ -n "$QID" ]]; then
      touch "$DEDUP_DIR/last-filed-$QHOUR"
      q=$((q+1))
    fi
  done < "$QUEUE_FILE"
  # Prune stale (>24h) entries from the queue after attempted filings.
  if [[ -s "$QUEUE_FILE" ]]; then
    CUTOFF=$(date -u -d '24 hours ago' +%FT%TZ 2>/dev/null || date -u +%FT%TZ)
    QTMP=$(mktemp -t bgroomer-queue.XXXXXX)
    while IFS= read -r qline; do
      QTS2=$(printf '%s' "$qline" | jq -r '.cron_ts // ""' 2>/dev/null || true)
      if [[ -n "$QTS2" && "$QTS2" < "$CUTOFF" ]]; then continue; fi
      printf '%s\n' "$qline"
    done < "$QUEUE_FILE" > "$QTMP"
    cat "$QTMP" > "$QUEUE_FILE" 2>/dev/null && rm -f "$QTMP"
  fi
fi
# === END NEW BLOCK ===

# === Update the log line at the bottom (currently line 41 in older versions) ===
# OLD: [ $((n+m+z)) -gt 0 ] && echo "$(date -u +%FT%TZ) groomed dispatcher=$n throughput=$m zombies=$z" >> "$LOG"
# NEW: [ $((n+m+z+q)) -gt 0 ] && echo "$(date -u +%FT%TZ) groomed dispatcher=$n throughput=$m zombies=$z queue=$q" >> "$LOG"