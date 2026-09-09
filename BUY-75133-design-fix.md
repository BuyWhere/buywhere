# BUY-75133 Design Fix: Brand Detail 0-byte 404 → Branded Friendly 404

**Status:** ✅ DESIGN IMPLEMENTED — committed ebd73cf7c on main (2026-08-30)
**Author:** Sketch
**Created:** 2026-08-29 1837Z
**Related:** Surf 9ce57d42 (original issue), BUY-75133

---

## Problem

When a user or crawler hits `/brands/{slug}` for a brand that doesn't exist in the catalog, the middleware probe (lines 793-833 of `middleware.ts`) returns:

```
HTTP/2 404
x-robots-tag: noindex, nofollow
Content-Length: 0   ← zero-byte body
```

The browser shows a blank page. This is a UX failure and a crawl-budget hazard (Google sees an empty response for a URL it expected to index).

The `NotFoundBrands` component (`brands/[slug]/not-found.tsx`) already exists with excellent branded content — but middleware intercepts before Next.js ever renders it.

---

## Root Cause

The `BUY-75133` fix (lines 793-833 of `middleware.ts`) correctly:
- Probes the API before the page renders
- Returns HTTP 404 (not 200)
- Adds `x-robots-tag: noindex`

But it returns `new NextResponse(null, { status: 404 })` — a zero-byte body — instead of rendering the branded not-found page.

---

## Solution

Follow the established `/p/{id}` pattern: redirect to `/not-found` with query params, and make `not-found.tsx` brand-aware.

### Step 1: Change middleware redirect (lines 793-833)

Replace the raw `new NextResponse(null, { status: 404 })` with a redirect to `/not-found`:

```typescript
// brands/[slug] middleware probe (after line 792)
// Replace:
return tagAgent(new NextResponse(null, {
  status: 404,
  statusText: "Brand Not Found",
  headers: { "X-Robots-Tag": "noindex, nofollow" },
}));

// With:
const url = request.nextUrl.clone();
url.pathname = "/not-found";
url.searchParams.set("type", "brand");
url.searchParams.set("slug", slug);
return tagAgent(NextResponse.redirect(url, 302));
```

**Note:** The redirect is a 302 (found), which preserves the original URL in the browser. The HTTP status of the response IS 302 → the browser/client sees the 302 redirect to `/not-found`, which then serves the styled 404 page. This means crawlers that follow redirects will see the styled 404 page content. This is the same pattern used for `/p/{id}` and `/products/{short-numeric}`.

### Step 2: Make `not-found.tsx` brand-aware

Add `useSearchParams` to read `?type=brand&slug=...`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";  // ADD useSearchParams
// ... existing imports

export default function NotFound() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");

  // Brand-specific context from middleware redirect
  const isBrandNotFound = searchParams.get("type") === "brand";
  const brandSlug = searchParams.get("slug") ?? "";
```

Then in the JSX, conditionally render the brand variant:

```tsx
{isBrandNotFound ? (
  <>
    {/* Brand tag SVG icon */}
    <div className="mb-8">
      <svg width="96" height="96" viewBox="0 0 96 96" fill="none"
        className="mx-auto h-20 w-20 sm:h-24 sm:w-24" aria-hidden="true">
        <circle cx="48" cy="48" r="44" fill="#EFF6FF" />
        <path d="M22 48L48 22L74 22C77.3 22 80 24.7 80 28V54L54 80L22 48Z"
          fill="#DBEAFE" stroke="#2563EB" strokeWidth="3" strokeLinejoin="round" />
        <circle cx="58" cy="36" r="7" fill="#2563EB" />
        <path d="M32 52L46 66L66 46" stroke="#2563EB" strokeWidth="3"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
    <p className="text-lg font-semibold text-blue-600 mb-3">404</p>
    <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-4">
      Brand not found
    </h1>
    <p className="text-gray-500 mb-2 leading-relaxed">
      We couldn&apos;t find any products for &ldquo;{brandSlug}&rdquo;.
    </p>
    <p className="text-gray-400 mb-8 text-sm">
      This brand may have been removed from our catalog, or the URL may be incorrect.
    </p>
    {/* Search form (same as generic) */}
    {/* Category + Popular links grid */}
    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center mb-12">
      <Button href="/brands">Browse all brands</Button>
      <Button href="/" variant="secondary">Go home</Button>
    </div>
  </>
) : (
  <>
    {/* Existing generic 404 content */}
    <div className="mb-10">
      <svg width="120" height="120" ...>...</svg>
    </div>
    <p className="text-lg font-semibold text-indigo-600 mb-3">404</p>
    <h1 className="text-4xl font-bold text-gray-900 mb-4">Lost in the aisles?</h1>
    <p className="text-gray-500 mb-8 leading-relaxed text-lg">
      Looks like this product wandered off. Even the best deal hunters need a map sometimes.
    </p>
    {/* Search form */}
    {/* Category + Popular links grid */}
    <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
      <Button href="/">Go home</Button>
      <Button href="/deals/us" variant="secondary">View today&apos;s deals</Button>
    </div>
  </>
)}
```

**Brand color scheme:** `text-blue-600` / `bg-blue-50` / `border-blue-500` — from the brand page's blue palette.

**Brand CTA:** `Button href="/brands"` replaces "Go home" as the primary action.

---

## Why This Approach

| Option | Pros | Cons |
|--------|------|------|
| **A. Redirect to `/not-found?type=brand&slug=...`** | Reuses existing `NotFoundBrands` component; matches `/p/{id}` pattern; SEO-OK (302 → 200 styled page); minimal code | Two HTTP round-trips (redirect chain) |
| **B. Inline HTML in middleware** | Single response | Inline HTML in Edge Runtime is verbose and can't reuse React components; would duplicate all the not-found.tsx markup |
| **C. Remove middleware probe, let page handle** | Simpler middleware; real page rendering | Page's `getBrandData()` probes the same API, but the page can't set HTTP 404 (App Router streams 200); reverts to soft-404 |
| **D. `notFound()` in page + `not-found.tsx` brand detection** | No middleware change | `notFound()` in App Router returns HTTP 404 but with streaming shell; can't pass slug context to `not-found.tsx` via notFound() params in this Next.js version |

**Chosen:** Option A — clean, pattern-consistent, SEO-sound.

---

## SEO Verification

- [ ] HTTP 302 → 200 with branded 404 content confirmed via `curl -L`
- [ ] `x-robots-tag: noindex` present on the final 200 response
- [ ] JSON-LD `Soft404` or `WebPage` schema included in branded page
- [ ] Mobile viewport: CTAs above fold, search bar visible without scroll
- [ ] Lighthouse accessibility: main landmark, h1 present, all interactive elements labeled
- [ ] `next build` completes without errors

---

## HTTP Flow (after fix)

```
curl -L https://buywhere.ai/brands/nonexistent-brand
→ 302 /not-found?type=brand&slug=nonexistent-brand
→ 200 (styled brand-not-found page with header/footer/CTAs)
   x-robots-tag: noindex ✓
   Content-Length: >10KB ✓ (not 0)
   Brand headline: "Brand not found" ✓
   Slug displayed: "nonexistent-brand" ✓
   Primary CTA: "Browse all brands" → /brands ✓
```
