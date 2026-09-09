# BUY-75407 — cushlatea.com — US Shopify, 75 products

## Pipeline Checkpoint A — Scraping → R2
- Source: https://cushlatea.com/products.json (Shopify)
- Records scraped: 98 variant rows (75 products)
- R2 key: buywhere-data/shopify/cushlatea/2026-08-26.jsonl
- R2 upload: confirmed ✓ (PUT 200, HEAD 200, content-length=149811)
- R2 md5: 16cab2535701db2a12923dbc7648ef92
- Local file: cushlatea_rows.jsonl (149811 B, 98 rows)
- VPS local cleanup: complete ✓ (data lives in R2 only)

## Merchant
- id: cushlatea.com (TEXT per BUY-75366)
- name: Cushla Tea
- source: shopify_cushlatea.com
- domain: cushlatea.com
- country: US
- products_count: 98 (set from indexed probe)

## SKU profile
- Total variants: 98
- Real SKUs (96): mostly CSH-*-* style (e.g. CSH-HIGH-MTN-LL, CSH-HIGH-MTN-BAGS)
- Blank SKUs (2): handled via handle::vN synthesis
- (sku, source) uniqueness: 0 collisions

## DB Ingest
- DSN: workspace buywhere_ingest (per BUY-75365/BUY-75366 — workspace DSN has UPDATE on catalog_product_counts, root /home/paperclip/buywhere/ DSN is ingest_rw and trips trigger fn_catalog_products_ins)
- First attempt (workspace /home/paperclip/buywhere DSN, ingest_rw): chunk-0 50 rows landed but trigger ACL `permission denied for table catalog_product_counts` on subsequent chunks
- Resolved by switching to workspace DSN (buywhere_ingest): chunk-0 50 rows + retry pass with 10-row chunks under fresh-conn + 45s statement_timeout = 48 more rows
- 9 timeouts before the row-lock cleared (typical sakura trigger row-lock pattern from BUY-75323)

## Pipeline Checkpoint B — DB SELECT
- Indexed SKU probe (temp table JOIN on (sku, source) — not full COUNT(*)):
  SELECT count(*) FROM products p JOIN _probe pr ON p.sku=pr.sku AND p.source=pr.source
  → 98 / 98 ✓ exact
- merchant.products_count = 98
- merchant.last_scraped_at = NOW()
- Status: DONE

## Artifacts in /home/paperclip/buywhere/BUY-75407/
- cushlatea_p1.json (raw Shopify response, 75 products)
- cushlatea_rows.jsonl (149811 B, 98 rows)
- cushlatea_netnew.jsonl (149811 B, 98 net-new rows for ingest)
- r2_manifest.txt (key + md5)
- buy-75407-cushlatea-evidence.md (this file)
