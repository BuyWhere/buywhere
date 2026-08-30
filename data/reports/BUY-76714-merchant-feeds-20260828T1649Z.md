# BUY-76714 merchant product feeds — heartbeat 2026-08-28T16:49Z

## Delivered paths

- `scrapers/merchant_feed_discovery.py` — XML/RSS/Atom/product-sitemap validator for merchants that already have catalog products. It refuses roundhouse/non-sakura DSNs, performs no DDL, and DB upsert is optional.
- `migrations/2026-08-28-buy-76714-merchant-feeds.sql` — Ops-apply DDL for `public.merchant_feeds` plus indexes/comments.
- `data/merchant_feeds/merchant_feeds_20260828T164614Z.ndjson`
- `data/merchant_feeds/merchant_feeds_20260828T164614Z.csv`
- `data/merchant_feeds/latest_summary.json`

## Counter / quota evidence

- Merchants probed: 240
- Validated feeds: 237
- Quota: 200 validated feeds/day — met by this output
- CSV rows: 237
- Syntax check: `python3 -m py_compile scrapers/merchant_feed_discovery.py` PASS

## R2 evidence

Uploaded with boto3 and verified with `head_object`:

- Bucket/key: `buywhere-data/merchant-feeds/2026-08-28/merchant_feeds_20260828T164614Z.ndjson`
- Size: 112,588 bytes
- ETag: `6dc1eb95658a6b0ceecdb05b72dad393`

## Catalog DB gate

`public.merchant_feeds` does not exist yet:

```json
{"merchant_feeds_table_exists": false}
```

The script attempted the upsert and reported:

```text
UndefinedTable: relation "public.merchant_feeds" does not exist
```

Probe did not run DDL per BUY-76714 rules (`Ops apply only`, no direct DDL/TRUNCATE/DELETE on catalog tables).

## PIPELINE CHECKPOINT — Scraping → R2

Source:            merchant feed discovery from existing catalog merchants with products
Records scraped:   237 validated feed rows
R2 key(s):         buywhere-data/merchant-feeds/2026-08-28/merchant_feeds_20260828T164614Z.ndjson
R2 upload status:  confirmed ✓
VPS local cleanup: retained repo/data copy for Ops handoff; scratch source can be cleaned after handoff

## Remaining / unblock owner

Blocked on Ops/DDL owner: apply `migrations/2026-08-28-buy-76714-merchant-feeds.sql` with `application_name='ops-ddl'`, then merge/schedule `scrapers/merchant_feed_discovery.py` so future runs upsert the feed counter into `public.merchant_feeds`.

## Paperclip API write attempts

Per heartbeat contract, I tried twice and stopped after repeated control-plane write failure:

1. `POST /api/issues/908a02a4-aaec-47a1-8600-c4460f8fa5d8/comments` with `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` → HTTP 403 `cross_issue_influence_run_context_required`.
2. `PATCH /api/issues/908a02a4-aaec-47a1-8600-c4460f8fa5d8` with `status=blocked` and Dash unblock descriptor → HTTP 403 `cross_issue_influence_run_context_required`.
