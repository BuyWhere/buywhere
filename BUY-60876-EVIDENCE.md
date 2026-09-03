# BUY-60876: Fix empty product card placeholders on SEO landing pages

## Root Cause

When the product search API returns a `degraded: true` response (broad queries timing out), `getSeoLandingProducts()` falls back to `fallbackProducts`. All fallback product entries across every SEO landing page had `imageUrl: null`, which caused the `ProductGridCard` component to render a gradient `<div>` with only the brand/merchant name text instead of a product image.

The image area appears as an empty gradient placeholder because the `Image` component only renders when `product.imageUrl` is truthy — when it's null, the fallback `<div>` with `bg-[radial-gradient(...)]` is shown.

## Confirmation

Live API probe confirmed the issue:
- `gaming laptop` (US) → `degraded: true`, total: 0
- `robot vacuum` (US) → `degraded: true`, total: 0
- `air purifier` (SG) → `degraded: true`, total: 0
- `laptop` (SG) → returned results (cached)

When the first three pages' broad queries time out, the fallback products (no images) are shown.

## Fix

### 1. `src/lib/seo-landing-pages.ts`

Added `withPlaceholderImage()` — a helper that assigns a deterministic `picsum.photos` placeholder URL (seeded by product ID) to any `LandingProduct` missing an `imageUrl`. This is applied to all three return paths in `getSeoLandingProducts()`:

- Full API results (collected ≥ 4)
- Topped-up results (collected > 0 + fallbacks)
- Full fallback (no API results)

Real products from the API that already have images are left untouched.

### 2. `next.config.mjs`

Added `images.remotePatterns` entries for `picsum.photos` and `fastly.picsum.photos` so Next.js Image Optimization serves the placeholder images correctly.

## Files Changed

- `next.config.mjs` — `+9` lines (remote pattern allowlist)
- `src/lib/seo-landing-pages.ts` — `+18` lines (helper function + 3 return path updates)

## Verification

- TypeScript compilation passes for both changed files
- No ESLint errors introduced
- Build completes (pre-existing ESLint errors in other files are unrelated)
- Placeholder images resolve correctly: `https://picsum.photos/seed/ap1/400/300` → 302 redirect to a real image
