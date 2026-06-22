#!/usr/bin/env bash
# run-buy-55478-disk-space-watchdog-cron.sh — BUY-55478 / BUY-48198 | BUY-54086
# Compatibility wrapper to the canonical BUY-54086 runner.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANONICAL="$SCRIPT_DIR/run-buy-54086-disk-space-watchdog-cron.sh"

if [[ ! -f "$CANONICAL" ]]; then
  echo "ERROR: canonical runner not found: $CANONICAL" >&2
  exit 1
fi

exec bash "$CANONICAL"
