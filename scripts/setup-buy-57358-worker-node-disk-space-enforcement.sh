#!/usr/bin/env bash
# setup-buy-57358-worker-node-disk-space-enforcement.sh — BUY-57358 (idempotent)
#
# Installs cron entry for WC cycle artifact cleanup on Oracle scrape workspace (/mnt/scrape-data).
# Runs every 6 hours to clean up old cycle ndjson files (keep 48h).
# Uses shared marker "wc-cycle-cleanup-cron" for deduplication.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUNNER="$SCRIPT_DIR/run-buy-57358-worker-wc-cycle-cleanup.sh"
LOG_FILE="$REPO_ROOT/logs/buy-57358-wc-cycle-cleanup.log"
SETUP_LOG="$REPO_ROOT/logs/setup-buy-57358-disk-enforcement.log"

MARKER="BUY-57358: WC cycle artifact cleanup — wc-cycle-cleanup-cron"

NEW_CRON="0 */6 * * * cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # $MARKER"

mkdir -p "$REPO_ROOT/logs"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "$SETUP_LOG"; }

log "Setting up BUY-57358 Oracle scrape-data WC cycle artifact cleanup cron"

# Validate runner exists
if [[ ! -x "$RUNNER" ]]; then
  log "ERROR: runner script not found at $RUNNER"
  exit 1
fi

# Remove any old entries with this marker
CRONTAB="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$CRONTAB" | grep -v "$MARKER" || true)"

# Add the new canonical entry
printf '%s\n%s\n' "$CLEANED" "$NEW_CRON" | crontab -

# Verify exactly one canonical entry remains
COUNT="$(crontab -l | grep -c "$MARKER" || true)"
if [[ "$COUNT" -eq 1 ]]; then
  log "Verified: crontab contains exactly 1 BUY-57358 entry"
else
  log "Error: expected 1 BUY-57358 cron entry, found $COUNT" >&2
  exit 1
fi

log "Cron installed: 0 */6 * * * (every 6 hours)"
log "Runner: $RUNNER"
log "Log: $LOG_FILE"
log ""
log "To verify: crontab -l | grep '$MARKER'"
log "Setup complete (idempotent)."
