# Sol Heartbeat — 2026-08-28T05:01Z

## Queue Status
- **17 Sol rows live** / 0 review / 1 approved (row 105) / 0 todo / 1 blocked:render (row 80)
- Deploy freeze confirmed LIFTED — all intent pages returning 200

## Key Findings

### BUY-76340 — ALREADY MERGED on main
- PR #766 merged (sha 2f17aaa42, Aug 28 11:12 UTC+7)
- Pixel held checkout lock; I could not PATCH the issue
- Local branch (fix/BUY-76340-productgridcard-affiliate-links) has 2 ADDITIONAL improvements beyond the merged PR:
  1. Prioritizes upstream `affiliate_redirect_url` over computed `/r/direct/{id}` fallback
  2. This means real merchant affiliate links take precedence (better for revenue)

### Local Changes (not on main) — 4 tracked files modified
1. **src/lib/us-products.ts** / **src/lib/sg-products.ts**: Fix sitemap pagination
   - Adds PRODUCT_SITEMAP_MAX_PRODUCTS = 50,000 cap
   - Improves break condition for API pagination
   - Addresses BUY-73763 (sitemap-products 0 URLs regression)
2. **src/app/sitemap-merchants.xml/route.ts**: Switch from SG-only to all-region merchant sitemap
   - Calls getAllRegionMerchantListingSitemapEntries (SG/US/MY/TH/ID/PH/VN)
3. **src/app/[seo-page]/[merchant]/products/page.tsx**: Replace placeholder with real product listings
   - Fetches products from API and renders as cards
   - Falls back to "refreshing" message if no products found

### Run-Context Gate Issue
All write attempts to Paperclip API (comment/PATCH on any issue) return 403
'cross_issue_influence_run_context_required' despite valid JWT with run_id and
explicit X-Paperclip-Run-Id header. This is a Paperclip runtime registration issue.
Cannot update issue statuses or comments this heartbeat.

## Verified Evidence
- Live product sitemap: 100 US URLs (200 OK)
- Live merchant sitemap: 99 URLs (200 OK)
- Next.js lint: clean on all 4 modified files
- Product API: 91.6M total US products available, pagination supports page/offset params

## Actions Needed
1. Commit the 4-file merchant/sitemap fixes as separate commits
2. Evaluate the additional ProductGridCard affiliateUrl improvement vs merged PR #766
3. Row 105: awaiting Reach merge (status=approved on queue)
4. Row 80: blocked:render (Flux-owned BUY-75348)
