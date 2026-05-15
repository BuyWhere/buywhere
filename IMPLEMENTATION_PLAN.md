# High-Volume Shopify Merchant Discovery - Implementation Plan

## Objective
Execute US Shopify merchant discovery targeting **5,000+ merchants/day** (minimum 3,460/day).
Feed validated merchants to ingestion pipeline for product extraction and normalization.

## Phase 1: Domain-Based Validation (IN PROGRESS)
**Script**: `scripts/shopify_discover_us.py`  
**Data source**: 49,961 US Shopify domains from consolidated list  
**Method**: HTTP validation of /products.json endpoint  
**Parameters**: batch-size=1000, concurrency=100  

### Progress
- Status: Running
- Current: 966+ merchants validated
- Success rate: ~2% (typical for Shopify domains)
- Expected total: ~1,000 merchants from this batch
- Output: `data/discovery/validated/validated_us_merchants.jsonl` (NDJSON format)

### Record Schema
```json
{
  "domain": "shop.myshopify.com",
  "status": "valid_shopify",
  "product_count_sample": 250,
  "has_products": true,
  "source": "storeleads",
  "country": "US",
  "state": "CA",
  "merchant_name": "Shop Name",
  "categories": "fashion,accessories",
  "discovered_at": "2026-05-15T16:42:00Z"
}
```

## Phase 2: Merchant Queuing (READY)
**Script**: `scripts/feed_merchants_to_pipeline.py`  
**Input**: validated_us_merchants.jsonl  
**Output**: ingestion_queue.jsonl  
**Purpose**: Deduplicate and queue merchants for product extraction

### Steps
1. Load all validated merchants with confirmed products
2. Filter out already-queued merchants
3. Create ingestion queue with timestamp
4. Pass to Hex agent for processing

## Phase 3: Product Extraction & Ingestion (PENDING)
**Owner**: Hex agent (Scraping & Data Engineer)  
**Task**: [Will create after Phase 1 completes]

### Steps
1. For each queued merchant:
   - Fetch /products.json with pagination
   - Extract product metadata (name, price, currency, URL, images, categories)
   - Normalize to BuyWhere schema
   - Store in temporary staging area
2. Bulk insert normalized products to database
3. Track ingestion metrics (products/merchant, success rate, errors)
4. Report completion and readiness for search indexing

## Phase 4: Supplementary Discovery Methods (CONDITIONAL)
If Phase 1 doesn't reach 5,000 merchants/day, activate:

### 4a. Google Dork Discovery
**Query**: `inurl:/products.json site:myshopify.com`  
**Tool**: Google Programmable Search Engine API  
**Expected yield**: Millions of results, but requires pagination & rate-limit handling  
**Estimated coverage**: +5,000-10,000 merchants

### 4b. Certificate Transparency (CT) Logs
**Method**: Query crt.sh for all *.myshopify.com certificates  
**Tool**: crt.sh API  
**Expected yield**: All registered Shopify stores with SSL certificates  
**Estimated coverage**: +20,000-50,000 merchants

### 4c. Consolidate Existing Lists
**Sources**:
- storeleads_us_only.json (already loaded)
- storeleads_us_cn_hk.csv (broader geographic scope)
- dukaan_shopify.csv
- gist_shopify_10k.csv
- hf_shopify_10k.csv
- crtsh_myshopify_raw.json (existing CT data)

## Timeline & Targets
- **Phase 1 (Discovery)**: ~10-15 minutes per batch (49,961 domains)
- **Phase 2 (Queuing)**: < 1 minute
- **Phase 3 (Ingestion)**: Depends on Hex's capacity, typically 2-4 hours for 1,000 merchants
- **Daily run**: Can repeat phases 1-3 daily to maintain 5,000+ merchants/day ingestion

## Success Metrics
- Merchants discovered: 5,000+ per day
- Validation success rate: > 1.5%
- Product extraction: 1.73M products/day (at ~500 products per merchant)
- Ingestion latency: < 24 hours from discovery to live in catalog
- Error rate: < 5% (invalid domains, timeouts, API errors)

## Related Issues
- **BUY-11344**: This discovery task
- **BUY-11345**: Ingestion pipeline (Hex) - DONE
- **BUY-12186**: Product Roadmap - 1M products by May 31 (target velocity: 1.73M/day)
