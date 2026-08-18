#!/usr/bin/env bash
# BUY-70932 — Oracle consumer for merchant-adapter recheck queue.
#
# Polls `merchant_adapter_recheck_queue` for products whose `url_status` flipped
# from 'dead' to 'ok', applies the 3+ flips/24h quarantine rule, re-maps URLs,
# and marks rows processed.
#
# Recommend: every 10 minutes (lightweight; flips are async and non-urgent).
set -uo pipefail
ROOT="/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c"
cd "$ROOT"
export CATALOG_DB_URL_FILE="$ROOT/data/.catalog_db_url"
exec node scripts/buy70932-reingest-on-probe-flip.mjs --batch-size 100
