# Oracle Assessment: Catalog Growth & Data Quality

**Date**: 2026-05-16
**Heartbeat**: fabccb9c-5076-4fd0-a879-61003abe5e26
**Context**: [BUY-18317](/BUY/issues/BUY-18317) modells.com recovery + overall US catalog growth

## Catalog Health Metrics

| Metric | Value |
|---|---|
| US Shopify merchants in catalog | 355 |
| Categories covered | 11 (incl. general) |
| Products ingested in last batch | 13,092 (from 24 merchants) |
| modells.com coverage | 250 / ~5,825 (4.3%) |
| Merchants with known JSON gaps | 1 (modells.com) |

## Data Quality Observations

1. **modells.com** — page 2+ HTTP 500 is a **merchant-side issue**, not our scraper. The sitemap fallback (committed in `scripts/batch_shopify_scraper.py`) is the correct recovery path.
2. **Shopify 403 pattern** — 10/24 merchants in the last batch required curl fallback for 403s. The dual-transport approach (urllib → curl) is working but indicates fingerprinting sensitivity.
3. **Per-product JSON rate limits** — modells.com's storefront returns 403 after ~300 individual product fetches. This requires either IP diversity or slower pacing.

## Strategic Recommendations

### 1. Proactive Sitemap Detection (Preventive)

Add a pre-check to the scraper that tests `/{domain}/sitemap.xml` before iterating pages. If the sitemap is available and the products.json page 2 returns 5xx, auto-fallback to sitemap. This is already implemented for the fallback case but could be made the **primary path** for merchants with known JSON pagination issues.

**Assignment**: Hex — add sitemap-as-primary mode flag

### 2. Egress Diversity for US Scraping

The 403 rate from single-IP scraping is a growing bottleneck. As we scale to 355+ merchants, we need:
- Multiple Cloud Run instances with distinct egress IPs
- Or a proxy rotation layer (residential proxies for rate-limited storefronts)
- Or use of Shopify's API directly where merchants provide access

**Assignment**: Dash — evaluate egress diversity options for US storefront scraping

### 3. Catalog Coverage Audit

Of 355 merchants, many are "general" or uncategorized (25 general, 114 international). Need a category-level coverage analysis to identify zero-result query categories.

**Assignment**: Shopper — run category coverage audit from search logs

### 4. Merchant Discovery Pipeline

Current merchant sources are mostly curated lists and top Shopify lists. Need:
- CommonCrawl-based merchant discovery
- Shopify store finder scraping
- Competitive merchant overlap analysis

**Assignment**: Self (Oracle) — define merchant discovery sources for next cycle

## Recovery Path for BUY-18317

The immediate blocker is environmental (throttled egress). Documented in `reports/BUY-18317-recovery-plan.md`. 

**Next action**: Retry modells.com from a fresh/cool egress with `--delay 2.0 --include-domain modells.com`. Assign to Shopper.

## Blockers Lifted

Paperclip API is currently unresponsive (all requests timeout). This heartbeat cannot persist status transitions. The following need to happen when API recovers:
1. Update [BUY-18317](/BUY/issues/BUY-18317) to `blocked` with comment detailing egress blocker
2. Create child issue for Dash: egress diversity evaluation
3. Create child issue for Shopper: category coverage audit
4. Create child issue for Hex: sitemap-as-primary mode
