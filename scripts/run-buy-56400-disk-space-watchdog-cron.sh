#!/usr/bin/env bash
# run-buy-56400-disk-space-watchdog-cron.sh — BUY-56400 (child of BUY-48198)
# Disk-space watchdog for the root filesystem. Monitors free space on /.
# Warns at <20GB. Creates a critical Paperclip incident at <5GB.
# Runs every 5 minutes via cron. Uses the canonical disk_space_watchdog.py.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/buy-56400-disk-space-watchdog.log"
mkdir -p "$REPO_ROOT/logs"

# Source Paperclip credentials (if not already in environment)
# shellcheck source=/dev/null
if [[ -f /home/paperclip/.paperclip_env ]]; then
    . /home/paperclip/.paperclip_env
fi

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

log() {
    echo "[$TS] $1" >> "$LOG_FILE"
}

# Run the canonical watchdog script
PYTHON_SCRIPT="$REPO_ROOT/disk_space_watchdog.py"
if [[ ! -f "$PYTHON_SCRIPT" ]]; then
    log "ERROR: $PYTHON_SCRIPT not found"
    exit 3
fi

log "Starting disk-space watchdog check (BUY-56400/BUY-48198)..."
python3 "$PYTHON_SCRIPT" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

log "Watchdog exited with code $EXIT_CODE"
exit $EXIT_CODE
