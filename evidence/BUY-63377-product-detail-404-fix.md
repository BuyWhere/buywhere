# BUY-63377 — product detail 404 fix evidence

Date: 2026-07-29

## Root cause

The middleware guard removal only changed the response from 410 to the application not-found page. The degraded search fallback emits name-only URLs such as `/products/us/macbook-air-13-m3`, but `resolveUSProductRoute` only resolved catalog IDs and ID-suffixed slugs. The route also depended on a catalog-wide list request that can time out and return an empty list.

## Fix

- Resolve name-only US product slugs through the site's authenticated `/api/products/search` proxy.
- Select a real matching catalog row with image, non-null price, merchant destination, and the requested name tokens.
- Carry that matched offer into SSR so the page immediately renders product content instead of refetching and replacing it with an error state.
- Cache route resolution across metadata and page rendering.
- Support merchants outside the four hard-coded retailer styles.
- Make affiliate UTM generation deterministic during SSR and hydration.

Changed files:

- `src/lib/us-product-route.ts`
- `src/app/products/us/[slug]/page.tsx`
- `src/components/USProductDetail.tsx`
- `src/components/AffiliateLink.tsx`

## Verification

Run-owned scratch app built from `origin/main` plus the four changed files, with the repository `app/` Python package removed per the project verify instructions.

Focused TypeScript check: passed for all changed files and direct dependencies.

Playwright, desktop 1440x1000 and mobile 390x844:

- URL: `/products/us/macbook-air-13-m3`
- HTTP: 200
- Title/H1: `Apple Macbook Air M3 13`
- Product-not-found content: absent
- Product image: loaded (`naturalWidth` 256 desktop / 390 mobile)
- Price: `$1,787.30`
- Buy CTA: `View on shopify_buy30620_crate`
- Buy destination: catalog affiliate redirect for product `370532494`
- Horizontal overflow: none at either viewport

Regressions:

- Unknown US slug still renders `Product Not Found`.
- SG one-segment route remains 410 and is unchanged.

Artifacts were captured under the run-owned `PAPERCLIP_RUN_SCRATCH_DIR`:

- `BUY-63377-desktop.png`
- `BUY-63377-mobile.png`
- `BUY-63377-playwright-report.json`

Known unrelated local-dev noise: cross-market widget requests to `api.buywhere.ai` are CORS-blocked from `127.0.0.1`; this does not affect the verified product image, price, or buy CTA and does not occur from the production origin.
