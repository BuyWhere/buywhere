#!/usr/bin/env bash
# run-buy-50922-disk-watchdog-cron.sh — Cron wrapper for disk watchdog (BUY-50922)
# Monitors /dev/vda1 free space and creates critical Paperclip incident when below 5GB (warns at 20GB).
# Runs every 5 minutes via cron.
set -euo pipefail

# Source the Paperclip API credentials and config
ENV_FILE="/home/paperclip/.config/paperclip/disk-watchdog.env"
if [[ -f "$ENV_FILE" ]]; then
  source "$ENV_FILE"
else
  echo "WARNING: $ENV_FILE not found, using defaults" >&2
fi

# Set the execution issue for this watchdog instance
export DISK_EXECUTION_ISSUE="BUY-50922"
export DISK_ALERT_SINK="BUY-50922"

# Call the main watchdog wrapper
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$REPO_ROOT/scripts/run-buy-48198-disk-watchdog.sh"
