# BUY-75133 — /brands/{slug} soft-404 fix (Pixel, in_progress)

**Branch:** `fix/buy-75133-brands-soft-404` @ `c4015bf9bf910e56c18f638c67778f740df856f0`
**Base:** `origin/main` @ `028315ea`
**Status:** in_progress (work staged unmerged; awaiting SEO-GATE: approval + deploy freeze lift)
**Parent:** BUY-75115 (done)
**Child (SEO-GATE:):** BUY-75146

## Diagnosis

The `/brands/{slug}` page handler in `src/app/brands/[slug]/page.tsx` calls `notFound()` when `/api/v1/brand/{slug}` returns 404, but Next.js 14.2.35 App Router streams the not-found shell as **HTTP 200** with `<title>Brand Not Found</title>` + `robots: noindex` (the same soft-404 anti-pattern BUY-71642 fixed for `/p/{id}`).

sitemap-brands.xml advertises **10 brand slugs** (`commerceBrands` in `src/lib/commerce-routes.ts`):
`apple, samsung, sony, nike, dyson, nintendo, dell, lenovo, canon, xiaomi`

Verified live (2026-08-25T20:37Z) — all 10 return HTTP 200 + `<title>Brand Not Found</title>` + `robots noindex` + no canonical + no JSON-LD. Upstream `/v1/brand/{slug}` returns **404** for every one (catalog has no brand rows).

## Fix (2 files, +50/-14)

### 1. `src/middleware.ts` (+38 lines)

Adds a `/brands/{slug}` hard-404 gate right after the existing `/p/{id}` gate (BUY-71642 pattern). Mirrors the same transient-failure fall-through so a 429 rate-limit on the upstream API does NOT 404 the entire brand surface.

```ts
const brandsSlugMatch = /^\/brands\/([^/]+)\/?$/.exec(pathname);
if (brandsSlugMatch) {
  const slug = brandsSlugMatch[1];
  try {
    const apiRes = await fetch(
      `${process.env.BUYWHERE_API_INTERNAL_URL || "https://api.buywhere.ai"}/v1/brand/${encodeURIComponent(slug)}`,
      { headers: { Accept: "application/json", Authorization: `Bearer ${process.env.BUYWHERE_API_KEY || ""}` }, signal: AbortSignal.timeout(3000) }
    );
    if (apiRes.status === 404) {
      return new NextResponse(null, { status: 404, statusText: "Brand Not Found", headers: { "X-Robots-Tag": "noindex, nofollow" } });
    }
  } catch { /* network error — fall through */ }
}
```

### 2. `src/app/sitemap-brands.xml/route.ts` (+12/-14 lines)

Replaces `commerceBrands.map(...)` with `renderUrlSet([])`. Drops the 10 placeholder slugs. Empty `<urlset/>` is the honest signal until the catalog exposes real brand data.

## Build

`next build` PASS, middleware bundle 29.1 kB.

## Verifier

`data/BUY-75133-verifier.mjs` (committed in the branch):

```
# Pre-deploy baseline @ 2026-08-25T21:09Z
## /v1/brand/{slug} probe
  apple      404
  samsung    404
  sony       404
  nike       404
  dyson      404
  nintendo   404
  dell       404
  lenovo     404
  canon      404
  xiaomi     404
Expected: 10/10 status=404   Actual: 10/10 status=404

## sitemap-brands.xml probe
  status=200 size=1893B urlCount=10    (PRE-DEPLOY)
## control: real product page still 200
  /p/616638515 status=200
```

Verifier expected to PASS post-deploy (urlCount=0; /brands/{slug} → 404 hard).

## Why in_progress (not done)

1. **Directive §9 (hard):** `src/middleware.ts` redirect/404 logic is FROZEN. Changes need `SEO-GATE:` ticket prefix + Richmond approval. Current ticket title is "[Pixel] Fix /brands/{slug}..." (not SEO-GATE:). Filed child SEO-GATE ticket **BUY-75146** with the §7 evidence for Richmond's decision.
2. **Deploy freeze (BUY-74991 SEV-1):** MCP search backend at 95% api_error/timeout; Reach batched deploys frozen. Even with SEO-GATE approval, merge blocks until search smoke green (per BUY-74928/74947 pattern, `deploy-www` would auto-rollback).
3. **Sitemap URL-count decrease (rule 3):** 10 → 0 violates "sitemaps may only grow". The decrease is corrective (removes soft-404 URLs that violate rule 8), but still a decrease needing Richmond's exception confirmation.

## Unblock path

1. Richmond approves branch via BUY-75146 (or re-titles parent) with §7 evidence.
2. BuyWhere merges + deploys once BUY-74991 search smoke green.
3. Post-deploy: re-run `node data/BUY-75133-verifier.mjs` → expect urlCount=0 + each /brands/{slug} 404 hard + /p/616638515 still 200.
4. Then PATCH BUY-75133 → done.

## Cross-references

- Parent: BUY-75115 (done) — Surf validated live soft-404 pattern
- Pattern source: BUY-71642 (`/p/{id}` gate this mirrors)
- Child (SEO-GATE:): BUY-75146 (in_progress)
- Directive: `/home/paperclip/ops-canon/DIRECTIVE-indexation-2026-08-25.md` §8 + §9
- Verifier: `data/BUY-75133-verifier.mjs` in branch
- Comment on parent: `a48840b3-1089-4a29-9e93-5b0b9a03133b` (2026-08-25T21:09Z)