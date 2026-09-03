#!/usr/bin/env bash
# DEPRECATED by BUY-57327. Use run-buy-57311-worker-wc-cycle-cleanup.sh instead.
# setup-buy-57166-worker-node-disk-space-enforcement.sh
# BUY-57166: Worker node disk-space enforcement (WC cycle artifact cleanup)
#
# Idempotent installer. Adds hourly cron entry for the WC cycle cleanup runner.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$REPO_ROOT/scripts/run-buy-57166-worker-wc-cycle-cleanup.sh"
LOG_FILE="$REPO_ROOT/logs/buy-57166-disk-space-enforcement-cron.log"
CRON_MARKER="# BUY-57166: Worker node disk-space enforcement (WC cycle cleanup, Oracle workspace) -- hourly"

mkdir -p "$REPO_ROOT/logs"

# Install cron entry idempotently
(crontab -l 2>/dev/null | grep -qF "$CRON_MARKER") && {
  echo "Cron entry already installed."
  exit 0
}

(crontab -l 2>/dev/null; echo "0 * * * * bash $RUNNER >> $LOG_FILE 2>&1 $CRON_MARKER") | crontab -
echo "Installed hourly cron entry for BUY-57166."
