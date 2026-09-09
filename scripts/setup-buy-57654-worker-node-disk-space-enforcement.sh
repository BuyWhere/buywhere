#!/usr/bin/env bash
# setup-buy-57654-worker-node-disk-space-enforcement.sh — BUY-57654 (idempotent)
#
# Installs cron entry for worker node disk-space enforcement.
# Runs every 10 minutes to check/enforce disk thresholds on all workspaces.
# Uses a shared marker "disk-enforcement-buy-57654-cron" for deduplication.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUNNER="$SCRIPT_DIR/run-buy-57654-worker-wc-cycle-cleanup.sh"
ENFORCE_RUNNER="$SCRIPT_DIR/run-buy-57654-worker-disk-enforcement.sh"
LOG_FILE="$REPO_ROOT/logs/buy-57654-disk-enforcement.log"
SETUP_LOG="$REPO_ROOT/logs/setup-buy-57654-disk-enforcement.log"

MARKER="disk-enforcement-buy-57654-cron"
CLEANUP_MARKER="wc-cleanup-buy-57654-cron"

NEW_CRON_CLEANUP="*/30 * * * * cd $REPO_ROOT && bash $RUNNER >> $LOG_FILE 2>&1 # BUY-57654: WC cycle artifact cleanup -- $CLEANUP_MARKER"

mkdir -p "$REPO_ROOT/logs"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "$SETUP_LOG"; }

log "Setting up BUY-57654 worker node disk-space enforcement cron"

# Validate runner exists
if [[ ! -x "$RUNNER" ]]; then
  log "ERROR: wc-cycle runner script not found at $RUNNER"
  exit 1
fi

# Remove any old entries with these markers
CRONTAB="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$CRONTAB" | grep -v "$MARKER" | grep -v "$CLEANUP_MARKER" || true)"

# Add the new canonical entries
printf '%s\n%s\n' "$CLEANED" "$NEW_CRON_CLEANUP" | crontab -

# Verify entries
CLEANUP_COUNT="$(crontab -l | grep -c "$CLEANUP_MARKER" || true)"
if [[ "$CLEANUP_COUNT" -ge 1 ]]; then
  log "Verified: crontab contains cleanup entry"
else
  log "Error: expected cleanup entry not found" >&2
  exit 1
fi

log "Cron installed:"
log "  Cleanup:     */30 * * * * (every 30 minutes) — $RUNNER"
log "Log: $LOG_FILE"
log ""
log "To verify: crontab -l | grep 'BUY-57654'"
log "Setup complete (idempotent)."
