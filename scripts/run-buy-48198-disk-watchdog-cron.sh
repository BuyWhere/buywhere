#!/usr/bin/env bash
# run-buy-48198-disk-watchdog-cron.sh — Cron wrapper for disk watchdog
# Sources env config and calls the main watchdog script.
set -euo pipefail

# Source the Paperclip API credentials and config
ENV_FILE="/home/paperclip/.config/paperclip/disk-watchdog.env"
if [[ -f "$ENV_FILE" ]]; then
  source "$ENV_FILE"
else
  echo "WARNING: $ENV_FILE not found, using defaults" >&2
fi

# Call the main watchdog wrapper
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$REPO_ROOT/scripts/run-buy-48198-disk-watchdog.sh"
