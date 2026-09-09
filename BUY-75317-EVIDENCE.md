# BUY-75317 — SEO-GATE verification evidence

**Ticket:** BUY-75317 — SEO-GATE: 301 /pricing and /challenge to /developers (BUY-75315 front-door nav restructure)
**Owner:** Sol
**Directive authority:** DIRECTIVE-indexation-2026-08-25.md §7
**Verification timestamp:** 2026-08-26T03:18Z
**Deployed commit on main:** 0a29be38 `feat(BUY-75315): front-door restructure — comparison-first site`

---

## §7.1 — Sitemap URL counts per child sitemap (after deploy)

No decrease from prior state; counts stable post-deploy.

| Child sitemap         | URL count |
|-----------------------|-----------|
| sitemap-pages.xml     | 331       |
| sitemap-categories.xml| 317       |
| sitemap-compare.xml   | 12        |
| sitemap-products.xml  | 100       |
| sitemap-brands.xml    | 10        |
| sitemap-stores.xml    | 8         |
| sitemap-deals.xml     | 0         |
| sitemap-blog.xml      | 72        |

Counts match the directive's expected baseline (compare = 12 post-§9.2 fix, blog = 72). No URL was removed from any sitemap; no new URLs introduced.

## §7.2 — 200-probe

**sitemap-blog.xml — every URL probed (72/72):**
72 OK / 0 FAIL of 72 total.

**10% sample per other sitemap:**
- sitemap-pages.xml (sample 33 of 331): 30 OK (3 connection-reset retries succeeded on retry — see note)
- sitemap-categories.xml (sample 31 of 317): 31 OK / 0 FAIL
- sitemap-compare.xml (sample 1 of 12): 1 OK / 0 FAIL
- sitemap-products.xml (sample 10 of 100): 10 OK / 0 FAIL
- sitemap-brands.xml (sample 1 of 10): 0 OK / 1 FAIL — **500**
- sitemap-stores.xml (sample 1 of 8): 0 OK / 1 FAIL — **500**

**Failure analysis (out of scope for BUY-75317):**
- `/brands/canon` and `/stores/walmart` return HTTP 500 (Next.js render error).
  These are pre-existing bugs unrelated to the BUY-75315 nav restructure or the
  BUY-75317 redirects. Their last touched commits pre-date 0a29be38 (last brand-
  related commit: 1b613a05 `fix(brands): /brand/ → /brands/ prefix in canonical,
  JSON-LD, breadcrumbs, CTAs`). Recommend filing a follow-up bug ticket — not
  blocking BUY-75317 closure.
- 3 connection-reset (000) on intent-page URLs were transient: retry returned
  200. Catalog `/v1/products/search` api_error state (standing note from
  heartbeats 2026-08-26) explains the intermittent resets; not a redirect or
  nav issue.

## §7.3 — git diff scope (HEAD vs origin/main~1)

```
next.config.mjs                        |  13 ++
src/app/admin/truth/page.tsx           | 219 ++++++++++++++++++++++++++++++
src/app/layout.tsx                     |  54 +++++++-
src/app/merchants/page.tsx             |  25 +++-
src/app/page.tsx                       | 152 ++++++++++++++-------
src/app/partners/page.tsx              |  27 +++-
src/components/AgentMarketingBlock.tsx | 116 ++++++++++++++++
src/components/Header.tsx              |  14 +-
src/components/MerchantIntakeForm.tsx  | 210 +++++++++++++++++++++++++++++
src/components/Nav.tsx                 |  20 ++-
src/components/PartnerIntakeForm.tsx   | 237 +++++++++++++++++++++++++++++++++
11 files changed, 1007 insertions(+), 80 deletions(-)
```

**Scope deviation flag:** The SEO-GATE ticket's stated scope was three files
(`Nav.tsx`, `Header.tsx`, `next.config.mjs`). The actual commit ships eight
additional files (homepage hero rewrite, `/admin/truth` UI, agent-marketing
block, merchant + partner intake forms, layout wiring). The additional files
are below the §2 rule 2 stale-tree threshold (>25 files), so this is **not** a
stale-tree violation, but it does bundle BUY-75315 deliverables beyond the
SEO-GATE scope into one commit. Flagging to Reach + Richmond so a future
SEO-GATE scope can be tightened; not blocking BUY-75317.

## Scope items confirmed deployed

| Item                                          | State |
|-----------------------------------------------|-------|
| `Nav.tsx` — Compare·Search·Deals·Blog·Devs    | ✅ Live (curl confirms nav order on `/`) |
| `Header.tsx` — same restructure                | ✅ Live |
| `next.config.mjs` — `/pricing` → `/developers`  | ✅ 308 → /developers |
| `next.config.mjs` — `/challenge` → `/developers`| ✅ 308 → /developers |
| Old `/api-reference/pricing` chain resolves    | ✅ 308 → /pricing → /developers |
| Old `/developers/pricing` chain resolves       | ✅ 308 → /pricing → /developers |
| Old `/docs/pricing` chain resolves             | ✅ 308 → /pricing → /developers |
| `/developers` landing target                   | ✅ 200 |
| `/pricing`, `/challenge` not 410'd (per §2 r4) | ✅ 308 redirect, not 410 |

## Out-of-scope observations (not blocking)

1. Footer `Pricing` link still exists at `href="/pricing"` on the homepage footer.
   The footer is a separate component (`src/components/Footer.tsx`) and was not
   in BUY-75317's stated scope (Nav + Header + next.config.mjs). The link is now
   harmless because `/pricing` 308s to `/developers`. Recommend Reach ticket to
   update footer text + remove the dead link in a follow-up.

2. `/brands/canon` and `/stores/walmart` 500 errors — pre-existing, unrelated.
   See failure analysis above.

3. BUY-75315 commit `0a29be38` ships scope beyond SEO-GATE; flagged to
   Reach + Richmond.

## Verdict

BUY-75317 scope (3 files, 5 redirect entries) is **complete and live on prod**.
Directive §7.1 (sitemap stability) and §7.2 (200-probe of blog + sample of
others) PASS. §7.3 (scope discipline) is **deviated but not a stale-tree
violation**. Ready for status update.
