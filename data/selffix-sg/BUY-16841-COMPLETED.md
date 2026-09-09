# BUY-16841 - Selffix SG Ingest - Completed

## Summary

- Scraped Selffix Singapore product URLs from `https://www.selffix.com/xmlsitemap.php?type=products&page=1`.
- Recovered variant-backed products whose public pages omit `BCData.product_attributes.sku` by falling back to JSON-LD `Offer.sku` and BigCommerce `productId`.
- Resolved three upstream SKU collisions by suffixing the stable BigCommerce `product_id` only where the same SKU appeared on multiple URLs.
- Loaded the merged dataset into BuyWhere Postgres under `source='selffix_sg'`.

## Artifacts

- Primary scrape: `data/selffix-sg/products_20260514_173011.jsonl`
- Rescue scrape: `data/selffix-sg/rescue_20260514_173734.jsonl`
- Merged ingest file: `data/selffix-sg/products_merged_20260514_173943.jsonl`
- Scraper implementation: `scrapers/selffix_sg.py`

## Verification

- Sitemap URLs discovered: `3,846`
- Final merged rows: `3,846`
- Final unique URLs: `3,846`
- Final unique SKUs after collision repair: `3,846`
- Postgres products count for `source='selffix_sg'`: `3,846`
- Ingestion run id: `392`
