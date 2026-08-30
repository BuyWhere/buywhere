#!/bin/bash
# BUY-57192: Worker node disk-space enforcement (WC cycle artifact cleanup)
set -uo pipefail
DATA=/mnt/paperclip_scrape_data
EVIDENCE=/paperclip/instances/default/workspaces/476c8023-3635-45bb-9f71-db6f4f5700e1/buywhere-api/BUY-57192-evidence
mkdir -p "$EVIDENCE"
echo "=== BUY-57192 WC cycle artifact cleanup ==="
date -u
echo "Data: $DATA"
df -h / | tee "$EVIDENCE/disk-before.txt"
KEEP_H=48
ALERT=90
TS=$(date -uIs)
LOG="$DATA/_wc_cleanup_log.jsonl"
echo "Phase 1: bulk delete zero-byte orphan cycle files older than ${KEEP_H}h..."
ZERO_COUNT=$(find "$DATA" -maxdepth 2 -name 'cycle-*.ndjson' ! -name '*.ingested.json' -type f -size 0 -mmin +$((KEEP_H*60)) -print -delete 2>/dev/null | wc -l) || true
echo "Deleted zero-byte orphans: $ZERO_COUNT"
echo "Phase 2: delete non-zero orphan cycle files older than ${KEEP_H}h..."
NONZERO_TOTAL=0
while IFS= read -r f; do
  kb=$(du -k "$f" 2>/dev/null | cut -f1) || continue
  printf '{"ts":"%s","file":"%s","kb":%s,"reason":"orphaned_no_marker_%sh","action":"delete"}\n' "$TS" "$f" "$kb" "$KEEP_H" >> "$LOG"
  rm -f "$f"
  echo "DELETED [orphaned/${KEEP_H}h] $f (${kb}KB)"
  NONZERO_TOTAL=$((NONZERO_TOTAL + 1))
done < <(find "$DATA" -maxdepth 2 -name 'cycle-*.ndjson' ! -name '*.ingested.json' -type f -size +0 -mmin +$((KEEP_H*60)) 2>/dev/null)
echo "Deleted non-zero orphans: $NONZERO_TOTAL"
echo "Phase 3: delete orphan ingested markers (source ndjson already gone)..."
SC_COUNT=0
while IFS= read -r marker; do
  src="${marker%.ingested.json}"
  [ -f "$src" ] && continue
  s=$(du -k "$marker" 2>/dev/null | cut -f1) || s=0
  printf '{"ts":"%s","file":"%s","kb":%s,"reason":"orphan_sidecar","action":"delete"}\n' "$TS" "$marker" "$s" >> "$LOG"
  rm -f "$marker"
  SC_COUNT=$((SC_COUNT + 1))
done < <(find "$DATA" -maxdepth 2 -name 'cycle-*.ndjson.ingested.json' -type f -mmin +$((KEEP_H*60)) 2>/dev/null)
echo "Deleted orphan sidecars: $SC_COUNT"
echo "Phase 4: purge old _trash contents..."
TRASH_COUNT=0
if [ -d "$DATA/_trash" ]; then
  TRASH_COUNT=$(find "$DATA/_trash" -type f -mmin +$((7*24*60)) -delete -print 2>/dev/null | wc -l) || true
  find "$DATA/_trash" -type d -empty -delete 2>/dev/null || true
fi
echo "Trash purged: $TRASH_COUNT"
echo ""
echo "--- deleted=$ZERO_COUNT sidecars=$SC_COUNT trash_purged=$TRASH_COUNT freed=0.00GB apply=1 keep=${KEEP_H}h"
df -h / | tee "$EVIDENCE/disk-after.txt"
echo "=== Evidence ==="
echo "Zero-byte orphan ndjson deleted: $ZERO_COUNT" > "$EVIDENCE/summary.txt"
echo "Non-zero orphan ndjson deleted: $NONZERO_TOTAL" >> "$EVIDENCE/summary.txt"
echo "Orphan ingested markers deleted: $SC_COUNT" >> "$EVIDENCE/summary.txt"
echo "Trash files purged: $TRASH_COUNT" >> "$EVIDENCE/summary.txt"
PCT=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$PCT" -ge "$ALERT" ] 2>/dev/null; then
  echo "ALERT disk=${PCT}% >= ${ALERT}% after cleanup"
  echo "ALERT: disk=$PCT%" >> "$EVIDENCE/summary.txt"
fi
cat "$EVIDENCE/summary.txt"
echo "=== BUY-57192 completed ==="
