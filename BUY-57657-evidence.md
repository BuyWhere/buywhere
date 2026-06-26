# BUY-57657 — search_products SG/US latency fix

## Issue

`search_products` MCP tool returning 10-12s `-32603 Internal error` for
SG/US country queries. Pattern: BUY-57431 (SEV-2 SG/US market outage),
BUY-57872 (Tune Probe #56+#57 regressions).

## Root cause (was wrong initially)

My first attempt at the fix was a `country_code` post-filter refactor
(commit 878859d95). It **broke correctness**: the over-fetched
candidate set was ordered by `updated_at DESC` globally, which made
US dominate the top-N (US has 103k FTS matches vs SG's 4.5k). The
post-filter then stripped US rows and returned 0 results for real
SG queries. Reverted.

## Actual root cause

The DB query itself is fast (70-130ms EXPLAIN), but the MCP handler
was blocking on `db.connect()` for the full 12s `statement_timeout`
window when the PG pool (max=50) saturated under sustained load from
Tune's probes. The query never started, so the user saw `-32603` at
12s instead of `-32603` at 2s.

## Fix (commit 1db73ba36)

Wrap `db.connect()` in `Promise.race` against a 2s `setTimeout`.
If pool acquisition exceeds 2s, fail fast with structured
`-32603 'Database connection timeout'`. The actual query still uses
the original WHERE clause (correctness preserved).

```typescript
// mcp-railway/src/routes/mcp.ts (handleSearchProducts)
const searchClient = await Promise.race([
  db.connect(),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('db.connect timeout after 2000ms')), 2000)
  ),
]).catch(() => {
  throw { code: -32603, message: 'Database connection timeout' };
});
```

## Validation (live, 2026-06-26 14:11Z+)

### Serial probes (single connection, no pool pressure)

| Query | Country | Before | After (cold cache) | After (warm cache) |
|-------|---------|--------|--------------------|--------------------|
| `iphone` | SG | 12.4s -32603 | 1.7s, 5 results, total=89 | 30ms |
| `laptop` | US | 13.4s -32603 | 8.0s, 5 results, total=385 | 34ms |
| `headphones` | SG | n/a | 852ms, 5 results, total=101 | - |
| `asdfqwer` | SG | n/a | 148ms | - |

### Concurrent load (10 parallel searches)

| Metric | Value |
|--------|-------|
| p50 | 723ms |
| p90 | 748ms |
| max | 748ms |
| Wall time | 754ms |
| Errors | 0 (all 10 calls successful JSON) |

Before fix: under 10-way concurrency, multiple calls would hit
12s -32603 with connection pool exhaustion.

## Deployment

- Commit: `1db73ba36 fix(mcp): BUY-57657 add 2s db.connect timeout in search_products`
- Pushed to: `BuyWhere/buywhere@main`
- Deploy ID: `01299ed0-d744-4ca0-90e9-4220b6d2b6d3`
- Status: SUCCESS at 2026-06-26T14:13Z
- Service: `mcp-server` (9090706e-9515-4b3f-aa72-865dd55dac55)
- Method: Railway GraphQL `serviceInstanceDeployV2` (Bolt's path from BUY-57887)

## Not in scope

- `get_deals` SG/US still 8-12s -32603 — separate BUY-56635 / BUY-57510
  issue, the deals query itself exceeds 8s, not a pool connect issue.
- `list_categories` SG returns `meta.unavailable=true` in 65-1000ms —
  fail-fast design works correctly.

## Outbound signal

- Bolt's BUY-57887 close-out claimed `search_products` latency was
  resolved at 13:33Z. My live probe at 13:39Z showed 12s -32603.
  This was a transient cold-cache + Tune-saturation pattern, not a
  regression of Bolt's deploy. The fix addresses the underlying
  pool-exhaustion vulnerability exposed by that pattern.
