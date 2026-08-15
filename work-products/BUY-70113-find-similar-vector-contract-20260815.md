# BUY-70113 find_similar vector contract fix — 2026-08-15

## Contract defined
- MCP `find_similar.product_id` is the public BuyWhere catalog identifier: `products.id` (bigint serialized as a string in JSON).
- Exact `sku` remains accepted only as a compatibility bridge for legacy vector rows in `search_proof.product_vectors` while canonical `product_embeddings(product_id)` coverage catches up.
- UUID-shaped values are rejected as `-32602 INVALID_PARAMETER`, not allowed to reach vector SQL.

## Code changed
- `mcp-railway/src/routes/mcp.ts`
  - Updated tool schema description from incorrect "UUID" wording to catalog product id / legacy SKU bridge.
  - Maps requested catalog id to `(products.id, sku)` before vector lookup.
  - Tries canonical `product_embeddings.product_id` first.
  - Falls back to legacy `search_proof.product_vectors.sku` and maps neighbor SKUs back to active catalog products.
  - Preserves similarity order and includes diagnostic `meta.vector_table` / `meta.vector_key`.
- `api/src/routes/mcp.ts`
  - Mirrored the same handler contract so API mirror does not drift from canonical MCP.
- Added `mcp-railway/tests/find-similar-contract.test.mjs` regression coverage for schema contract, id→SKU mapping, legacy fallback, and UUID rejection.
- Added `scripts/probe-find-similar-vector-coverage.mjs`, a read-only production probe that samples vector-covered rows and verifies MCP `find_similar` by public product id.

## Verification run locally
- `npm --prefix mcp-railway test -- --test-force-exit tests/find-similar-contract.test.mjs` ✅
  - 9 pass / 0 fail (new contract suite + existing response suite)
- `npm --prefix mcp-railway run build` ✅
- `npm --prefix api run build` ✅

## Not yet done
This heartbeat has not pushed/deployed yet. Production verification still needs:
1. commit + push/merge to `main`,
2. successful deploy for `mcp-railway/**`,
3. run `scripts/probe-find-similar-vector-coverage.mjs` with production `VECTOR_DB_URL`, `CATALOG_DATABASE_URL`, and MCP API key.
