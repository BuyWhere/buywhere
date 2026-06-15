#!/bin/bash
# run-buy-48198-disk-watchdog.sh — Wrapper for disk space watchdog
#
# Runs the disk space monitoring script every 5 minutes via cron.
# This wrapper sets up environment variables and runs the watchdog.
#
# Usage:
#   ./scripts/run-buy-48198-disk-watchdog.sh
#
# Cron entry (add with crontab -e):
#   */5 * * * * cd /path/to/buywhere-api && ./scripts/run-buy-48198-disk-watchdog.sh >> /var/log/disk-watchdog.log 2>&1
#
# Environment:
#   PAPERCLIP_API_KEY - Paperclip API key for incident creation
#   PAPERCLIP_COMPANY_ID - Company ID for Paperclip API
#   DISK_WARN_THRESHOLD_GB - Warning threshold in GB (default: 20)
#   DISK_CRITICAL_THRESHOLD_GB - Critical threshold in GB (default: 5)

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Environment variables with defaults
export DISK_STATE_FILE="${DISK_STATE_FILE:-/tmp/buy-48198-disk-state.json}"
export DISK_EXECUTION_ISSUE="${DISK_EXECUTION_ISSUE:-BUY-48198}"
export DISK_WARN_THRESHOLD_GB="${DISK_WARN_THRESHOLD_GB:-20}"
export DISK_CRITICAL_THRESHOLD_GB="${DISK_CRITICAL_THRESHOLD_GB:-5}"
export DISK_ALERT_COOLDOWN_HOURS="${DISK_ALERT_COOLDOWN_HOURS:-1}"
export DISK_ALERT_SINK="${DISK_ALERT_SINK:-BUY-48198}"

# Snapshot directory (timestamped)
TIMESTAMP=$(date -u +%Y-%m-%dT%H%MZ)
SNAPSHOT_ISSUE="${DISK_EXECUTION_ISSUE:-BUY-48198}"
export DISK_SNAPSHOT_DIR="${PROJECT_ROOT}/data/${SNAPSHOT_ISSUE}-disk-check-${TIMESTAMP}"

# Run the watchdog
cd "$PROJECT_ROOT"
node scripts/buy-38913-disk-space-watchdog.js

exit $?
