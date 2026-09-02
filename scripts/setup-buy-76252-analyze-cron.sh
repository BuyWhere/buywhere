#!/usr/bin/env bash
# BUY-76252: Install scheduled ANALYZE search_products cron (6h interval)
# Prevents stale statistics that cause FTS query slowdowns (BUY-72082 echo)
# Parent: BUY-76246
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANALYZE_SCRIPT="$REPO_ROOT/scripts/analyze-search-products.sh"
CRON_LABEL="# BUY-76252: ANALYZE search_products every 6h (prevent BUY-72082 echo)"
CRON_CMD="0 */6 * * * $ANALYZE_SCRIPT >> $REPO_ROOT/logs/analyze-search-products.log 2>&1"

# Check if cron entry already exists
if crontab -l 2>/dev/null | grep -q "BUY-76252"; then
  echo "BUY-76252 cron entry already installed. Removing and re-adding..."
  (crontab -l 2>/dev/null | grep -v "BUY-76252") | crontab -
fi

# Add new cron entry
(crontab -l 2>/dev/null; echo "$CRON_LABEL"; echo "$CRON_CMD") | crontab -

echo "BUY-76252 cron installed:"
echo "  $CRON_CMD"

# Ensure logs directory exists
mkdir -p "$REPO_ROOT/logs"

# Create the ANALYZE script if it doesn't exist
if [ ! -f "$ANALYZE_SCRIPT" ]; then
  cat > "$ANALYZE_SCRIPT" << 'SCRIPT_EOF'
#!/usr/bin/env bash
# BUY-76252: Scheduled ANALYZE on search_products every 6h
# Prevents stale statistics that cause FTS query slowdowns
set -euo pipefail

DB_URL="$(cat /home/paperclip/buywhere-api/data/.catalog_db_url)"

ANALYZE_SQL="SET statement_timeout = 0; ANALYZE search_products;"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - Starting ANALYZE search_products..."

START_TIME=$(date +%s%3N)
psql "$DB_URL" -X -c "$ANALYZE_SQL" 2>&1 | head -20
END_TIME=$(date +%s%3N)
DURATION_MS=$((END_TIME - START_TIME))

LAST_ANALYZE=$(psql "$DB_URL" -X -t -c "SELECT last_analyze FROM pg_stat_user_tables WHERE relname='search_products';" | xargs)

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - ANALYZE search_products completed in ${DURATION_MS}ms, last_analyze=${LAST_ANALYZE}"
SCRIPT_EOF
  chmod +x "$ANALYZE_SCRIPT"
  echo "Created $ANALYZE_SCRIPT"
fi

echo ""
echo "Running initial ANALYZE to verify..."
bash "$ANALYZE_SCRIPT"
echo ""
echo "Setup complete. Cron will run every 6h."
