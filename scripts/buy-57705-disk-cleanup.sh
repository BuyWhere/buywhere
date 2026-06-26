#!/usr/bin/env bash
# buy-57705-disk-cleanup.sh — Workspace safe-data-cleanup sweep
# Cleans up stale BUY-*-evidence directories and stale log files.
# Keeps evidence from the last 7 days as a safety buffer.
# Runs idempotently: safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/buy-57705-disk-cleanup.log"
mkdir -p "$REPO_ROOT/logs"

RETENTION_DAYS=7
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

log() {
    echo "[$TS] $1" >> "$LOG_FILE"
}

# Get disk usage before
disk_before_pct=$(df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}')
disk_before_gb=$(df -Pk / | awk 'NR==2 {printf "%.1f", $4/1024/1024}')
log "Disk before: ${disk_before_pct}% used (${disk_before_gb}GB free)"

DELETED_COUNT=0
DELETED_BYTES=0

# Find BUY-*-evidence directories older than retention period
while IFS= read -r dir; do
    if [[ -d "$dir" ]]; then
        dir_size=$(du -sb "$dir" 2>/dev/null | awk '{print $1}' || echo 0)
        
        # Double-check: only remove if it's an evidence directory
        if [[ "$dir" =~ BUY-[0-9]+-evidence$ ]]; then
            rm -rf "$dir"
            DELETED_COUNT=$((DELETED_COUNT + 1))
            DELETED_BYTES=$((DELETED_BYTES + dir_size))
            log "Deleted evidence: $dir (${dir_size} bytes)"
        fi
    fi
done < <(find "$REPO_ROOT" -maxdepth 1 -type d -name "BUY-*-evidence" -mtime +${RETENTION_DAYS} 2>/dev/null)

# Get disk usage after
disk_after_pct=$(df -Pk / | awk 'NR==2 {gsub("%","",$5); print $5}')
disk_after_gb=$(df -Pk / | awk 'NR==2 {printf "%.1f", $4/1024/1024}')

DELETED_MB=$(echo "scale=1; $DELETED_BYTES / 1024 / 1024" | bc 2>/dev/null || echo "N/A")
DELETED_GB=$(echo "scale=2; $DELETED_BYTES / 1024 / 1024 / 1024" | bc 2>/dev/null || echo "N/A")

log "Cleanup complete: deleted $DELETED_COUNT evidence dirs (~${DELETED_MB}MB / ~${DELETED_GB}GB), disk after=${disk_after_pct}% (${disk_after_gb}GB free)"

echo "[$TS] Evidence cleanup: deleted $DELETED_COUNT dirs (~${DELETED_MB}MB). Disk: ${disk_before_gb}GB -> ${disk_after_gb}GB free" >> "$REPO_ROOT/logs/buy-57705-disk-enforcement.log"

exit 0
