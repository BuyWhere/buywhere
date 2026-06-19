#!/bin/bash
# Persistent wrapper daemon for Carousell SG scraper.
# 
# Launched by monitor_carousell_sg.sh via nohup. This script stays alive
# keeping the scraper as a child process. Since the wrapper's PID is NOT 1,
# the scraper's PPID won't be 1 either -> the orphan reaper (which kills
# PPID=1 paperclip processes) won't touch it.
#
# During the 4-hour sleep between cycles, both the wrapper and the scraper
# are idle but alive. The wrapper's small memory footprint (~1MB RSS) keeps
# it well below the orphan reaper's 10MB threshold.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REAL_DATA_DIR="/home/paperclip/buywhere-api/data/carousell-sg"
PID_FILE="${WORKDIR}/data/carousell-sg/scraper.pid"
LOG_FILE="${REAL_DATA_DIR}/scraper.log"
WRAPPER_PID_FILE="${REAL_DATA_DIR}/wrapper.pid"

# Resolve API key
if [[ -z "${BUYWHERE_API_KEY:-}" ]] && [[ -f "${WORKDIR}/.env" ]]; then
  BUYWHERE_API_KEY="$(grep -E '^BUYWHERE_API_KEY=' "${WORKDIR}/.env" | head -1 | cut -d'=' -f2-)"
fi
export PRODUCT_API_KEY="${BUYWHERE_API_KEY:-}"

SCRAPER_CMD=(python3 -m scrapers.carousell_sg --scrape-only --continuous --refresh-interval 14400)

log() {
    echo "[$(date '+%Y-%m-%dT%H:%M:%S')] [wrapper] $1" >> "$LOG_FILE"
}

# Write wrapper PID so monitor can find us
echo "$$" > "$WRAPPER_PID_FILE"

log "Wrapper started (PID $$)"

# Launch the scraper
cd "$WORKDIR"
nohup "${SCRAPER_CMD[@]}" >> "$LOG_FILE" 2>&1 &
SCRAPER_PID=$!
echo "$SCRAPER_PID" > "$PID_FILE"
log "Launched scraper with PID $SCRAPER_PID"

# Wait for the scraper to exit. This blocks until the scraper dies.
# During the 4h sleep, both processes are idle but the wrapper's RSS stays <10MB.
wait "$SCRAPER_PID"
EXIT_CODE=$?
log "Scraper exited with code $EXIT_CODE"

# Clean up
rm -f "$WRAPPER_PID_FILE"
rm -f "$PID_FILE"
exit "$EXIT_CODE"
