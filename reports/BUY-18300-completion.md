# BUY-18300 Storefront 403 Recovery Summary

Run date: 2026-05-16 UTC

## What changed

- Updated `scripts/batch_shopify_scraper.py` to support `--include-domain` and `--exclude-domain` so recovery batches can target a known blocker set directly.
- Added explicit fetch diagnostics to the run report so storefront failures are no longer flattened into `no_products`.
- Added a `curl` fallback for Shopify `products.json` fetches when `urllib` receives `403`, which was the actual failure mode for the 24-domain blocker set in this workspace.
- Fixed `merchants_processed` accounting so failed-early merchants are still counted in the run summary.

## Recovery run

- Command: `python3 scripts/batch_shopify_scraper.py --delay 0.2 --report-path reports/BUY-18300-shopify-403-recovery-report.json ...24 domains...`
- Merchants processed: 24
- Merchants recovered from storefront fetch blocker: 24
- Products fetched: 13,296
- Products ingested: 13,092
- Product rows failed during ingest: 100

## Outcome

- The original blocker was not a permanent Shopify storefront denial across the 24 domains.
- `urllib` consistently received `403` for the affected stores, but the same endpoints succeeded through `curl`, so the recovery path is now built into the scraper.
- All 24 storefronts were fetched successfully in the recovery run.

## Residual follow-up

- `toysrus.com` fetched 2,500 products and ingested 2,400; the final 100-row batch failed with `status=failed` and no error body.
- `modells.com` fetched and ingested 250 products, but page 2 returned `HTTP 500`, so the catalog may be incomplete.

## Artifacts

- Recovery report: `reports/BUY-18300-shopify-403-recovery-report.json`
- Prior batch summary: `reports/BUY-18289-completion.md`
