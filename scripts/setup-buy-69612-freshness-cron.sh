#!/usr/bin/env bash
# BUY-69612: Install hourly cron for source_mix_freshness_check.js
# The dispatcher_v6_hourly.js already calls this script during each tick,
# but we also need it to run independently to ensure reconciliation_status
# is always populated even if the dispatcher misses a tick.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(dirname "$SCRIPT_DIR")"
CRON_LABEL="# BUY-69612: source-mix freshness + reconciliation check (hourly at :05)"
CRON_CMD="5 * * * * root cd $WORKSPACE && DATABASE_URL=\"\$(cat data/.catalog_db_url)\" node scripts/source_mix_freshness_check.js --hour \"\$(date -u -d '1 hour ago' +\%Y-\%m-\%dT\%H:00:00Z)\" --write --json >> /var/log/buywhere-freshness-check.log 2>&1"

if [ -f /etc/cron.d/buywhere-source-mix-freshness ]; then
  echo "Cron entry already exists. Updating..."
  sed -i '/BUY-69612/d' /etc/cron.d/buywhere-source-mix-freshness
fi

echo "$CRON_LABEL" >> /etc/cron.d/buywhere-source-mix-freshness
echo "$CRON_CMD" >> /etc/cron.d/buywhere-source-mix-freshness
chmod 644 /etc/cron.d/buywhere-source-mix-freshness

echo "BUY-69612 cron installed:"
cat /etc/cron.d/buywhere-source-mix-freshness
