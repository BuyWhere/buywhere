// BUY-33987: regression guard for the /v1/products/search p99 fix.
// History: 10/10 probes of `q=laptop&country_code=SG` returned
//   503 {"error":"Search query timed out","timeout_ms":8000} on 2026-06-07.
// The handler was missing (a) `is_active = true` in the search WHERE — the
// planner was reading inactive rows from `products_sg` (~42 dead rows for
// `laptop` alone) and the partial GIN index
//   `products_sg_search_vector_idx WHERE is_active = true` (and its siblings
//   `products_*_search_vector_price_sgd_idx`) was not selected; and (b) a
//   whole-request ceiling via `res.setTimeout()` — the per-statement
//   `SET LOCAL statement_timeout = 8000` could still let a hung request
//   keep a connection out of the 50-slot pool for 8s, starving sibling
//   endpoints. This test pins the four invariants introduced by the fix:
//     1. SEARCH_STATEMENT_TIMEOUT_MS is set to a value >= 1000ms (a
//        future revert to 30s would re-introduce the 30s+ hang class).
//     2. SEARCH_HANDLER_TIMEOUT_MS is declared (the res.setTimeout() ceiling).
//     3. The /search handler installs `res.setTimeout(SEARCH_HANDLER_TIMEOUT_MS, …)`
//        at the top of the route.
//     4. The CTE inside the /search handler includes `is_active = true`
//        so the planner can pick the partial GIN index.
// Run in CI and as a pre-deploy gate.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const productsTs = path.resolve(__dirname, '..', 'src', 'routes', 'products.ts');
const source = fs.readFileSync(productsTs, 'utf8');

function grabConst(name) {
  // Match:  const NAME = <number> ;
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
  return m ? Number(m[1]) : null;
}

describe('BUY-33987: /v1/products/search p99 regression guard', () => {
  it('SEARCH_STATEMENT_TIMEOUT_MS is at least 1000ms (would catch a revert to 30s+)', () => {
    const v = grabConst('SEARCH_STATEMENT_TIMEOUT_MS');
    assert.ok(v !== null, 'SEARCH_STATEMENT_TIMEOUT_MS must be declared in products.ts');
    assert.ok(
      v >= 1000,
      `SEARCH_STATEMENT_TIMEOUT_MS=${v}ms is below the 1000ms floor — the
       per-statement timer should be tight (5s) to fail fast on a hung DB.`
    );
  });

  it('SEARCH_HANDLER_TIMEOUT_MS is declared (the res.setTimeout() ceiling)', () => {
    const v = grabConst('SEARCH_HANDLER_TIMEOUT_MS');
    assert.ok(v !== null, 'SEARCH_HANDLER_TIMEOUT_MS must be declared in products.ts');
    assert.ok(
      v >= 1000 && v <= 30000,
      `SEARCH_HANDLER_TIMEOUT_MS=${v}ms is outside the 1s..30s sane range.`
    );
  });

  it('/search handler installs res.setTimeout(SEARCH_HANDLER_TIMEOUT_MS, …) at the top of the route', () => {
    // Find the /search route block and look for the res.setTimeout call.
    const searchIdx = source.indexOf("router.get(\n  '/search',");
    assert.ok(searchIdx > -1, "Could not find router.get('/search'…) in products.ts");
    const slice = source.slice(searchIdx, searchIdx + 1500);
    assert.ok(
      /res\.setTimeout\(\s*SEARCH_HANDLER_TIMEOUT_MS\b/.test(slice),
      'The /search handler must install res.setTimeout(SEARCH_HANDLER_TIMEOUT_MS, …).'
    );
  });

  it('/search dataQuery includes is_active = true (uses partial GIN index)', () => {
    // The first dataQuery CTE is the live /search path.
    const searchIdx = source.indexOf("router.get(\n  '/search',");
    assert.ok(searchIdx > -1, "Could not find router.get('/search'…) in products.ts");
    const slice = source.slice(searchIdx, searchIdx + 4000);
    assert.ok(
      /is_active\s*=\s*true/.test(slice),
      'The /search dataQuery must include `is_active = true` in the WHERE so the planner can pick the partial GIN index.'
    );
  });

  it('warmSearchCache CTE also includes is_active = true (matches live path)', () => {
    const warmIdx = source.indexOf('export async function warmSearchCache');
    assert.ok(warmIdx > -1, 'warmSearchCache must be exported from products.ts');
    const slice = source.slice(warmIdx, warmIdx + 3000);
    assert.ok(
      /is_active\s*=\s*true/.test(slice),
      'warmSearchCache must include `is_active = true` in its CTE so the warm path matches the live path.'
    );
  });
});
