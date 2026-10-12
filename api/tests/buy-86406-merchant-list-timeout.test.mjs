import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const productsSource = readFileSync(join(__dirname, '../src/routes/products.ts'), 'utf8');

describe('BUY-86406 merchant list timeout', () => {
  const listRouteStart = productsSource.indexOf('// GET /v1/products');
  const searchRouteStart = productsSource.indexOf('// GET /v1/products/search');
  const listRoute = productsSource.slice(listRouteStart, searchRouteStart);

  it('accepts merchant_id / merchant / merchant_domain aliases', () => {
    assert.match(listRoute, /req\.query\.merchant_id/);
    assert.match(listRoute, /req\.query\.merchant_domain/);
    assert.match(listRoute, /conditions\.push\(`merchant_id = \$\${idx}`\)/);
  });

  it('routes merchant/source filters to parent products table', () => {
    assert.match(listRoute, /const filterRequiresParent = Boolean\(merchantId \|\| source\)/);
    assert.match(listRoute, /!filterRequiresParent &&/);
  });

  it('skips diversity over-fetch and uses 8s timeout on parent-table merchant filters', () => {
    assert.match(listRoute, /const skipDiversity = Boolean\(filterRequiresParent \|\| sortProvided\)/);
    assert.match(listRoute, /filterRequiresParent \|\| !LIVE_LIST_CHILD_COUNTRIES\.has\(countryCode\) \? '8s' : '4s'/);
    assert.match(listRoute, /skipDiversity \? limit : LIST_DIVERSITY_FETCH/);
  });
});
