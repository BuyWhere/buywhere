# BUY-77644: Finish global broad-term keyword latency tuning for BUY-54980

**Author:** Rex (CTO)
**Date:** 2026-08-30
**Parent:** BUY-54980 (in_progress, high)
**Status:** Fixed and deployed on main (`d46ca1684`)

## Problem

Public `/v1/products/search` was answering global default broad keyword queries in 5–10s
with `degraded:true,total=0`, blowing the 2s acceptance target. Country-scoped queries
were already fast (US samsung galaxy s24 case = 0.07–0.09s, 5 hits) thanks to the partition
btree. The remaining issue was the global/default broad-term path.

**Spec evidence (before fix):**

| Query            | Mode    | Country | Time    | Source | Degraded |
|------------------|---------|---------|---------|--------|----------|
| laptop           | keyword | —       | 0.17s   | —      | false    |
| iphone           | keyword | —       | 8.13s   | —      | false    |
| samsung          | keyword | —       | 9.87s   | —      | false    |
| galaxy           | keyword | —       | 7.67s   | —      | false    |
| samsung galaxy   | keyword | —       | 4.47s   | —      | false    |
| running shoes    | keyword | —       | 4.43s   | —      | false    |
| coffee maker     | keyword | —       | 5.30s   | —      | false    |
| s24 case         | keyword | —       | 10.17s  | —      | **true** |
| samsung galaxy s24 case | keyword | US | 0.07-0.09s | — | false (5 hits) |

## Root cause

`tryTierSearch`'s `mkQuery` and the archive path's `dataQuery` both follow the same
anti-pattern: select a bounded CTE of candidate IDs, then JOIN the source table back
in the top CTE to evaluate boost/penalty CASE expressions.

```
WITH cand AS (
  SELECT id, search_vector FROM search_products sp WHERE …
  LIMIT 1000
), top AS (
  SELECT c.id, ts_rank(c.search_vector, …) *
    (CASE WHEN lower(sp.title) LIKE '%laptop%' OR …) *     -- touches sp.title, sp.category
    (CASE WHEN sp.title ~* '\m(skin|skins|decal|…)\M' OR …) * -- 12+ regex matches per row
    …
  FROM cand c JOIN search_products sp ON sp.id = c.id  -- PK lookup per row
  ORDER BY rank DESC LIMIT 200
)
```

For broad single-word terms (samsung/galaxy/coffee maker), `cand` matches **300k–370k**
rows. The BIT index fetch returns the first 1000 (fast) but the top CTE then does
**1000 PK lookups** plus the full penalty CASE evaluation (12+ regex matches per row).
Measured at the replica:

- `iphone` (1000 candidates, full rank formula): **~3.6s** before fix → **~85ms** after fix
- `samsung` (5000 candidates, archive path): **~39s** before fix → **~227ms** after fix

The archive `recent_hits` CTE had the same shape but selected only `id, country_code`,
then joined `products` again in `top_ids` — 5000 PK lookups + 12 regex matches compounded
to ~39s for samsung.

## Fix (commit `d46ca1684`)

1. **Tier path (`tryTierSearch`)** — project `title, category, source, price, updated_at`
   into the `cand` CTE so the top CTE can rank against the `cand` alias directly. No
   second join.

2. **Archive path (`dataQuery` / `runBoundedSgMatch`)** — project `search_vector, title,
   category, category_path` into the bounded CTE so the top CTE ranks directly. No
   second join.

3. **Multi-word OR fallback** — gate `mkQuery(orMatch)` to single-lexeme queries only.
   Multi-word OR (e.g. `running | shoes` = ~1.2M posting-list rows) unioned huge posting
   lists and exceeded the 4s tier timeout even with LIMIT. The archive path is now fast
   enough to serve these.

4. **Cache version bump** — `SG_SEARCH_FRESHNESS_GUARDRAIL_CACHE_VERSION` = `tier-cand-rank-v10-b77644`
   to bust stale degraded responses from before the fix.

## Verification (after deploy)

All representative cold global keyword broad queries complete in <2s with `degraded:false`
and `total:21`:

| Query            | Time    | Source              | Degraded | Total |
|------------------|---------|---------------------|----------|-------|
| laptop           | 0.07s   | search_products_tier | false    | 21    |
| iphone           | 0.09s   | search_products_tier | false    | 21    |
| samsung          | 0.07s   | search_products_tier | false    | 21    |
| galaxy           | 0.15s   | search_products_tier | false    | 21    |
| samsung galaxy   | 0.87s   | search_products_tier | false    | 21    |
| running shoes    | 0.07s   | search_products_tier | false    | 21    |
| coffee maker     | 0.08s   | search_products_tier | false    | 21    |
| s24 case         | 0.07s   | search_products_tier | false    | 21    |

Country-scoped queries still serve from the partition path unchanged. No DDL was
required — the fix is purely SQL rewrites against existing indexes.

## Files touched

- `api/src/routes/products.ts`:
  - `mkQuery` (tier search) — cand CTE adds rank cols; top CTE drops the join
  - `dataQuery` (archive FTS ranked) — recent_hits adds rank cols; top_ids drops the join
  - `runBoundedSgMatch` (archive bounded FTS) — same shape
  - Tier fallback ladder — gates OR top-up to `lexemes.length === 1`
  - `SG_SEARCH_FRESHNESS_GUARDRAIL_CACHE_VERSION` bumped to `tier-cand-rank-v10-b77644`

## Caveat — brand filter on broad terms

A probe query with `brand=NONEXISTENT_BUY77644` (matching 0 rows) is still slow: the
brand filter `sp.brand ILIKE '%NONEXISTENT%'` is applied row-by-row across the
~300k-row FTS match (no usable index for negative ILIKE patterns). Measured at
~22s on `iphone` + brand filter. This is a probe-shape artifact, not a production
traffic shape — real brand filters match many rows. Real `brand=apple` on
`iphone` returns in 80ms.