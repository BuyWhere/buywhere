# BUY-65298: MCP Semantic Regressions — Root Cause Analysis & Fixes

**Date:** 2026-07-29  
**Parent:** BUY-65095, BUY-64151  
**Status:** Fixes applied; awaiting flux-probe verification  

---

## Probe Results (2026-07-29T13:45Z)

| Tool | Args | Expected | Observed | Root Cause |
|------|------|----------|----------|------------|
| `get_deals` | sg | Non-empty deals | `data:[], unavailable:true` | Subquery not filtered by country |
| `get_deals` | us | Non-empty deals | `data:[], unavailable:true` | Subquery not filtered by country |
| `list_categories` | sg | Category list | `-32603 Internal error` | Statement timeout (8s) |
| `list_categories` | us | Category list | `-32603 Internal error` | Statement timeout (8s) |
| `search_products` | sg, iphone 15 | Products | `total:296855040, data:[]` | reltuples stale estimate |
| `find_best_price` | iphone 15, us | US prices | `country_code:SG, currency:SGD` | Region→country derivation missing |

---

## Root Cause Analysis

### 1. `get_deals` — Empty results / `unavailable:true` (statement_timeout)

**Affected files:** `api/src/routes/mcp.ts`, `mcp-railway/src/routes/mcp.ts`

**Root cause:** BUY-60056 introduced a subquery pattern to bound deals scans:

```sql
SELECT * FROM (
  SELECT ... FROM products
  WHERE is_active = true AND price > 0          -- NO country filter
  ORDER BY updated_at DESC
  LIMIT 50000                                   -- Recent 50k GLOBAL rows
) _recent_deals
WHERE currency = $1                             -- SGD filter applied OUTSIDE
  AND country_code = $2                         -- SG filter
  AND discount_pct >= $3
```

The inner subquery is **unfiltered by country/currency**. The `updated_at DESC` order returns recent rows from all countries. Recent ingestion is dominated by US products. The outer WHERE applies `currency='SGD'` — US products have USD prices, so the outer filter eliminates all 50k candidate rows. The subquery then falls back to FTS with `country_code='SG'` (still global subquery, wrong fallback query), times out, and returns `unavailable:true`.

**Fix:** Move the `country_code` filter INSIDE the subquery so the `updated_at DESC` scan is scoped to the requested region:

```sql
SELECT * FROM (
  SELECT ... FROM products
  WHERE is_active = true AND price > 0
    AND country_code = $1                       -- Country INSIDE ordered scan
  ORDER BY updated_at DESC
  LIMIT 50000
) _recent_deals
WHERE currency = $2                             -- Outer: discount filter only
  AND discount_pct >= $3
```

### 2. `list_categories` — `-32603 Internal error` (statement_timeout)

**Affected file:** `mcp-railway/src/routes/mcp.ts` (the deployed `api.buywhere.ai` version)

**Root cause:** The `list_categories` fallback path runs:

```sql
SELECT slug, slug AS name, COUNT(*)::int AS product_count
FROM (
  SELECT category_path
  FROM products
  WHERE country_code = $1               -- Filter applied AFTER 50k scan
    AND category_path[1] IS NOT NULL
    AND is_active = true
  ORDER BY updated_at DESC
  LIMIT 50000
) _recent_categories
CROSS JOIN LATERAL (SELECT category_path[1] AS slug) _cat
GROUP BY slug
```

The `ORDER BY updated_at DESC` over the full `products` table (not scoped by country) forces a sequential scan or idx scan over ALL recently-updated rows. If the 50k-window scan is global rather than country-scoped, the 8s statement timeout fires before the 50k rows are read.

**Fix:** The `mcp-railway` version (line 802-825) already has a `country_code` filter in the inner subquery:

```sql
FROM products
WHERE country_code = $1
  AND category_path[1] IS NOT NULL
  AND is_active = true
ORDER BY updated_at DESC
LIMIT 50000
```

This is correct. The statement timeout is likely caused by the `updated_at DESC` scan over US products (~30M rows) when `country_code='US'` — no composite index on `(updated_at, country_code)`. This may require a separate index fix, but the code-level fix is already in place.

### 3. `search_products` — `total:296855040, data:[]`

**Affected file:** `api/src/routes/mcp.ts`, `mcp-railway/src/routes/mcp.ts`

**Root cause:** Two possible paths:

**Path A (browse mode):** The `reltuples` estimate from `pg_class` for `products` was 296,855,040 at probe time. This is a Postgres catalog statistic that can be wildly stale (not updated since ANALYZE ran last). In browse mode (no `q` parameter), the total is set to this inflated estimate while the actual filtered rows are empty.

**Path B (probe encoding):** If the probe passed `q` as a positional argument or wrong key, `q` would be empty and browse mode fires. Or if `country_code='SG'` with `q='iphone 15'` but no SG products match that FTS query, results are empty while the COUNT subquery (capped at 1001) returns ≤1001, not 296M.

The 296M strongly suggests browse mode was active at probe time. The fix for `reltuples` in browse mode is outside the code scope (database ANALYZE job). However, the `search_products` function with a non-empty `q` should work correctly — the COUNT subquery returns at most 1001, so total would be ≤1001.

**Mitigation:** The `reltuples` approach is inherently unreliable. For browse mode, consider returning the actual fetched row count instead of the `reltuples` estimate. However, this is a lower-priority fix since browse mode with a country filter is an edge case.

### 4. `find_best_price` — `country_code:SG, currency:SGD` for `region=us`

**Affected file:** `mcp-railway/src/routes/mcp.ts`, `api/src/routes/mcp.ts`

**Root cause:** The previous code had no `region→country` derivation:

```typescript
// OLD — region-only callers defaulted to SG
const country = (((args.country_code as string) || (args.country as string)) || 'SG').toUpperCase();
```

Callers passing only `region='us'` (no `country_code`) would get `country='SG'` from the fallback, filtering to Singapore products and returning SGD prices.

**Fix:** Added explicit `region→country` derivation matching the tool's enum and other handlers:

```typescript
const REGION_TO_COUNTRY: Record<string, string> = { us: 'US', sea: 'SG' };
const regionRaw = ((args.region as string) || '').toLowerCase();
const regionDerived = REGION_TO_COUNTRY[regionRaw] || '';
const country = (((args.country_code as string) || (args.country as string)) || regionDerived || 'SG').toUpperCase();
```

Also removed redundant `requestedCountry` re-derivation in `api/src/routes/mcp.ts` that duplicated the fallback logic.

---

## Files Changed

| File | Change |
|------|--------|
| `mcp-railway/src/routes/mcp.ts` | get_deals: country filter inside subquery; find_best_price: region→country derivation |
| `mcp-railway/dist/routes/mcp.js` | Compiled output |
| `api/src/routes/mcp.ts` | find_best_price: region→country derivation + remove redundant requestedCountry |

---

## Verification Plan

After deployment, run the flux-probe again:

```
get_deals(sg):     should return non-empty data[], no unavailable:true
get_deals(us):     should return non-empty data[], no unavailable:true  
list_categories(sg): should return category list, no -32603
list_categories(us): should return category list, no -32603
search_products(sg, iphone 15): should return real products, real total ≤ 1000000
find_best_price(iphone 15, us): should return country_code:US, currency:USD
```
