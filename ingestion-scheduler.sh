#!/bin/bash

# Ingestion Pipeline Scheduler Script
# For BUY-18144 - Recurring ingestion pipeline health check
# This script implements basic scheduling for ingestion pipeline

set -e

# Configuration
INGEST_SCRIPT="/home/paperclip/buywhere-api/bulk_ingest.py"
LOG_FILE="/home/paperclip/buywhere-api/ingestion-scheduler.log"
PID_FILE="/home/paperclip/buywhere-api/ingestion-scheduler.pid"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if script is already running
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        log "Ingestion scheduler already running with PID $PID"
        exit 0
    else
        log "Stale PID file found, removing"
        rm -f "$PID_FILE"
    fi
fi

# Write PID file
echo $$ > "$PID_FILE"

log "Starting ingestion pipeline scheduler"

# Main execution loop
while true; do
    log "Running ingestion pipeline..."
    
    if [ -f "$INGEST_SCRIPT" ]; then
        if python3 "$INGEST_SCRIPT" >> "$LOG_FILE" 2>&1; then
            log "✓ Ingestion pipeline completed successfully"
        else
            log "✗ Ingestion pipeline failed with exit code $?"
            # Could add alerting here
        fi
    else
        log "✗ Ingestion script not found: $INGEST_SCRIPT"
    fi
    
    log "Waiting 6 hours before next run..."
    sleep 21600  # 6 hours
done