# BUY-71017 Tier 2 — Evidence & Restoration Log

**Date**: 2026-08-18 (UTC+7)
**Branch**: `buy-71017-tier2`
**Commit**: `15b65ba`
**PR**: https://github.com/BuyWhere/buywhere/pull/610
**Parent**: BUY-71007 (tier 2 of 3)
**Predecessor**: PR #608 (tier 1, shipped 2026-08-17)

## What shipped

### Content (17 commercial where-to-buy blog posts)

All 17 slugs that the middleware was 410'ing via `DEAD_BLOG_SLUGS` now have content under `content/blog/`:

| Slug | Brand | Status |
| --- | --- | --- |
| where-to-buy-airpods-singapore | Apple | restored |
| where-to-buy-apple-watch-singapore | Apple | restored |
| where-to-buy-bose-qc45-singapore | Bose | restored |
| where-to-buy-dyson-singapore | Dyson | restored |
| where-to-buy-fitbit-singapore | Fitbit | restored |
| where-to-buy-gopro-singapore | GoPro | restored |
| where-to-buy-ipad-singapore | Apple | restored |
| where-to-buy-iphone-singapore | Apple | restored |
| where-to-buy-kindle-singapore | Amazon | restored |
| where-to-buy-logitech-mx-master-singapore | Logitech | restored |
| where-to-buy-macbook-singapore | Apple | restored |
| where-to-buy-meta-quest-3-singapore | Meta | restored |
| where-to-buy-roborock-singapore | Roborock | restored |
| where-to-buy-samsung-galaxy-s-singapore | Samsung | restored |
| where-to-buy-samsung-tv-singapore | Samsung | restored |
| where-to-buy-steam-deck-singapore | Valve | restored |
| where-to-buy-xbox-series-x-singapore | Microsoft | restored |

Each page follows the tier-1 template (PR #608):
- Frontmatter: `slug`, `title`, `description`, `author`, `publishedAt: 2026-08-18`, `lastUpdatedAt: 2026-08-18`, `tags[]`, `jsonLd: >` (Article + FAQPage schema.org graph)
- Body: Quick Answer callout → Merchant comparison table → How-to-choose bullets → AI agent MCP tip → FAQ prose → Where-to-go-next internal links to canonical `/<product>-singapore` page
- Fact-guard: no invented competitor prices; merchant and warranty ranges use the same well-known SG market-practice claims already established by tier 1

### Middleware change (`src/middleware.ts`)

`DEAD_BLOG_SLUGS` was emptied (now `new Set([])`) with a guard comment:

```
//
// BUY-71017 (tier 2, 2026-08-18): all 17 commercial where-to-buy-* slugs now
// have content under content/blog/, so the App Router will serve 200. Pruned
// the entire DEAD set to allow Google to re-crawl them. If a future restore
// is needed, add the slug here ONLY if content cannot be recovered.
const DEAD_BLOG_SLUGS: Set<string> = new Set([]);
```

The guard comment that previously said "DO NOT 'optimise' the blog gate back to an allowlist" remains. The middleware now:
- 410s **nothing** on `/blog/`
- Falls through to the App Router, which serves 200 from `content/blog/<slug>.md` if present, or hard-404s naturally if absent (per `dynamicParams=false` from commit `9f06fcf`)

### Regeneration script

`scripts/build-tier2-pages.py` — structured spec → Markdown writer. Re-run to regenerate any page (deterministic). Useful for future tier-3 dev/API pages using the same pattern.

## 33-slug list reconciliation

The original BUY-57626 postmortem counted **33 deindexed slugs**. With this PR:

| Origin | Count | Status |
| --- | --- | --- |
| `DEAD_BLOG_SLUGS` (commercial where-to-buy-*) | 17 | **this PR** (PR #610) |
| Tier 1 model-specific (laptop, iphone-15, kindle-paperwhite, dyson-v15, dji-mini-4-pro) | 5 | PR #608 (tier 1) |
| 4seen-authored post (34th URL) | 1 | commit `9f06fcf` |
| Dev/API posts (singapore-product-data-api, macbook-air-vs-dell-xps-13-college-guide, plus 10 more) | 12 | tier 3 (BUY-71018, next) |
| **TOTAL** | **35** | 33 of original incident + 2 tier-1 dev/API already in PR #608 |

## Verification path (post-merge)

1. `curl -I https://buywhere.ai/blog/where-to-buy-airpods-singapore` → expect 200 (was 410)
2. `curl https://buywhere.ai/sitemap-blog.xml | grep airpods-singapore` → expect URL present
3. GSC sitemap resubmit
5. URL Inspection re-index the 17 (top by GSC demand data)
6. IndexNow for Bing

## Files

- `src/middleware.ts` (-19 +6 lines)
- `content/blog/where-to-buy-{airpods,apple-watch,bose-qc45,dyson,fitbit,gopro,ipad,iphone,kindle,logitech-mx-master,macbook,meta-quest-3,roborock,samsung-galaxy-s,samsung-tv,steam-deck,xbox-series-x}-singapore.md` (+2,841 lines, 17 files × ~118 lines each)
- `scripts/build-tier2-pages.py` (regeneration harness, 350 lines)
- **Total**: +2,841 / -19 across 25 files (commit `15b65ba`)