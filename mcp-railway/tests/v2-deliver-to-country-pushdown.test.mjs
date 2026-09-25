// BUY-69998: v2 deliver_to must propagate to v1 country_code so the query
// is filtered by the requested market. This prevents cross-market results
// and statement_timeout on unfiltered full-table scans.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mcpPath = path.join(__dirname, '..', 'src', 'routes', 'mcp.ts');
const src = readFileSync(mcpPath, 'utf-8');

const V2_HANDLERS = [
  'handleSearchProductsV2',
  'handleGetDealsV2',
  'handleCompareProductsV2',
  'handleFindBestPriceV2',
  'handleGetProductV2',
];

for (const name of V2_HANDLERS) {
  test(`${name} pushes deliverTo into args.country_code before v1 call`, () => {
    const idx = src.indexOf(`async function ${name}`);
    assert.ok(idx >= 0, `${name} not found`);
    const nextFn = src.indexOf('async function', idx + 30);
    const fnBody = src.slice(idx, nextFn > 0 ? nextFn : idx + 2000);
    const deliverAssign = fnBody.indexOf('args.country_code = deliverTo');
    assert.ok(deliverAssign >= 0, `${name} must assign args.country_code = deliverTo`);
    const v1Call = /await handle(?:SearchProducts|GetDeals|CompareProducts|FindBestPrice|GetProduct)\(args\)/;
    assert.match(fnBody, v1Call, `${name} must call the v1 handler`);
    const assignBeforeCall = deliverAssign < fnBody.search(v1Call);
    assert.ok(assignBeforeCall, `${name} must assign country_code BEFORE the v1 handler call`);
  });
}
