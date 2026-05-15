# Shopify Merchant Discovery Status

## Process
- Started: 2026-05-15 16:42
- Script: `scripts/shopify_discover_us.py`
- Parameters: batch-size=1000, concurrency=100, us-only=true
- Data source: consolidated_all.json (49,961 US domains)

## Progress
- Validated merchants collected in: `data/discovery/validated/validated_us_merchants.jsonl`
- Format: NDJSON (JSON Lines) with fields:
  - domain: Shopify store domain
  - status: validation result (valid_shopify, etc.)
  - product_count_sample: products found in sample
  - has_products: boolean
  - source, country, state, categories, merchant_name: metadata

## Next Steps
1. Complete current discovery batch
2. Feed validated merchants to ingestion pipeline
3. Extract full product data via /products.json
4. Normalize and ingest into products database
5. Target: 1.73M products/day = 3,460+ merchants/day

## Related Issues
- BUY-11344: Merchant discovery (this issue)
- BUY-11345: Ingestion pipeline (Hex)
