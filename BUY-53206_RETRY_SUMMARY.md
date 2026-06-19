# BUY-53206: Midnight UTC Maglev Retry — Complete

## What happened

The auto-wake at midnight UTC triggered a retry of 6 merchants that had failed in the BUY-31264 run.

## Root cause of failures

The ingest API endpoint (`/v1/ingest/products`) was sending `country_code: null` for products that don't explicitly include a country_code field. The `products` table is partitioned by `country_code` (values: MY, PH, SG, TH, US) with a NOT NULL constraint. When `country_code` was NULL, PostgreSQL threw:

```
Database error: no partition of relation "products" found for row
```

This affected 3 merchants with 1,000 failures each (lordandtaylor, step2, watches). The other 3 merchants (toysrus, huckberry, kyliecosmetics) had already been resolved in prior retry cycles.

## Fix applied

1. **Database**: Added a DEFAULT partition to `products` table as a safety net for rows whose country_code doesn't match existing partitions.
2. **API code** (`api/src/routes/ingest.ts`): Changed `p.country_code || null` to `p.country_code || merchantCountry || null` so the API falls back to the merchant's registered country when country_code is not provided.
3. **Retry script**: Added `country_code: 'US'` to the `transformShopifyToMaglev()` function so all outgoing product payloads include the correct partition key.

## Retry results

| Merchant | Before | After |
|---|---|---|
| lordandtaylor | 84,000 success / 1,000 failed | 109,000 success / 0 failed |
| toysrus | 52,612 success / 0 failed | 67,015 success / 0 failed |
| huckberry | 71,200 success / 0 failed | 89,500 success / 0 failed |
| step2 | 10,460 success / 1,000 failed | 13,575 success / 0 failed |
| watches | 15,185 success / 1,000 failed | 19,580 success / 0 failed |
| kyliecosmetics | 651 success / 0 failed | 868 success / 0 failed |

**Total: 809,496 success / 2,215 failed** (remaining failures are dermalogica and patpat, unrelated to this issue)

**DB total products: 17,216,102**

## Remaining

- The API deployment on Railway continues to fail (build errors). The code fix needs to be deployed when CI/CD is restored.
- 2,215 failures remain from dermalogica and patpat — these are out of scope for this issue.
