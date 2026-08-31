import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const productsSource = readFileSync(join(__dirname, '../src/routes/products.ts'), 'utf8');

describe('BUY-73753: /v1/products list contract', () => {
  it('treats deliver_to as the hard buyer-market filter for search (BUY-75564)', () => {
    const searchRouteStart = productsSource.indexOf('// GET /v1/products/search');
    assert.ok(searchRouteStart > -1, 'search route marker not found');
    const searchRoute = productsSource.slice(searchRouteStart);

    assert.match(searchRoute, /const explicitDeliverTo = \(\(req\.query\.deliver_to as string\) \|\| ''\)\.toUpperCase\(\) \|\| undefined/);
    assert.match(searchRoute, /const explicitCountry = explicitDeliverTo \|\| \(\(req\.query\.country_code as string \| undefined\) \|\| \(req\.query\.country as string \| undefined\)\)\?\.toUpperCase\(\) \|\| undefined/);
    assert.match(searchRoute, /const countryCode = explicitCountry/);
    assert.ok(productsSource.includes('if (p.countryCode) { conds.push(`sp.country_code = $${i}`); params.push(p.countryCode); i++; }'));
    assert.match(searchRoute, /if \(countryCode\) \{\s*\/\/ Explicit country_code is a HARD filter[\s\S]*?baseConditions\.push\(`country_code = \$\$\{baseIdx\}`\)/);
    assert.doesNotMatch(searchRoute, /never hard-filters/);
  });

  it('requires an explicit country instead of silently defaulting to SG', () => {
    const listRouteStart = productsSource.indexOf('// GET /v1/products');
    const searchRouteStart = productsSource.indexOf('// GET /v1/products/search');
    assert.ok(listRouteStart > -1, 'list route marker not found');
    assert.ok(searchRouteStart > listRouteStart, 'search route marker not found after list route');

    const listRoute = productsSource.slice(listRouteStart, searchRouteStart);
    assert.match(listRoute, /error:\s*'country_required'/);
    assert.doesNotMatch(listRoute, /countryCode\s*=.*\|\|\s*'SG'/);
  });

  it('keeps the default country browse path unordered so low-volume markets do not full-sort', () => {
    const listRouteStart = productsSource.indexOf('// GET /v1/products');
    const searchRouteStart = productsSource.indexOf('// GET /v1/products/search');
    const listRoute = productsSource.slice(listRouteStart, searchRouteStart);

    assert.match(listRoute, /const requestedSortParam = req\.query\.sort/);
    assert.match(listRoute, /const orderBy = sortColumn \? `ORDER BY products\.\$\{sortColumn\} \$\{order\}, products\.id DESC` : ''/);
    assert.doesNotMatch(listRoute, /const orderBy = `ORDER BY products\.id DESC`/);
  });

  it('queries the partitioned products table for country browse pages', () => {
    const listRouteStart = productsSource.indexOf('// GET /v1/products');
    const searchRouteStart = productsSource.indexOf('// GET /v1/products/search');
    const listRoute = productsSource.slice(listRouteStart, searchRouteStart);

    assert.match(listRoute, /const LIST_PRODUCTS_TABLE = 'products'/);
    assert.match(listRoute, /FROM \$\{LIST_PRODUCTS_TABLE\} AS products/);
    assert.match(listRoute, /EXPLAIN SELECT 1 FROM \$\{LIST_PRODUCTS_TABLE\} AS products/);
  });

  it('projects category_path through the canonical product response', () => {
    const responseSource = readFileSync(join(__dirname, '../src/lib/response.ts'), 'utf8');
    assert.match(responseSource, /category_path/);
    assert.match(responseSource, /Array\.isArray\(row\.category_path\)/);
  });

  // BUY-74513: when the EXPLAIN count sub-query falls back to pg_class
  // (the SAME global number for every country call), the response must
  // mark pagination.total=null and surface meta.degraded=true +
  // meta.approximate=true so consumers don't treat the bogus 89M US-lie
  // as a real catalog size. Wake: required contract on /v1/products.
  it('surfaces meta.degraded=true + meta.approximate=true when count falls back to pg_class (BUY-74513)', () => {
    const listRouteStart = productsSource.indexOf('// GET /v1/products');
    const searchRouteStart = productsSource.indexOf('// GET /v1/products/search');
    const listRoute = productsSource.slice(listRouteStart, searchRouteStart);

    assert.match(listRoute, /let countDegraded = false/);
    assert.match(listRoute, /countDegraded = true/);
    assert.match(listRoute, /degraded:\s*true/);
    assert.match(listRoute, /approximate:\s*true/);
    assert.match(listRoute, /count_source:\s*'pg_class_fallback'/);
    assert.match(listRoute, /reason:\s*'EXPLAIN_count_failed'/);
    assert.match(listRoute, /const total = countDegraded \? null : rawTotal/);
  });

  // BUY-74513: cap /v1/catalog/stats tryExactCount under the 30s gateway
  // timeout so the route fails fast and the degraded envelope can fire
  // instead of hanging at the edge for 60s+.
  it('caps /v1/catalog/stats tryExactCount under 30s gateway timeout (BUY-74513)', () => {
    const catalogSource = readFileSync(join(__dirname, '../src/routes/catalog.ts'), 'utf8');
    assert.doesNotMatch(catalogSource, /tryExactCount\(60000\)/);
    assert.match(catalogSource, /tryExactCount\(25000\)/);
  });
});
