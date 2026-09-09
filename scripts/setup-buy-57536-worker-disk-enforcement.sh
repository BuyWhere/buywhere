#!/usr/bin/env bash
# setup-buy-57536-worker-disk-enforcement.sh — BUY-57536 (idempotent)
#
# Installs cron entry for worker node disk-space enforcement.
# Runs every 10 minutes to check/enforce disk thresholds on all workspaces.
# Uses a shared marker "disk-enforcement-cron" for deduplication.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUNNER="$SCRIPT_DIR/run-buy-57536-worker-disk-enforcement.sh"
LOG_FILE="$REPO_ROOT/logs/buy-57536-disk-enforcement.log"
SETUP_LOG="$REPO_ROOT/logs/setup-buy-57536-disk-enforcement.log"

MARKER="disk-enforcement-cron"

NEW_CRON="*/10 * * * * cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # BUY-57536: Worker node disk-space enforcement -- $MARKER"

mkdir -p "$REPO_ROOT/logs"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "$SETUP_LOG"; }

log "Setting up BUY-57536 worker node disk-space enforcement cron"

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
  log "Verified: crontab contains exactly 1 disk-enforcement-cron entry"
else
  log "Error: expected 1 disk-enforcement-cron entry, found $COUNT" >&2
  exit 1
fi

log "Cron installed: */10 * * * * (every 10 minutes)"
log "Runner: $RUNNER"
log "Log: $LOG_FILE"
log ""
log "To verify: crontab -l | grep '$MARKER'"
log "Setup complete (idempotent)."
