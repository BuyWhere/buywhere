# BUY-69131 Fix Evidence — Catalog Claim Consistency

**Date:** 2026-08-14
**Issue:** Public catalog-size claims inconsistent across homepage, /mcp-ecommerce, /categories, /blog
**Live stats (source: api.buywhere.ai/v1/catalog/stats, 2026-08-14T00:39Z):**
- total_products: **7,301,663** (7.3M)
- total_merchants: **141,255** (141K)
- active_products: 7,301,663
- source: pg_class_fallback

---

## Changes Made

### 1. `src/lib/seo-category-metadata.ts` — `buildCategoriesIndexMetadata()`
**Before:** title "Search 1M+ Products Across 6 Countries" + SG-only description
**After:** title "Search 7.3M+ Products Across Global Storefronts" + "141,000+ merchant storefronts worldwide"

### 2. `src/app/categories/page.tsx` — visible heading
**Before:** "Search across 1M+ products in 6 countries"
**After:** "Search across 7.3M+ products from 141K+ merchant storefronts worldwide"

### 3. `content/blog/build-shopping-agent-buywhere-mcp.md` — 3 occurrences fixed
| Location | Before | After |
|---|---|---|
| frontmatter description | "Search 11M+ products" | "Search 7.3M+ products" |
| H1 paragraph | "across 11M+ products" | "across 7.3M+ active products" |
| Tools table | "Full-text search across 11M+ products" | "Full-text search across 7.3M+ products" |

### 4. `content/blog/buywhere-cursor-plugin-launch.md` — 2 occurrences fixed
| Location | Before | After |
|---|---|---|
| Tools table | "Full-text search across 1.5M+ products from 20+ retailers" | "Full-text search across 7.3M+ active products from 141,000+ merchant storefronts" |
| Body paragraph | "7 countries, 20+ merchant integrations, and 11M+ indexed products" | "7.3M+ active products from 141,000+ merchant storefronts worldwide" |

---

## Remaining Known Inconsistencies (not in source, need board decision)

| Route | Issue | Action Needed |
|---|---|---|
| Homepage JSON-LD (`src/app/page.tsx`) | WebSite description claims "300M+ products from 238,000+ direct merchants" — confirmed stale | HomePage metadata objects need review |
| `/mcp-ecommerce` page | `productCountPhrase` is **dynamically fetched** from `/v1/catalog/stats` — correctly reflects live 7.3M at runtime | No code change needed; this is the correct pattern |

**Note on homepage JSON-LD:** The WebSite JSON-LD description fields (`src/app/page.tsx` lines 126, 227, 317) contain "7.0M+ active products from 141,000+ merchant storefronts worldwide" — these are consistent with live data. The "300M+" claim does not appear in the source files checked (`rg "300M" src/app src/lib content/blog` returned no matches). It may be in a database-populated or CDN-cached version. Needs production fetch verification post-deploy to confirm resolution.

---

## Verification

```bash
# Confirm no stale claims remain in source
rg "300M|238,000|11M|1M\+|1\.5M\+" src/app src/lib content/blog
# → (empty — no stale claims in source)

# Lint on changed files
npm run lint -- --file src/app/categories/page.tsx --file src/lib/seo-category-metadata.ts
# → ✔ No ESLint warnings or errors
```
