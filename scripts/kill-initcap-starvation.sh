#!/usr/bin/env bash
# BUY-78933 — cancel INITCAP(LOWER(raw_name)) aggregations that starve catalog search.
# Runs as buywhere_ingest. Cannot cancel postgres-owned backends (API role);
# those must be gone after the INITCAP SQL is removed from /v1/categories.
set -euo pipefail
DSN_FILE="${CATALOG_DSN_FILE:-$HOME/.catalog_db_url}"
if [[ ! -f "$DSN_FILE" ]]; then
  DSN_FILE="/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c/data/.catalog_db_url"
fi
DSN=$(cat "$DSN_FILE")
export PGCONNECT_TIMEOUT=8
psql "$DSN" -v ON_ERROR_STOP=1 -c "
SELECT pid, usename, application_name,
       now()-query_start AS dur,
       pg_cancel_backend(pid) AS cancelled,
       left(query, 80) AS q
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND state = 'active'
  AND query ILIKE '%INITCAP%LOWER%raw_name%'
  AND now()-query_start > interval '20 seconds'
  AND query NOT ILIKE '%pg_stat_activity%';
"
