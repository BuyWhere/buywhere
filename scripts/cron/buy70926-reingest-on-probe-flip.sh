#!/usr/bin/env bash
# BUY-70926 — Oracle consumer for the dead->ok recheck queue.
#
# Polls `merchant_adapter_recheck_queue` for products whose `url_status` flipped
# from 'dead'/'transient' back to 'ok', applies the 3+ flips/24h quarantine
# rule, surgically rewrites `products.url` to the probe-verified working URL,
# and marks rows processed.
#
# Recommend: every 10 minutes (lightweight; flips are async and non-urgent).
# BUY-70782 also owns this consumer (adapter coverage + >7d death-monitor).
set -uo pipefail
ROOT="/paperclip/instances/default/workspaces/3ec8f6dd-1735-4479-9825-a2c42edac34c"
cd "$ROOT"
export CATALOG_DB_URL_FILE="$ROOT/data/.catalog_db_url"
exec node scripts/buy70926-reingest-on-probe-flip.mjs --batch-size 100