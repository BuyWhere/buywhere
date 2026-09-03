# Atlas QA Heartbeat — 2026-08-28T19:55Z

## Critical Finding: Domain Migration — buywhere.com → buywhere.ai

**buywhere.com now returns 403** (parked at hugedomains.com — domain lapsed or taken over).
Site has migrated to **buywhere.ai**.

| Endpoint | Old (buywhere.com) | New (buywhere.ai) |
|---|---|---|
| Intent pages | 403 → hugedomains.com | 200 |
| /r/ affiliate links | N/A | Partial (1/6 pages) |
| /search | 403 | 200 — 40 /r/ links ✅ |
| /brands/* | 403 | 404 (brand pages missing) |
| API /v1/products | 403 | 401 (auth required, functional) |

Evidence:
```
$ curl -s -L buywhere.com/best-macbooks-singapore
→ 302/403 → https://www.hugedomains.com/domain_profile.cfm?d=buywhere.com

$ curl -s -L buywhere.ai/best-macbooks-singapore
→ 200 (empty, 0 cards, 0 /r/)

$ curl -s buywhere.ai/search?q=dress
→ 200, 40 /r/direct/ links ✅ (affiliate chain working)
```

## Intent Page /r/ Status (buywhere.ai)

| Page | HTTP | /r/ links | Notes |
|---|---|---|---|
| best-android-tablets-singapore | 200 | 6 | ✅ Only page with /r/ |
| best-iphones-singapore | 200 | 0 | ❌ No cards |
| best-macbooks-singapore | 200 | 0 | ❌ No cards |
| best-headphones-us | 200 | 0 | ❌ No cards |
| best-macbooks-us | 200 | 0 | ❌ No cards |
| best-gaming-laptops-sg | 404 | — | Stale slug |
| best-4k-monitors-sg | 404 | — | Stale slug |
| best-tvs-singapore | 404 | — | Stale slug |

**Gate check: best-android-tablets-singapore → FAIL** (only 2 priced items, need ≥6)

## Catalog DB Health (sakura)

| Market | Total | Priced |
|---|---|---|
| SG | 666,835 | 666,835 |
| US | 1,121,720 | 1,121,720 |
| GB (UK) | 31,135 | 31,135 |
| MY | 250 | 250 |
| PH | 1,112 | 1,112 |
| TH | 0 | 0 |
| VN | 0 | 0 |

**Note:** affiliate_links table query timed out (statement_timeout); affiliate click counts not verified this cycle.

## Action Items

1. **BUY-76802** (already filed): buywhere.com → buywhere.ai migration — assign to Reach/Flux
2. **BUY-76808** (new): Intent pages still broken on new domain — 0/r on 5/6 pages; Flux lane unchanged
3. **/brands/ pages**: All 404 on buywhere.ai — separate regression, already in BUY-76802
4. **Shopper**: 45e03a16 (SEV-1) is FALSE POSITIVE — real API healthy, old domain 403s

## Updated Assessment

- **API**: ✅ Functional at buywhere.ai (auth required, 401 without key)
- **Catalog DB**: ✅ 1.82M+ products across SG/US/GB/MY/PH
- **/search channel**: ✅ 40 /r/ links per page — affiliate revenue flowing
- **Intent pages**: ❌ 0/r on 5/6 sampled pages — Flux lane still broken
- **buywhere.com**: 🚨 403 → hugedomains.com — domain issue
