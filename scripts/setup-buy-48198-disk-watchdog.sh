#!/usr/bin/env bash
# Install the canonical BUY-48198 disk watchdog cron entry.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/buy48198_disk_watchdog_cron.log"
CRON_LABEL="# BUY-48198: Disk watchdog + cleanup pipeline — every 5 min"
CRON_CMD="*/5 * * * * cd $REPO_ROOT && WORKSPACES_ROOT=/paperclip/instances/default/workspaces LOG_FILE=$LOG_FILE bash $SCRIPT_DIR/run-buy-48198-disk-watchdog-cron.sh"
TMP_CRONTAB="$(mktemp)"

cleanup() {
  rm -f "$TMP_CRONTAB"
}
trap cleanup EXIT

crontab -l 2>/dev/null | \
  grep -Ev 'BUY-48198: Disk watchdog|run-buy-(48198|52997)-disk-watchdog-cron\.sh' \
  >"$TMP_CRONTAB" || true

{
  cat "$TMP_CRONTAB"
  echo "$CRON_LABEL"
  echo "$CRON_CMD"
} | crontab -

mkdir -p "$REPO_ROOT/logs"

echo "BUY-48198 cron installed:"
echo "  $CRON_CMD"
echo
echo "Running immediate watchdog smoke pass..."
bash "$SCRIPT_DIR/run-buy-48198-disk-watchdog-cron.sh"
echo
echo "Setup complete."
