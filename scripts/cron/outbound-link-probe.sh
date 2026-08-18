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
ROOT="/paperclip/instances/default/workspaces/8ca957f8-0911-4e81-a963-e2cf54c97d44"
cd "$ROOT"
export CATALOG_DB_URL_FILE="$ROOT/data/.catalog_db_url"
exec node api/dist/jobs/outboundLinkProbeRunner.js
