# BUY-77134 Design Spec: Brand Detail Friendly 404

**Status:** Draft — for Flux implementation
**Author:** Sketch
**Created:** 2026-08-29
**Related:** BUY-77134, Surf 9ce57d42

---

## Problem

When a user or crawler hits `/brands/{slug}` for a brand that doesn't exist in the catalog, the route currently either:
1. Returns a raw HTTP 404 with zero content (no body, no noindex), OR
2. Falls through to the generic `not-found.tsx` "Lost in the aisles?" page with no brand context

Both are poor UX and a SEO crawl-budget hazard.

---

## Design Solution

### Route 1: Hard 404 (HTTP 404, 0-byte body)
This must NOT happen. A 0-byte 404 means the browser shows a blank page — terrible UX.

**Fix:** Always return a valid HTML response, even on 404.

---

### Route 2: Soft 404 via `notFound()` (current behavior)
The generic `not-found.tsx` is shown. This is acceptable but misses brand context.

**Fix:** Create a brand-specific `not-found-brands.tsx` that:
- Inherits the same responsive structure as `not-found.tsx`
- Uses a brand-related illustration/icon
- Shows "Brand not found" headline
- Suggests browsing the brand index `/brands` and popular categories
- Links back to `/brands`

---

### Route 3: Transient error (5xx from brand API)
Currently handled by `TransientErrorUI` (line 62-80 in `brands/[slug]/page.tsx`).
This is correct behavior — returns JSX 503 page, does NOT return HTTP 503.

---

## Component: `not-found-brands.tsx`

### Layout
Inherits the same flex-column layout as `not-found.tsx`:
```tsx
<div className="flex flex-col min-h-screen">
  <Header />
  <main id="main-content" className="flex-1 flex items-start justify-center px-4 py-8 sm:py-12">
    <div className="max-w-2xl w-full text-center">
      ...content...
    </div>
  </main>
  <Footer />
</div>
```

### Content

**Headline:** `Brand not found` (h1, text-2xl sm:text-4xl)
**Sub-headline:** `We couldn't find any products for "{brandName}".`
**Body copy:** `This brand may have been removed from our catalog, or the URL may be incorrect.`
**Icon:** Replace document+check icon with a brand/tag icon (e.g., a tag SVG or a "storefront" SVG — see suggestions below)

### Suggested inline SVG (brand icon — 96x96)
```svg
<svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- Tag shape -->
  <path d="M20 48L48 20L76 20C78.2 20 80 21.8 80 24V52L52 80L20 48Z" fill="#EEF2FF" stroke="#4f46e5" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="60" cy="36" r="8" fill="#4f46e5"/>
  <path d="M28 52L44 68L68 44" stroke="#4f46e5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```
*Alternative: reuse the existing document-check icon with the brand page's blue color scheme.*

### Brand color scheme (from brand page `blue-*`)
- Primary accent: `text-blue-600` / `bg-blue-600`
- Gradients: `from-blue-50 to-white` (matching brand page hero)

### Links / CTAs
1. **Primary CTA:** `Button href="/brands"` — "Browse all brands"
2. **Secondary CTA:** `Button href="/" variant="secondary"` — "Go home"
3. **Search form:** Same search bar as `not-found.tsx` (searches `/search?q=...&country=us`)
4. **Category grid:** Same 2-column mobile layout as `not-found.tsx`

### Technical implementation

In `src/app/brands/[slug]/page.tsx`, after the `if (!brand)` check at line 125:

```tsx
// For brand-specific 404, render a brand-aware not-found page
// instead of the generic not-found.tsx
import { notFoundBrands } from './not-found-brands';

// In the component:
if (!brand) {
  return notFoundBrands({ slug });
}

// not-found-brands.tsx exports:
export function notFoundBrands({ slug }: { slug: string }) {
  return (
    <>
      <Header />
      <main id="main-content" className="flex-1 flex items-start justify-center px-4 py-8 sm:py-12">
        <div className="max-w-2xl w-full text-center">
          {/* brand-specific 404 content */}
        </div>
      </main>
      <Footer />
    </>
  );
}
```

*Alternative (simpler): return `notFound()` from `brands/[slug]/page.tsx` and have `not-found.tsx` detect the referrer or route to render brand-specific content. However, passing the slug to `notFound()` requires Next.js 14+ `notFound({ slug })` pattern or a context check.*

---

## Responsive behavior
Match `not-found.tsx` PR #757 pattern:
- `py-16` → `py-8 sm:py-12`
- Icon: `h-20 w-20 sm:h-24 sm:w-24`
- Grid: `grid-cols-2` on mobile for category links
- Text: `text-2xl sm:text-4xl` h1
- CTA buttons: `flex-col sm:flex-row gap-2 sm:gap-3`

---

## Verification checklist
- [ ] Unknown brand slug (e.g., `/brands/this-brand-does-not-exist`) returns HTTP 200 with branded 404 content
- [ ] Same route returns `x-robots-tag: noindex` HTTP header
- [ ] Page includes JSON-LD `Soft404` or `WebPage` with `isBasedOn` brand schema
- [ ] Mobile viewport: CTA buttons above fold, search bar visible without scroll
- [ ] Lighthouse accessibility: main landmark, h1 present, all interactive elements labeled
- [ ] `next build` completes without errors
- [ ] HTTP 200 with branded 404 content confirmed via curl

---

## Priority
- **High:** Brand-specific 404 content (UX)
- **High:** `x-robots-tag: noindex` header (SEO crawl budget)
- **Medium:** JSON-LD Soft404 schema (SEO signal)
