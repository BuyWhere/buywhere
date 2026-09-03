# BUY-7268: WooCommerce + Google Shopping Feed Ingestion Pipeline

## Status: PARTIALLY COMPLETE

### WooCommerce REST API - WORKING

**Confirmed working:**
- `nuvanta.com.sg` - Successfully ingested 78 products via WooCommerce Store API (`/wp-json/wc/store/v1/products`)
- End-to-end verified: scrape → normalize → POST to `/v1/ingest/products` → 200 OK, rows_inserted confirmed

**Pipeline script:** `ingest_woo_gshopping.py`

**Usage:**
```bash
python3 ingest_woo_gshopping.py \
    --woo-stores nuvanta.com.sg \
    --api-key <key> \
    --batch-size 200 \
    --log-file woo_gshopping.log
```

**Added --use-proxy flag** for Brightdata residential proxy support:
```bash
python3 ingest_woo_gshopping.py \
    --gshopping-feeds https://example.com/feed.xml \
    --use-proxy
```

### Google Shopping Feeds - BLOCKED

**Tested 50+ feed URLs. All blocked:**

| Retailer | Status | Reason |
|----------|--------|--------|
| monoprice.com | 403 | Bot protection (Cloudflare) |
| anker.com | 404/502 | Feed doesn't exist / proxy blocked |
| leatherman.com | 404 | Feed doesn't exist |
| homedepot.com | 403 | Bot protection |
| lowes.com | 403 | Bot protection |
| walmart.com | 200 (HTML) | Bot protection / wrong content |
| target.com | 429/404 | Rate limited / feed doesn't exist |
| rei.com | 403 | Bot protection |
| bestbuy.com | 403 | Bot protection |
| and 40+ more... | various | All blocked |

**Root cause:**
1. Most retailers don't publish public Google Shopping feeds
2. Those that do protect them with Cloudflare/Perimeterx/bot detection
3. Even Brightdata residential proxies don't bypass Cloudflare's Advanced Bot Protection
4. Google Merchant Center feeds require authenticated merchant access

**Feeds file updated:** `feeds_gs.txt` contains detailed test results

### What Was Done

1. **Pipeline script enhanced** - Added `--use-proxy` flag for Brightdata proxy support
2. **feeds_gs.txt updated** - Documented all tested feeds and their status
3. **woo_gshopping.log appended** - New runs logged
4. **Verified end-to-end** - 78 products from nuvanta.com.sg successfully ingested

### Blocker: Google Shopping Feed Access

**Options to unblock:**
1. Find retailers that actually host public, accessible Google Shopping feeds
2. Access via Google Merchant Center API (requires merchant authentication)
3. Use Brightdata's Web Unlocker service (designed for this use case)
4. Use a different product data source (scrapers, affiliate networks)

### Next Steps

1. **WooCommerce expansion** - Add more WooCommerce stores (nuvanta working as proof-of-concept)
2. **Find accessible Google Shopping feeds** - Need to discover retailers with open feeds
3. **Consider alternative data sources** - Scrapers or affiliate networks may provide more reliable access

### Files Modified

- `ingest_woo_gshopping.py` - Added proxy support
- `feeds_gs.txt` - Updated with test results
- `woo_gshopping.log` - New runs appended

### Verification

Run the pipeline:
```bash
cd /home/paperclip/buywhere-api
python3 ingest_woo_gshopping.py --woo-stores nuvanta.com.sg --scrape-only
```

Expected output: `scraped=78, ingested=0 (scrape-only mode)`