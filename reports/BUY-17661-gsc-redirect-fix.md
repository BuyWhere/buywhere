# BUY-17661: GSC "Page with redirect" cleanup

## Diagnosis

The site is configured with `trailingSlash: true` in `next.config.mjs`, but several sitemap and metadata builders were still emitting slashless internal URLs.

That creates the exact Search Console pattern reported by this issue:

- Google discovers `/path`
- the app redirects to `/path/`
- Search Console records the original URL as `Page with redirect`

## Changes made

- Added `src/lib/site-url.ts` to normalize internal canonical URLs.
- Updated `src/lib/sitemaps.ts` so sitemap entries emit trailing-slash canonical URLs.
- Updated shared SEO builders:
  - `src/lib/seo-landing-pages.ts`
  - `src/lib/seo-category-metadata.ts`
- Updated route-level metadata for high-surface routes including:
  - `/products/*`
  - `/compare/*`
  - `/blog/*`
  - `/docs/*`
  - `/directory/*`
  - `/us/*`
  - `/search/`
  - key marketing pages
- Additional cleanup in this continuation:
  - `src/app/compare/page.tsx` now uses canonical `toSiteUrl("/compare/")` for schema `@id`, `url`, and `mainEntityOfPage` values.
  - Category family pages now emit trailing-slash URLs from metadata/schema (`/categories/*`) in:
    - `src/app/categories/[slug]/page.tsx`
    - `src/app/categories/grocery/page.tsx`
    - `src/app/categories/fashion/page.tsx`
    - `src/app/categories/electronics/page.tsx`
    - `src/app/categories/beauty-health/page.tsx`
    - `src/app/categories/home-living/page.tsx`
    - `src/app/categories/page.tsx`

## Verification done locally

- Grep for slashless hardcoded `canonical:` values in the affected route families is now clean.
- Sample normalization output:
  - `/blog/post` => `https://buywhere.ai/blog/post/`
  - `/compare/us` => `https://buywhere.ai/compare/us/`
  - `/us/electronics` => `https://buywhere.ai/us/electronics/`

## Remaining production validation

1. Deploy the site changes.
2. Verify production sitemap endpoints emit only trailing-slash canonical URLs.
3. Resubmit the sitemap or request reindexing in Google Search Console.
4. Monitor the `Page with redirect` exclusion bucket for decay on subsequent crawls.

## Notes

- Paperclip control-plane API was unreachable during this heartbeat, so issue-thread/status updates could not be posted from the workspace.
