#!/usr/bin/env bash
# BUY-70988 — outbound-link staleness probe worker.
#
# Runs one batch of the outbound-link probe, checks up to
# OUTBOUND_PROBE_BATCH_SIZE active product URLs, writes results to
# url_probe_log, and updates products.url_status.
#
# Recommended schedules:
#   - Baseline:   every hour  (catches ~1% drift per day on 500-product batches)
#   - Aggressive: every 30 minutes
#
# The worker is a no-op when PROBE_OUTBOUND_LINKS is unset, so it is safe to
# schedule before the flag is enabled.
set -uo pipefail
ROOT="/home/paperclip/buywhere"
cd "$ROOT"
export CATALOG_DB_URL_FILE="$ROOT/data/.catalog_db_url"
export DATABASE_URL="$(python3 - <<'PY'
from pathlib import Path
s = Path('/home/paperclip/buywhere/data/.catalog_db_url').read_text().strip()
if 'roundhouse.proxy.rlwy.net' in s:
    raise SystemExit('refusing Paperclip control-plane DSN')
print(s)
PY
)"
export PG_STATEMENT_TIMEOUT="${PG_STATEMENT_TIMEOUT:-120000}"
export PROBE_OUTBOUND_LINKS="${PROBE_OUTBOUND_LINKS:-1}"
export OUTBOUND_PROBE_COUNTRY="${OUTBOUND_PROBE_COUNTRY:-SG}"
exec node api/dist/jobs/outboundLinkProbeRunner.js
