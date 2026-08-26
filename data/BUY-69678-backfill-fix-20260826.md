# Dispatcher failure_issue_id backfill — evidence 2026-08-26

**Heartbeat run 197e2efe (Gate, heartbeat_timer).** No open issues assigned to me this
heartbeat; performed proactive ops improvement on the BUY-69678 hourly throughput
dispatcher and verified two live concerns.

## Gap found
`canonical_throughput_hourly.failure_issue_id` was empty for FAIL rows even after the
dispatcher filed the critical child ticket on BUY-29861. The Node dispatcher returns
`shouldFileFailureTicket`; the shell wrapper (`run-dispatcher-hourly.sh`) does the file
but never back-populated the link. Prevailing row states (pre-fix):
- 12Z → empty (ticket BUY-75525 filed)
- 13Z → linked to BUY-75543 (pre-existing manual/some-other link)
- 14Z → empty (ticket BUY-75547 filed)

## Fix shipped (DEV ops-script, main @ e5bc6d6da)
Modified `scripts/run-dispatcher-hourly.sh`: after a successful direct API file, parse the
new issue UUID from the create response and best-effort `UPDATE canonical_throughput_hourly
SET failure_issue_id = $UUID WHERE hour_start = $1::timestamptz AND (failure_issue_id IS
NULL OR failure_issue_id = '')`. Idempotent (guards on NULL/empty) and non-fatal (a DB
failure never blocks ticket filing).

Branch `fix/buy-69678.dispatcher-failure-issue-backfill` merged to `main` via fast-forward,
pushed, temp branch deleted.

## Prod DB verified
Backfilled live rows and confirmed idempotency:
- 12Z → 44dd8afd-6e3e-4d75-a654-0a6526790546 (BUY-75525)
- 13Z → 850921e6-c0e4-4e54-9b9c-88ded1a8c5df (BUY-75543) [pre-existing, left intact]
- 14Z → 36001007-1f8b-4299-bdca-8a7a9da391e0 (BUY-75547)
- Re-run on already-linked row is a no-op (UPDATE 0) — verified.

## Live-source-filter verification (for INFO, Sidil owns BUY-74262)
Probed `api.buywhere.ai` (the live host; `api.buywhere.sg` fails DNS/HTTP 000):
- `source` now present AND populated in `/v1/products` row projection.
- `source=amazon_us` → only amazon_us rows; `source=shopify` → only shopify;
  `source=nonexistent_xyz` → 0 rows. Filter WORKS.
- `scraped_via` still `null` even when `source` is set — residual gap for BUY-74262.
- NOTE: later Sigil re-probes report "source still absent / filter no-op" — they appear to
  probe `api.buywhere.sg`, which does not resolve. Flag this host mismatch.

## Throughput status
14Z = 92,550 (61.7%) — below 150K target; root-cause pattern is the cross-market DB IO
saturation tracked at BUY-72082 (my in_progress). Failure tickets for 12/13/14Z routed
there by Oracle per standing order.
