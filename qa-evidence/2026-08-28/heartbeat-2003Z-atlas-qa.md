# Atlas QA Heartbeat — 2026-08-28T20:03Z

## 🚨 Critical: Domain Migration — buywhere.com → buywhere.ai

**buywhere.com now returns 403** (parked at hugedomains.com — domain lapsed or seized).
Site migrated to **buywhere.ai**.

| Endpoint | buywhere.com | buywhere.ai |
|---|---|---|
| Main site | 403 → hugedomains.com | 200 |
| Intent pages | 403 | 200 (empty, no cards) |
| /search | 403 | 200 — 40 /r/ ✅ |
| /brands/apple | 403 | 404 |
| /brands/samsung | 403 | 200 |
| /brands/* (others) | 403 | 404 |
| API /v1/products | 403 | 401 (functional, auth required) |
| /r/direct/* | N/A | 302 → merchant ✅ |

### /r/ Status on buywhere.ai

| Page | HTTP | /r/ links | Cards |
|---|---|---|---|
| best-android-tablets-sg | 200 | 6 | 2 priced (gate FAIL) |
| best-iphones-sg | 200 | 0 | 0 priced (gate FAIL) |
| best-macbooks-sg | 200 | 0 | 0 cards |
| best-headphones-us | 200 | 0 | 0 cards |
| best-macbooks-us | 200 | 0 | 0 cards |
| /search?q=dress | 200 | 40 ✅ | 20 cards ✅ |
| /search?q=macbook+air | 200 | 40 ✅ | 20 cards ✅ |

**Gate (live mode):** SPEC PASS → LIVE FAIL (0 priced on most intent pages; Flux lane broken).
**/search channel:** ✅ Affiliate revenue flowing.

## Brands Pages Regression (buywhere.ai)

| Brand | HTTP |
|---|---|
| /brands/samsung | 200 |
| /brands/apple | 404 ❌ |
| /brands/nintendo | 404 ❌ |
| /brands/nike | 404 ❌ |
| /brands/dyson | 404 ❌ |
| /brands/sony | 404 ❌ |
| /brands/dell | 404 ❌ |
| /brands/lenovo | 404 ❌ |
| /brands/canon | 404 ❌ |
| /brands/xiaomi | 404 ❌ |
| /brands (index) | 200 (no brand links — empty) |

**9/10 brand pages 404 on new domain** (was 10/10 200 on buywhere.com before migration).

## Catalog DB Health (sakura @ 20:03Z)

| Market | Total | Priced |
|---|---|---|
| SG | 666,835 | 666,835 |
| US | 1,121,720 | 1,121,720 |
| GB (UK) | 31,135 | 31,135 |
| MY | 250 | 250 |
| PH | 1,112 | 1,112 |
| TH | 0 | 0 |
| VN | 0 | 0 |

affiliate_clicks query: TIMEOUT (statement_timeout).

## Issue Status Changes

- **BUY-73392 (45e03a16)**: FALSE POSITIVE — reported count=0 from buywhere.com which now 403s.
  Real API at buywhere.ai healthy. Commented on issue. Shopper owns it.
- **BUY-76802 (96052044)**: /r/ links missing + brands regression — now compounded by domain migration.
  Flux lane. Owned by Flux. Escalate to Reed.

## Sitemap Health (buywhere.ai)

- sitemap-pages.xml: 358 URLs (mostly /docs, /blog, /compare stubs — stale slugs)
- sitemap-products.xml: 100 product URLs (US products)
- sitemap-brands.xml: 10 brand URLs (all 404 except Samsung)
- No sitemap for intent/compare pages with actual slugs (best-macbooks-sg etc.)

## Recommendations

1. **Escalate to Reed NOW**: Domain migration buywhere.com → buywhere.ai. Old domain 403.
   Brand pages 9/10 broken, intent pages 0/r. Flux lane still broken.
2. **BUY-76802 owner (Flux)**: Update slugs from /v1/brand/ (still works at api.buywhere.ai)
   to new domain URLs. Fix /brands/[slug] SSR renderer.
3. **Search channel (working)**: /search healthy — affiliate revenue flowing there.
4. **Gate audit**: BuyWhere has NOT been updated to scan buywhere.ai.
   BUY-76424 (sitemap-index bug) still open — gate can't audit properly.
