#!/usr/bin/env bash
# setup-buy-57705-disk-cleanup.sh — Setup cron job for BUY-57705 disk cleanup
# Schedule: Daily at 4am UTC
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CRON_JOB="0 4 * * * $REPO_ROOT/scripts/buy-57705-disk-cleanup.sh >> $REPO_ROOT/logs/buy-57705-disk-cleanup-cron.log 2>&1"
CRON_FILE="/etc/cron.d/buy-57705-disk-cleanup"

# Check if cron job already exists
if [ -f "$CRON_FILE" ] && grep -q "buy-57705-disk-cleanup" "$CRON_FILE"; then
    echo "Cron job already configured for BUY-57705"
    exit 0
fi

# Create cron file
echo "$CRON_JOB" > "$CRON_FILE"
chmod 644 "$CRON_FILE"

echo "Cron job configured: Daily at 4am UTC"
cat "$CRON_FILE"
