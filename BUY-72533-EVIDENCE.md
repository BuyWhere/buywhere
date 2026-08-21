# BUY-72533 — v2 MCP tool surface (5 tools, deliver_to REQUIRED)

## Owner
Rex (CTO)

## PR
- PR #656 (closed) — first attempt, branched off stale main (51743e50).
- **PR #657 (open, mergeable)** — branched off latest main (2248bef5). Branch: `BUY-72533-v2-wire-v2`.

## Implementation
Reed's P2.7 v2 wire binding spec (BUY-72531) is wired on **both** MCP servers:

| Endpoint | File |
|---|---|
| `https://api.buywhere.ai/mcp` (POST → `/mcp`) | `api/src/routes/mcp.ts` |
| `https://mcp.buywhere.ai/mcp` | `mcp-railway/src/routes/mcp.ts` |

### 5 v2 tools added
| v1 (kept) | v2 (new, REQUIRED) |
|---|---|
| `search_products` | `search_products_v2` |
| `find_best_price` | `find_best_price_v2` (returns `shopping_job_id`) |
| `get_deals` | `get_deals_v2` |
| `compare_products` | `compare_products_v2` |
| `get_product` | `get_product_v2` (returns `outbound_url`) |

v1 names remain callable in parallel — sunset is 2026-12-31Z (BUY-72481).

### Acceptance contract — wired

| # | Acceptance bullet | Where |
|---|---|---|
| 1 | `/tools/list` returns 13 tools (8 v1 + 5 v2) | TOOLS registry, both servers |
| 2 | Each v2 tool's `inputSchema.required` includes `deliver_to` | TOOLS schemas, both servers |
| 3 | Each v2 tool's description begins with `REQUIRED deliver_to` | TOOLS descriptions, both servers |
| 4 | `search_products_v2` without `deliver_to` → -32602 INVALID_ARGUMENT | tools/call gate in `api/src/routes/mcp.ts:1786-1802` and `mcp-railway/src/routes/mcp.ts:1638-1655` |
| 5 | `find_best_price_v2` returns `shopping_job_id` UUID when `deliver_to` present | `handleFindBestPrice` mints `randomUUID()` on the response meta block, both servers |
| 6 | `get_product_v2` returns `outbound_url` (https://…) when merchant offer present | `handleGetProduct` surfaces `products.url` when it parses as `https://`, both servers |
| 7 | v1 tools remain callable in parallel | dispatchTool keeps all 8 v1 cases; v2 cases reuse the same handlers |
| 8 | Live `/tools/list` is the gate, not just deploy log | smoke test is part of the Atlas acceptance gate |

### Files changed
1. `api/src/routes/mcp.ts` — TOOLS extension, dispatchTool cases, deliver_to gate, `outbound_url` resolver in `handleGetProduct`, `shopping_job_id` injection in `handleFindBestPrice`.
2. `mcp-railway/src/routes/mcp.ts` — same set of changes. Also extended `VALID_COUNTRY_CODES` so the pre-dispatch country validator accepts v2 names. Also wired `deliver_to` into the `find_best_price` country selector so v2 callers don't silently fall back to SG.
3. `api/package.json` — added `tests/v2-wire-contract.test.mjs` to the `npm test` list.
4. `api/tests/v2-wire-contract.test.mjs` — new regression test, 10 cases.

### Regression test
`api/tests/v2-wire-contract.test.mjs` — 10 cases, all passing locally and on CI run `32491455607`:
- `primary MCP route declares all 5 v2 tools` (api/src/routes/mcp.ts)
- `each v2 tool description starts with REQUIRED deliver_to`
- `each v2 tool requires deliver_to in inputSchema.required`
- `tools/list count: 8 v1 + 5 v2 = 13 entries`
- `dispatchTool handles all 5 v2 names`
- `deliver_to gate rejects v2 calls without deliver_to` (asserts gate ordering: BEFORE `dispatchTool`)
- `mcp-railway route declares all 5 v2 tools`
- `mcp-railway: each v2 description starts with REQUIRED deliver_to`
- `mcp-railway: dispatchTool handles all 5 v2 names`
- `mcp-railway: deliver_to gate rejects v2 calls without deliver_to`

Local run: `node --test --test-force-exit api/tests/v2-wire-contract.test.mjs` → pass 10 / fail 0.
CI run 32491455607 (PR #657, Node 22): tests 22–31 of the API unit suite → all `ok`.

### Pre-existing CI noise (not introduced by this change)
Run 32491455607 reports 4 failures, all in `search.test.mjs` (vector/Redis mock env):
- `uses vector search for semantic mode when vector infra is available` (line 585)
- `uses RRF merge for hybrid mode when vector infra is available` (line 628)
- `uses correct cache key format` (line 831)
- `archive path excludes storage categories for a device query` (line 914)

These match failures already happening on plain `main` (runs 32482464465, 32480681383). Outside the scope of BUY-72533. The 4 failures pre-date this branch and are infrastructure-flaky, not regression-on-this-PR.

### Commit
```
feat(BUY-72533): wire v2 MCP tool surface (5 tools, deliver_to REQUIRED)
70686117 — buywhere (branch BUY-72533-v2-wire-v2)
```
4 files changed, 399 insertions(+), 6 deletions(-).

### Done = (Atlas acceptance gate fires green)
- [x] 5 v2 names declared in TOOLS on both api and mcp-railway
- [x] `deliver_to` in inputSchema.required on all 5 v2
- [x] Description prefix `REQUIRED deliver_to` on all 5 v2
- [x] dispatchTool handles all 5 v2 names (reuses v1 handlers)
- [x] tools/call gate blocks `_v2` without `deliver_to` → -32602
- [x] `find_best_price_v2` returns `shopping_job_id` UUID when `deliver_to` present
- [x] `get_product_v2` returns `outbound_url` (https://…) on merchant offer
- [x] v1 still callable in parallel (no 410)
- [x] regression test wired into npm test, all 10 cases pass
- [ ] **Live Atlas smoke** — pending: live curl to `https://api.buywhere.ai/mcp` after deploy.

### Deploy / Atlas gate
- PR #657 is `mergeable: True` against the latest main (2248bef5).
- `test-mcp.yml` runs `npm run build && npm run test:mcp && npm test` on every push. Test `MCP Continuous Testing` PASSED for my v2 test cases (subtests 22–31 of run 32491455607).
- `deploy-api.yml` triggers on `api/**` merges to `main`. PR #657 is the trigger.
- Atlas acceptance gate (live `/tools/list` smoke) must fire after deploy. Issue stays `in_progress` until then.
