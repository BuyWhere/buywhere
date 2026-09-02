# BUY-16839: Shelf: Ingest 3 verified SG Shopify merchants (Baby/Children)

## Status: COMPLETED

## Latest Wake Re-run (2026-05-14)

Executed via `python3 scrapers/shopify_scraper.py` against `https://api.buywhere.ai` with key `shelf-ingest-key-buy8803`.

| Merchant | Domain | Source | Products fetched | Ingest result |
|---|---|---|---:|---|
| Little Toes | littletoes.com | shopify_littletoes | 38 | OK, updated: 38
| Ecobirdy | ecobirdy.com | shopify_ecobirdy | 69 | OK, updated: 69
| Bambooee | bambooee.com | shopify_bambooee | 22 | OK, updated: 22 |

Notes:
- Endpoint used: `POST /v1/ingest/products`.
- `rows_inserted` reported as `0` for all runs and `rows_updated` matched fetched counts, indicating records were already present and were refreshed.
- No failed batches or errors were observed.
