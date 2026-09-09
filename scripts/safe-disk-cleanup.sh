#!/bin/bash
# Safe disk cleanup for BUY-57661
# Removes safe-to-delete transient data

set -e
LOG_PREFIX="BUY-57661-disk-cleanup"
LOGFILE="logs/${LOG_PREFIX}.log"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOGFILE"; }

log "=== Starting safe disk cleanup ==="

# 1. Trim carousell-sg summary files - keep only latest 10
SUMMARY_DIR="data/carousell-sg"
SUMMARY_COUNT=$(find "$SUMMARY_DIR" -maxdepth 1 -name "summary_*.json" -type f | wc -l)
log "Found $SUMMARY_COUNT carousell-sg summary files"

if [ "$SUMMARY_COUNT" -gt 10 ]; then
  REMOVE_COUNT=$((SUMMARY_COUNT - 10))
  find "$SUMMARY_DIR" -maxdepth 1 -name "summary_*.json" -type f -printf '%T@ %p\n' | \
    sort -n | head -n "$REMOVE_COUNT" | cut -d' ' -f2- | while read -r f; do
    rm -v "$f"
  done
  log "Removed $REMOVE_COUNT old summary files"
else
  log "Summary files ($SUMMARY_COUNT) within limit of 10, skipping"
fi

# 2. Remove empty carousell scheduler logs from same-minute duplicates
SCHEDULER_LOGS="logs/carousell_sg_scheduler_*.log"
EMPTY_COUNT=0
for logfile in $SCHEDULER_LOGS; do
  if [ -f "$logfile" ] && [ ! -s "$logfile" ]; then
    rm -v "$logfile"
    EMPTY_COUNT=$((EMPTY_COUNT + 1))
  fi
done
log "Removed $EMPTY_COUNT empty scheduler logs"

# 3. Keep only last 20 carousell scheduler logs (they rotate every ~5 min)
SCHEDULER_COUNT=$(find logs -maxdepth 1 -name "carousell_sg_scheduler_*.log" | wc -l)
if [ "$SCHEDULER_COUNT" -gt 20 ]; then
  REMOVE_COUNT=$((SCHEDULER_COUNT - 20))
  find logs -maxdepth 1 -name "carousell_sg_scheduler_*.log" -type f -printf '%T@ %p\n' | \
    sort -n | head -n "$REMOVE_COUNT" | cut -d' ' -f2- | while read -r f; do
    rm -v "$f"
  done
  log "Removed $REMOVE_COUNT old scheduler logs (kept 20)"
fi

# 4. Clean up stale BUY-* evidence dirs older than 14 days
for dir in BUY-*-evidence; do
  if [ -d "$dir" ]; then
    AGE_DAYS=$(find "$dir" -maxdepth 0 -mtime +14 -printf '%T@\n' 2>/dev/null | head -1)
    if [ -n "$AGE_DAYS" ]; then
      log "Removing stale evidence: $dir (>14 days old)"
      rm -rf "$dir"
    fi
  fi
done

# 5. Check disk usage summary
log "=== Disk usage after cleanup ==="
du -sh logs/ data/ api/node_modules/ 2>/dev/null | tee -a "$LOGFILE"

log "=== Cleanup complete ==="
