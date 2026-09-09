#!/usr/bin/env bash
# carousell-sg-disk-cleanup.sh — BUY-56110 / BUY-48198
# Cleans up old Carousell SG product data files to prevent disk space exhaustion.
# Removes product JSONL files older than 2 days from /home/paperclip/buywhere-api/data/carousell-sg
# Runs every 5 minutes via cron (idempotent: safe to re-run).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/carousell-sg-disk-cleanup.log"
mkdir -p "$REPO_ROOT/logs"

DATA_DIR="/home/paperclip/buywhere-api/data/carousell-sg"
RETENTION_DAYS=2
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

log() {
    echo "[$TS] $1" >> "$LOG_FILE"
}

if [[ ! -d "$DATA_DIR" ]]; then
    log "SKIP: Data directory $DATA_DIR does not exist"
    exit 0
fi

# Get disk usage before
disk_before_pct=$(df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}')
disk_before_gb=$(df -Pk / | awk 'NR==2 {printf "%.1f", $4/1024/1024}')

# Find and delete product JSONL files older than retention period
DELETED_COUNT=0
DELETED_BYTES=0

while IFS= read -r file; do
    if [[ -f "$file" ]]; then
        fsize=$(stat -c %s "$file" 2>/dev/null || echo 0)
        rm -f "$file"
        DELETED_COUNT=$((DELETED_COUNT + 1))
        DELETED_BYTES=$((DELETED_BYTES + fsize))
        log "Deleted: $file (${fsize} bytes)"
    fi
done < <(find "$DATA_DIR" -maxdepth 1 -name "products_*.jsonl" -type f -mtime +$RETENTION_DAYS)

# Get disk usage after
disk_after_pct=$(df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}')
disk_after_gb=$(df -Pk / | awk 'NR==2 {printf "%.1f", $4/1024/1024}')

DELETED_MB=$(echo "scale=1; $DELETED_BYTES / 1024 / 1024" | bc 2>/dev/null || echo "N/A")

log "Cleanup complete: deleted $DELETED_COUNT files (~${DELETED_MB}MB), disk before=${disk_before_pct}% (${disk_before_gb}GB free), after=${disk_after_pct}% (${disk_after_gb}GB free)"

if [[ "$DELETED_COUNT" -gt 0 ]]; then
    echo "[$TS] Deleted $DELETED_COUNT old carousell-sg files (~${DELETED_MB}MB). Disk: ${disk_before_gb}GB → ${disk_after_gb}GB free" >> "$REPO_ROOT/logs/buy-56044-disk-space-watchdog.log" 2>/dev/null || true
fi

exit 0
