# BUY-67704 Evidence — /stores and /coupons Accessibility/AEO Fixes

**Date:** 2026-08-09  
**Author:** Surf (agent 90688cb2)

## Changes Applied

### 1. Skip-Link Target (HIGH priority)
- Added `<main id="main-content" tabIndex={-1} className="flex-1 outline-none">` wrapper to both `/stores` and `/coupons` routes.
- This matches the global skip-link target (`#main-content`) in `SkipLinks.tsx`.

### 2. Open Graph/Twitter Metadata (MEDIUM priority)
- Added route-specific `openGraph` and `twitter` metadata to both pages.
- Each page now has its own title, description, URL, and OG image instead of inheriting homepage defaults.

### 3. JSON-LD Structured Data (MEDIUM priority)
- Both pages now emit `CollectionPage` + `ItemList` JSON-LD via an inline `application/ld+json` script.
- Includes stable `@id` values with fragment identifiers:
  - `/stores`: `https://buywhere.ai/stores#webpage`, `https://buywhere.ai/stores#store-list`
  - `/coupons`: `https://buywhere.ai/coupons#webpage`, `https://buywhere.ai/coupons#deal-category-list`
- `/stores` includes store entries with country and productCount metadata.
- `/coupons` includes deal category entries with descriptions.

### 4. Category Card Destinations (LOW priority)
- Updated category card descriptions to clarify they link to the general `/deals` hub.
- Example new copy: "Explore electronics discounts from Amazon, Best Buy, and Shopee — browse all deals or filter by category."

## Acceptance Criteria Verification

Runtime verification used the scoped BuyWhere verify-skill approach: scratch copy excluding the top-level Python `app/` directory, symlinked `node_modules`, and `next dev` bound to `127.0.0.1:33500`.

Node-based HTML assertions:

```json
{
  "route": "/stores",
  "status": 200,
  "h1": 1,
  "hasMain": true,
  "og": "Stores — Shop Across Top Retailers | BuyWhere",
  "tw": "Stores — Shop Across Top Retailers | BuyWhere",
  "jsonLdBlocks": 1,
  "jsonLdType": "CollectionPage",
  "jsonLdId": "https://buywhere.ai/stores#webpage",
  "itemListId": "https://buywhere.ai/stores#store-list",
  "numberOfItems": 13
}
{
  "route": "/coupons",
  "status": 200,
  "h1": 1,
  "hasMain": true,
  "og": "Coupons &amp; Deals — Save More with BuyWhere",
  "tw": "Coupons &amp; Deals — Save More with BuyWhere",
  "jsonLdBlocks": 1,
  "jsonLdType": "CollectionPage",
  "jsonLdId": "https://buywhere.ai/coupons#webpage",
  "itemListId": "https://buywhere.ai/coupons#deal-category-list",
  "numberOfItems": 4
}
```

Additional checks:
- `npm run lint -- --file src/app/stores/page.tsx src/app/coupons/page.tsx` passed with no ESLint warnings or errors.

## Files Modified

- `src/app/stores/page.tsx`
- `src/app/coupons/page.tsx`
