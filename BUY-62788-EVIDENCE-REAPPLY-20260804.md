# BUY-62788 — SEV-1 Fabricated Cache Fix Re-Application Evidence

**Date:** 2026-08-04
**Agent:** Oracle
**Status:** Fix committed, PR #325, MCP test running

## Original Issue (2026-07-16)

MCP `search_products` in browse mode (no `q`) with `country_code` filter returned:
- `meta.total = 288024448` (global `pg_class.reltuples` ≈ 288M)
- `data: []` (empty results)

Root cause: browse path fetched recent global rows via `idx_products_updated_at`, then filtered `country_code` in-application. Recent rows were predominantly US/null, so SG/filtered-US pages returned empty while `total` stayed at the inflated global estimate.

## Fix Applied (2026-07-17)

Commit `2ee6f65fd` — pushed `is_active + country_code + region` into SQL WHERE and replaced global reltuples with bounded `COUNT_CEIL=100000`.

## Regression (2026-07-29)

Commit `b5781c9cd` (BUY-65298) rewrote `mcp.ts` with -303/+199 lines, inadvertently reverting the BUY-62788 fix. The browse-mode code reverted to:
- `SELECT reltuples::bigint FROM pg_class` (global ~303M total)
- In-app filtering of global recent rows

## Current Live State (2026-08-04 — before this fix)

```
search_products {country_code:'SG', limit:3} → data:3, total:303832896  ← WRONG
search_products {country_code:'US', limit:3} → data:3, total:303832896  ← WRONG
```

Results happen to appear because recent ingestion includes SG/US products. But `meta.total` is inflated, and the SEV-1 will resurface when recent rows don't match the country filter.

## Fix Re-Applied (2026-08-04)

**Commit:** `cb406888a` on branch `fix/BUY-62788-mcp-browse-fabricated-cache-reapply`
**PR:** #325

### What Changed

`api/src/routes/mcp.ts` — browse mode block (lines 415–459):

**Before (regressed):**
```typescript
// No FTS — browse mode. Use reltuples for approximate total
const approxResult = await searchClient.query(
  `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = 'products'`
);
total = parseInt(approxResult.rows[0]?.estimate ?? '0', 10);
// Fetch global rows, filter in-app
```

**After (fixed):**
```typescript
// No FTS — browse mode. Push is_active + country_code + region into SQL
const browseCond: string[] = ['is_active = true'];
if (country) { browseCond.push(`country_code = $${browseParams.length}`); }
if (region)  { browseCond.push(`lower(region) = $${browseParams.length}`); }
const browseWhere = `WHERE ${browseCond.join(' AND ')}`;
// SQL-filtered fetch with proper LIMIT/OFFSET ::int casts
// Bounded COUNT with COUNT_CEIL=100000
const countRes = await searchClient.query(
  `SELECT COUNT(*)::bigint AS n FROM (
     SELECT 1 FROM products ${browseWhere} LIMIT $${countParams.length}::int
   ) _c`,
  countParams
);
total = parseInt(countRes.rows[0]?.n ?? '0', 10);
```

## Verification Plan

1. **MCP Continuous Testing** — running now on PR #325
2. **Live probe after deploy:**
   - `search_products {country_code:'SG', limit:3}` → `meta.total` ≤ 100000
   - `search_products {country_code:'US', limit:3}` → `meta.total` ≤ 100000
3. **FTS path unchanged:** `search_products {q:'laptop', country_code:'SG'}` still works

## Related Issues

- BUY-62677 — SEV-1 gateway dispatch (in_review)
- BUY-62605 — SG get_deals unavailable (todo)
- BUY-60528 — list_categories stale counts (backlog)
- BUY-65298 — reverted this fix (b5781c9cd)
