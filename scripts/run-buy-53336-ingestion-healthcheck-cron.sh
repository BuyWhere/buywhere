#!/usr/bin/env bash
# run-buy-53336-ingestion-healthcheck-cron.sh — BUY-53674
# Recurring ingestion pipeline health check.
# Runs the Python health check script in --cron mode, writes a timestamped JSON
# report to data/reports/, prints a one-line summary, alerts Paperclip on
# degraded/unhealthy, and exits with the health status code.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${LOG_FILE:-$REPO_ROOT/logs/buy-53336-ingestion-healthcheck.log}"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/data/reports}"

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$REPORT_DIR"

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Source DATABASE_URL from repo env helper if not set (cron jobs lack env)
if [[ -z "${DATABASE_URL:-}" && -f "$REPO_ROOT/.env.healthcheck" ]]; then
  set -a; source "$REPO_ROOT/.env.healthcheck"; set +a
fi

# Run the health check in cron mode
set +e
OUTPUT=$(python3 "$SCRIPT_DIR/ingestion_pipeline_healthcheck.py" --cron --report-dir "$REPORT_DIR" 2>&1)
RC=$?
set -e

# Log the output
echo "[$TS] BUY-53674 healthcheck exit=$RC" >> "$LOG_FILE"
echo "$OUTPUT" >> "$LOG_FILE"

# Extract the summary line for stdout
SUMMARY=$(echo "$OUTPUT" | grep "\[BUY-53336\]" | tail -1)
echo "[$TS] $SUMMARY"

# Extract the JSON report for alerting
REPORT_JSON=$(echo "$OUTPUT" | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if line.startswith('{'):
        try:
            d = json.loads(line)
            print(json.dumps(d))
            break
        except: pass
" 2>/dev/null || echo "")

# Alert Paperclip on degraded (1) or unhealthy (2)
if [[ "$RC" -ge 1 && -n "${PAPERCLIP_API_URL:-}" && -n "${PAPERCLIP_API_KEY:-}" && -n "${PAPERCLIP_COMPANY_ID:-}" ]]; then
  OVERALL="$(echo "$REPORT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('overall','unknown'))" 2>/dev/null || echo "unknown")"
  WARN="$(echo "$REPORT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('warnings',0))" 2>/dev/null || echo 0)"
  CRIT="$(echo "$REPORT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('critical',0))" 2>/dev/null || echo 0)"
  TITLE="[BUY-53674] Ingestion pipeline health: ${OVERALL}"
  DESC="Health check finished with ${WARN} warning(s) and ${CRIT} critical(s)."
  if [ "$RC" -ge 2 ]; then
    PRIORITY="critical"
  else
    PRIORITY="medium"
  fi
  curl -s -X POST "${PAPERCLIP_API_URL}/api/companies/${PAPERCLIP_COMPANY_ID}/issues" \
    -H "Authorization: Bearer ${PAPERCLIP_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"title":"%s","description":"%s","priority":"%s","status":"backlog","labels":[{"name":"incident"},{"name":"infrastructure"},{"name":"ingestion-pipeline"}]}' "$TITLE" "$DESC" "$PRIORITY")" \
    -o /dev/null -w "%{http_code}" >> "$LOG_FILE" 2>&1 || true
  echo "" >> "$LOG_FILE"
fi

# Exit with health code for crontab visibility
exit $RC
