import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const productsSource = readFileSync(join(__dirname, '../src/routes/products.ts'), 'utf8');

describe('BUY-73753: /v1/products list contract', () => {
  it('requires an explicit country instead of silently defaulting to SG', () => {
    const listRouteStart = productsSource.indexOf('// GET /v1/products');
    const searchRouteStart = productsSource.indexOf('// GET /v1/products/search');
    assert.ok(listRouteStart > -1, 'list route marker not found');
    assert.ok(searchRouteStart > listRouteStart, 'search route marker not found after list route');

    const listRoute = productsSource.slice(listRouteStart, searchRouteStart);
    assert.match(listRoute, /error:\s*'country_required'/);
    assert.doesNotMatch(listRoute, /countryCode\s*=.*\|\|\s*'SG'/);
  });

  it('projects category_path through the canonical product response', () => {
    const responseSource = readFileSync(join(__dirname, '../src/lib/response.ts'), 'utf8');
    assert.match(responseSource, /category_path/);
    assert.match(responseSource, /Array\.isArray\(row\.category_path\)/);
  });
});
