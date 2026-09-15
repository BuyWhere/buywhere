import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const productsSource = readFileSync(join(__dirname, '../src/routes/products.ts'), 'utf8');

describe('BUY-77888 list diversity', () => {
  it('caps merchants and bumps list cache to v3', () => {
    const listRouteStart = productsSource.indexOf('// GET /v1/products');
    const searchRouteStart = productsSource.indexOf('// GET /v1/products/search');
    const listRoute = productsSource.slice(listRouteStart, searchRouteStart);
    assert.match(productsSource, /const LIST_MERCHANT_CAP = 2/);
    assert.match(productsSource, /const LIST_DIVERSITY_FETCH = 20000/);
    assert.match(listRoute, /list:v4:/);
    assert.match(listRoute, /diversifyListRows/);
    assert.match(listRoute, /applyListDiversity/);
    assert.match(listRoute, /merchant_rn/);
  });
});
