# BUY-41137 — Deploy + load-test + eval harness — semantic search

**Status:** Fix written, built, committed (local); push blocked by BUY-65234
**Date:** 2026-08-04
**Agent:** Vera

## Summary

BUY-41137 was woken (blockers resolved) after BUY-63231 (vector dimension
mismatch) was marked done. Live smoke tests revealed a new regression:

- `/v1/products/search?q=...&mode=hybrid` — **200 OK**, but slow (cold p95 ~9.9s)
- `/v1/products/:id/similar` — **500 Internal server error for ~63% of products**

The 500 is a Find-Similar regression on the BUY-63231 fix path: the
`vectorDb` pgvector pool has no `statement_timeout`, so slow KNN queries on
the mixed-dim index hang for ~30s and exhaust the max=5 pool. When the pool
is exhausted, the fallback path (brand/category + FTS on main `db`) also
fails with an unhandled error → 500.

## Live diagnostic evidence

Diagnostic `scripts/diag-similar.js` probed 30 search-returned product IDs:

- 19 returned **500** after ~2s (pool exhausted) or ~30s (statement hang)
- A handful returned **200 via KNN** in ~20ms (embedding present, KNN fast)
- Failures span every merchant / region / currency (amazon.sg, shopify,
  woocommerce, amazon_us, newegg_us) — not data-specific, it's the pool

## Fix applied

### 1. `vectorDb` pool gets `statement_timeout`

`api/src/config.ts`, `api-embed/api/src/config.ts`, `mcp-railway/src/config.ts`:
```ts
const vectorStatementTimeout = parseInt(process.env.VECTOR_STATEMENT_TIMEOUT || '10000');
pool.on('connect', (client) => {
  client.query(`SET statement_timeout = ${vectorStatementTimeout}`).catch(() => {});
});
```

10s lets HNSW-approximate KNN complete on ≤2k rows, but slow/hung scans fail
fast (57014) → caught by existing `try/catch` → fallback path runs.

### 2. Find-Similar route gets hard response timeout

`api/src/routes/products.ts`: `/v1/products/:id/similar` now calls
`res.setTimeout(SEARCH_HANDLER_TIMEOUT_MS, …)` before query execution,
matching the pattern on `/search` (BUY-33987).

### 3. Dropped explicit `public.` schema prefix on similar queries

Aligned with the search endpoint and mcp.ts paths (bare `product_embeddings`).

## Pre-existing artifacts verified complete (not changed)

| Artifact | Path | Status |
|---|---|---|
| k6 load test | `tests/load/semantic-search.js` | Complete |
| Nightly eval | `scripts/eval/semantic-search-eval.js` | Complete |
| Eval CI workflow | `.github/workflows/eval-semantic-search-nightly.yml` | Complete |
| Atlas QA set | `data/eval/atlas-qa-eval-set.json` | Present |
| p95 latency | `monitoring.p95_latency` via `latencyMiddleware` | Live |
| Cache hit rate | `monitoring-api/api/src/monitoring/embedding.js` | Live |
| Pipeline counter | `GET /api/monitoring/embedding/pipeline_state` | Live |
| Alert rule | `POST /api/monitoring/embedding/alerts/check` | Live |

## Acceptance criteria status

- [ ] k6 load test passes all assertions — blocked on deploy
- [ ] FTS baseline captured; post-hybrid degradation <= 10% — blocked on deploy
- [ ] Nightly eval harness running and green — blocked on deploy
- [x] All monitoring/alerts deployed — verified present

## Push blocker

`git push origin main` is blocked by BUY-65234: the agent PAT lacks GitHub
`workflow` scope. The working tree includes non-workflow source changes, but
there are 3 prior local commits from earlier sessions that touch non-workflow
files and 1 prior local commit (`e6466492`) that touches
`.github/workflows/deploy-railway.yml`. Because those commits sit between
origin/main and HEAD, any push is rejected by GitHub.

This run rebased/cleaned the working tree so the BUY-41137 fix is now a
single, non-workflow commit sitting directly on top of `origin/main`. If an
ops user with workflow-scope token can reset the local `main` branch to
origin/main and cherry-pick this commit, the fix will deploy automatically via
`deploy-api.yml` on push.

## Files changed

- `api/src/config.ts`
- `api/src/routes/products.ts`
- `api/dist/config.js` (rebuilt)
- `api/dist/routes/products.js` (rebuilt)
- `api-embed/api/src/config.ts`
- `api-embed/api/src/routes/products.ts`
- `mcp-railway/src/config.ts`
- `mcp-railway/src/routes/products.ts`
- `BUY-41137-EVIDENCE.md`
