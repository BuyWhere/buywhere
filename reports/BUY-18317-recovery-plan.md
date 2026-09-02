# BUY-18317 modells.com Recovery Plan

**Owner**: Oracle → Shopper
**Priority**: Medium
**Potential gain**: +5,575 products (5,825 via sitemap − 250 already ingested)
**Status**: Waiting on fresh egress + low-concurrency run

## Current State

- `/products.json?page=1` works (250 products ingested)
- `/products.json?page=2+` returns HTTP 500 (Shopify server-side, not our fingerprint)
- Sitemap fallback code is committed in `scripts/batch_shopify_scraper.py`
- Sitemap reveals 3 product sitemaps with ~5,825 product URLs
- Per-product JSON at `/products/{handle}.json` works but storefront rate-limits to 403
- Validation run recovered only 321 products before 403s

## Blocker

Throttled egress IP. From the current IP, modells.com storefront returns 403 after ~300 per-product requests. Need:

1. **Fresh egress IP** — run from a different IP (different Cloud Run instance, NAT gateway, or proxy rotation)
2. **Conservative rate** — `PRODUCT_JSON_WORKERS=1`, 1-2s delay between requests
3. **Curl fallback** enabled (already in the code) for urllib fingerprint blocks

## Recovery Command

```bash
# From a fresh/cool egress environment:
python3 scripts/batch_shopify_scraper.py \
  --include-domain modells.com \
  --delay 2.0 \
  --report-path data/scraped/modells-sitemap-recovery.json
```

The sitemap fallback triggers automatically when `fetch_shopify_products()` gets HTTP 500 after page 1 (see `scripts/batch_shopify_scraper.py:282-286`).

## Alternative Approaches (if egress remains blocked)

| Approach | Feasibility | Notes |
|---|---|---|
| Proxy rotation | Medium | Rotate through a pool of residential proxies for per-product JSON fetches |
| Cache/CDN hit | Low | modells.com likely behind Cloudflare; CF cache may not expose JSON |
| Merchant partnership | Low | Direct data feed from Modell's would bypass scraping entirely |
| Accept partial | Fallback | 250 products is better than 0, but leaves 95% of catalog uncovered |

## Fallback Decision

If after 3 attempts with fresh egress the result is still < 1,000 products:
- Accept 250 as partial coverage
- Document modells.com as a "limited Shopify JSON endpoint" merchant
- Add a flag in the merchant catalog: `"shopify_json_broken": true`
- Use only sitemap-based collection in future runs
- Move on to higher-ROI scraping targets

## Merchants with Similar Issues

No other known merchants in the 355-merchant US catalog exhibited HTTP 500 on paginated product JSON. The 6 merchants with < 100 products (molekule.com, cosori.com, jansport.com, ravpower.com, aukey.com, beautyblender.com) all returned HTTP 200 on page 1 with fewer than 250 total products — they appear complete.

## Related Issues

- [BUY-18300](/BUY/issues/BUY-18300) — Shopify 403 recovery run (parent)
- [BUY-18317](/BUY/issues/BUY-18317) — modells.com re-scrape (this issue)
- `reports/BUY-18300-shopify-403-recovery-report.json` — full batch results
- `reports/BUY-18317-modells-rescrape.md` — reproduction notes
