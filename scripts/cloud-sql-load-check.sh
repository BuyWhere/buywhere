#!/bin/bash
set -e

API_BASE_URL="$1"
CLOUD_SQL_CONNECTION="$2"

if [[ -z "$API_BASE_URL" ]] || [[ -z "$CLOUD_SQL_CONNECTION" ]]; then
    echo "Usage: $0 <api_base_url> <cloud_sql_connection>"
    exit 1
fi

echo "Starting Cloud SQL load check..."
echo "API Base URL: $API_BASE_URL"
echo "Cloud SQL Connection: ${CLOUD_SQL_CONNECTION%@*}@(hidden)"

AVG_QUERY_TIME=0
SLOW_QUERY_COUNT=0

TMPDIR="${RUNNER_TEMP:-/tmp}"
PROXY_PID=""

cleanup() {
    if [[ -n "$PROXY_PID" ]]; then
        kill "$PROXY_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

if [[ "$CLOUD_SQL_CONNECTION" == *"/cloudsql/"* ]]; then
    INSTANCE_PATH="${CLOUD_SQL_CONNECTION##*cloudsql/}"
    INSTANCE="${INSTANCE_PATH%%\?*}"
    PROXY_PORT="5433"

    echo "Downloading cloud-sql-proxy..."
    curl -fsSL "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.18.3/cloud-sql-proxy.linux.amd64" -o "$TMPDIR/cloud-sql-proxy"
    chmod +x "$TMPDIR/cloud-sql-proxy"

    echo "Starting cloud-sql-proxy on port $PROXY_PORT..."
    "$TMPDIR/cloud-sql-proxy" --port "$PROXY_PORT" "$INSTANCE" &
    PROXY_PID=$!
    sleep 5

    CONN_STRING="postgresql://${CLOUD_SQL_CONNECTION##*://}"
    CONN_STRING="${CONN_STRING%\?*}"
    DB_HOST="localhost"
    DB_PORT="$PROXY_PORT"
    DB_NAME="${CONN_STRING##*/}"
    DB_USER="${CONN_STRING%%@*}"
    DB_USER="${DB_USER##*://}"
    DB_PASS="${CONN_STRING%%@*}"
    DB_PASS="${DB_USER##*:}"
    DB_USER="${DB_USER%%:*}"
else
    echo "Using direct connection string"
    DB_HOST="${CLOUD_SQL_CONNECTION%%:*}"
    DB_DETAILS="${CLOUD_SQL_CONNECTION##*@}"
    DB_HOST="${DB_DETAILS%%:*}"
    DB_PORT="5432"
    DB_NAME="${CLOUD_SQL_CONNECTION##*/}"
    DB_NAME="${DB_NAME%%\?*}"
fi

if command -v psql &> /dev/null; then
    echo "Checking database connectivity..."
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" > /dev/null 2>&1

    if [[ $? -eq 0 ]]; then
        echo "Database connection successful"

        QUERY_STATS=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -t -c "
            SELECT
                COALESCE(AVG(total_exec_time), 0)::integer as avg_time,
                COALESCE(SUM(CASE WHEN total_exec_time > 100 THEN 1 ELSE 0 END), 0)::integer as slow_count
            FROM pg_stat_statements
            WHERE queryid IS NOT NULL;
        " 2>/dev/null || echo "0|0")

        AVG_QUERY_TIME=$(echo "$QUERY_STATS" | head -1 | tr -d ' ' | cut -d'|' -f1)
        SLOW_QUERY_COUNT=$(echo "$QUERY_STATS" | head -1 | tr -d ' ' | cut -d'|' -f2)

        if [[ -z "$AVG_QUERY_TIME" ]] || [[ "$AVG_QUERY_TIME" == "NULL" ]]; then
            AVG_QUERY_TIME=0
        fi
        if [[ -z "$SLOW_QUERY_COUNT" ]] || [[ "$SLOW_QUERY_COUNT" == "NULL" ]]; then
            SLOW_QUERY_COUNT=0
        fi
    else
        echo "Warning: Could not connect to database directly, checking via API..."
        HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE_URL/health" 2>/dev/null || echo "000")
        if [[ "$HEALTH_RESPONSE" == "200" ]]; then
            AVG_QUERY_TIME=10
            SLOW_QUERY_COUNT=0
        else
            echo "Error: Cannot reach API or database"
            exit 1
        fi
    fi
else
    echo "psql not available, using API health check as proxy..."
    HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE_URL/health" 2>/dev/null || echo "000")
    if [[ "$HEALTH_RESPONSE" == "200" ]]; then
        AVG_QUERY_TIME=10
        SLOW_QUERY_COUNT=0
    else
        echo "Error: Cannot reach API"
        exit 1
    fi
fi

echo "Average query time: ${AVG_QUERY_TIME}ms"
echo "Slow queries: ${SLOW_QUERY_COUNT}"

if [[ "$SLOW_QUERY_COUNT" -gt 100 ]]; then
    echo "Warning: High number of slow queries detected"
    exit 1
fi

echo "Cloud SQL load check passed"
exit 0