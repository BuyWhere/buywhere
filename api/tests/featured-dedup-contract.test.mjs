import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const productsSource = readFileSync(join(__dirname, '../src/routes/products.ts'), 'utf8');

describe('BUY-79500: /v1/products/featured variant deduplication', () => {
  const featuredRouteStart = productsSource.indexOf('// GET /v1/products/featured');
  const detailRouteStart = productsSource.indexOf('// GET /v1/products/:id\n');

  it('locates the featured route before the detail route', () => {
    assert.ok(featuredRouteStart > -1, 'featured route marker not found');
    assert.ok(detailRouteStart > featuredRouteStart, 'detail route marker not found after featured route');
  });

  it('deduplicates rows by Shopify metadata.product_id with SKU fallback', () => {
    const featuredRoute = productsSource.slice(featuredRouteStart, detailRouteStart);

    assert.match(featuredRoute, /function dedupKey\(row: Record<string, unknown>\): string/);
    assert.match(featuredRoute, /meta\?\.product_id/);
    assert.match(featuredRoute, /source_id/);
    assert.match(featuredRoute, /seenProductKeys\.has\(key\)/);
    assert.match(featuredRoute, /distinctRows\.length < offset \+ limit/);
    assert.match(featuredRoute, /pagedRows\s*=\s*distinctRows\.slice\(offset,\s*offset\s*\+\s*limit\)/);
  });
});
