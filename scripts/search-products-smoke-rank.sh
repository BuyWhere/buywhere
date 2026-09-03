#!/usr/bin/env bash
# BUY-80623: hourly refresh of search_products_smoke_rank on sakura.
# Never roundhouse. Never CLUSTER/VACUUM FULL. Id-only GIN + PK hydrate.
set -euo pipefail
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOG=/home/paperclip/ops-canon/cron/logs/search-products-smoke-rank.log
DSN_FILE=/home/paperclip/buywhere-api/data/.catalog_db_url
mkdir -p "$(dirname "$LOG")"
{
  echo "[$TS] start"
  if [[ ! -f "$DSN_FILE" ]]; then
    echo "[$TS] missing DSN file" >&2
    exit 2
  fi
  export BUYWHERE_DATABASE_URL
  BUYWHERE_DATABASE_URL="$(tr -d '\n' < "$DSN_FILE")"
  BUYWHERE_DATABASE_URL="${BUYWHERE_DATABASE_URL%%\?sslmode=*}"
  case "$BUYWHERE_DATABASE_URL" in
    *roundhouse*|*paperclip*) echo "[$TS] refusing control-plane DSN" >&2; exit 3 ;;
    *sakura*) echo "[$TS] dsn host=sakura ok" ;;
    *) echo "[$TS] refusing non-sakura DSN host" >&2; exit 3 ;;
  esac
  exec python3 /home/paperclip/ops-canon/cron/search_products_smoke_rank.py
} >>"$LOG" 2>&1
