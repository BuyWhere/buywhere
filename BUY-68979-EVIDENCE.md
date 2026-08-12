# BUY-68979: Sitemap Alias and Best/Cheapest Sub-Route 404 Shell Fix

**Date**: 2026-08-12  
**Agent**: Surf (90688cb2)

## Problem

The following routes returned HTTP 404 with homepage metadata instead of route-specific handling:

- `/sitemap-shops.xml`, `/products/sitemap.xml`, `/shops/sitemap.xml`
- `/best/sg`, `/best/us`, `/best/electronics`, `/best/fashion`, `/best/home-living`
- `/cheapest/sg`, `/cheapest/us`, `/cheapest/electronics`

`/sitemap-products.xml` also returned HTTP 200 with empty XML when the product API returned no entries.

## Root Cause

- Sitemap alias paths had no route handlers, so they fell through to generic 404 handling.
- One-segment `/best/*` and `/cheapest/*` paths were unsupported. Existing middleware only handles two-segment intent URLs: `/best/{query}/{location}` and `/cheapest/{query}/{location}`.
- `sitemap-products.xml` rendered an empty `<urlset>` when `getProductSitemapEntries()` returned `[]`.

## Fix Applied

- Added sitemap alias route handlers:
  - `/sitemap-shops.xml` → canonical merchant sitemap handler
  - `/products/sitemap.xml` → canonical product sitemap handler
  - `/shops/sitemap.xml` → canonical merchant sitemap handler
- Added one-segment unsupported route shells:
  - `/best/[category]` returns 404 via `notFound()` with route-specific `Page Not Found: /best/{category} — BuyWhere` metadata and `robots.index=false`
  - `/cheapest/[product]` returns 404 via `notFound()` with route-specific `Page Not Found: /cheapest/{product} — BuyWhere` metadata and `robots.index=false`
- Updated `/sitemap-products.xml` to return HTTP 503 with `Cache-Control: no-store` when no product URLs are available, preventing empty 200 responses.

## Files Changed

- `src/app/sitemap-shops.xml/route.ts`
- `src/app/products/sitemap.xml/route.ts`
- `src/app/shops/sitemap.xml/route.ts`
- `src/app/best/[category]/page.tsx`
- `src/app/cheapest/[product]/page.tsx`
- `src/app/sitemap-products.xml/route.ts`

## Verification

- `node_modules/.bin/tsc --noEmit | grep -E "sitemap-shops|sitemap-products|products/sitemap|shops/sitemap|best/\\[category\\]/page|cheapest/\\[product\\]/page"` → no errors for changed route files.
- Full `node_modules/.bin/tsc --noEmit` still fails on pre-existing unrelated test/type issues, including `SearchResultsClient.categoryMismatch.test.ts` missing `href` and missing Jest/testing-library types.
- `npm run build` reaches `Compiled successfully`, then fails during existing lint checks (unused vars in unrelated files).
- Local dev HTTP smoke could not complete in this sandbox because Next middleware edge-runtime cache hits `EvalError: Code generation from strings disallowed for this context`; this is unrelated to the changed routes.
