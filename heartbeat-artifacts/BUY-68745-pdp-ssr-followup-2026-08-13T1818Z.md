# BUY-68745 PDP SSR production follow-up — 2026-08-13T18:18Z

Issue: d01998b7-8924-4e54-83bd-8d6e42dd9a20 (`[Surf] Production still fails BUY-68745 PDP SSR/schema acceptance on sitemap-listed US products`)

## Production re-check before patch

URL: `https://buywhere.ai/products/us/broadcloth-long-sleeve-shirt-1152920887995236468`

Observed live production:
- HTTP 200
- `h1_count=0`
- `jsonld_count=0`
- no `Product` JSON-LD
- `og:type=website`
- `og:image=https://buywhere.ai/og-image.png`
- visible text still chrome/newsletter/API-key copy only
- response served by `server: railway-hikari`

## Local patch prepared

Changed only:
- `src/app/products/us/[slug]/page.tsx`
- `src/components/USProductDetail.tsx`

Patch behavior:
1. Server route now reads server-only `BUYWHERE_API_KEY` before falling back to `NEXT_PUBLIC_BUYWHERE_API_KEY` for SSR API fetches.
2. If the sitemap resolver succeeds but `/matches` cannot provide usable offer rows, the route still passes an honest SSR fallback product to `USProductDetail`.
3. The fallback emits a product-name H1, product description, product specs, and Product JSON-LD through the existing component render path.
4. The client-side refresh no longer replaces valid SSR fallback content with the not-found/error shell when the public browser API key is absent.
5. Product metadata now uses a route-specific `/api/og-image?title=<product>` URL for OG/Twitter image fields instead of hardcoding `/og-image.png`.
6. Added `BuyWhere Catalog` styling to the merchant-card map to prevent fallback rendering from crashing.

## Verification

- `npm run build` compiled the app successfully through `Creating an optimized production build`.
- Build then failed during lint/type validation on pre-existing unrelated errors:
  - `src/app/health/route.ts`: `_request` unused
  - `src/app/search/SearchResultsClient.tsx`: `text` unused
  - `src/components/PlatformComparisonBadge.tsx`: `PriceComparisonRowSkeleton` unused
  - `src/lib/seo-landing-pages.ts`: `imageUrl`, `isUsableProductImage` unused
- Full `npx tsc --noEmit --pretty false` is also blocked by existing test-runner type gaps (`jest`, `describe`, Testing Library) in test files.

## Caveat / remaining action

This workspace branch is `surf/BUY-69024-feed-aliases` and already contains many unrelated modified/untracked files, so I did not create a commit or PR from this polluted branch. The two-file patch is ready for integration from a clean branch and then deployment to `https://buywhere.ai`.
