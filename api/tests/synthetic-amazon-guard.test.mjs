// BUY-72744: regression guard for synthetic Amazon rows leaking into /search.
// The live failure was 40/40 thinkpad+US rows from amazon.com with malformed
// 11-char ASINs (B + 10 digits) and US-priced-as-SGD currency. Keep both the
// tier-search and archive-search paths excluding those stale/catalog-generated rows.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const productsTs = path.resolve(__dirname, '..', 'src', 'routes', 'products.ts');
const source = fs.readFileSync(productsTs, 'utf8');

describe('BUY-72744: synthetic Amazon search-result guard', () => {
  it('tier search excludes amazon.com rows with malformed ASINs or US-priced-as-SGD currency', () => {
    const tierIdx = source.indexOf('async function tryTierSearch');
    assert.ok(tierIdx > -1, 'tryTierSearch must exist');
    const slice = source.slice(tierIdx, tierIdx + 7000);

    assert.match(slice, /sp\.merchant_id\s*=\s*'amazon\.com'/, 'tier search must target amazon.com rows');
    assert.match(slice, /length\(sp\.sku\)\s*!=\s*10/, 'tier search must reject malformed ASIN lengths');
    assert.match(slice, /sp\.country_code\s*=\s*'US'\s+AND\s+sp\.currency\s*=\s*'SGD'/, 'tier search must reject US-priced-as-SGD rows');
  });

  it('archive search baseConditions exclude amazon.com rows with malformed ASINs or US-priced-as-SGD currency', () => {
    const searchIdx = source.indexOf("router.get(\n  '/search',");
    assert.ok(searchIdx > -1, "Could not find router.get('/search'…) in products.ts");
    // BUY-74246 + earlier additions grew products.ts past 12KB after '/search'.
    // Slice the full archive handler (we just need to see the baseConditions block
    // near the start of the handler, which is well within 18KB).
    const slice = source.slice(searchIdx, searchIdx + 18000);

    assert.match(slice, /merchant_id\s*=\s*'amazon\.com'/, 'archive search must target amazon.com rows');
    assert.match(slice, /length\(sku\)\s*!=\s*10/, 'archive search must reject malformed ASIN lengths');
    assert.match(slice, /country_code\s*=\s*'US'\s+AND\s+currency\s*=\s*'SGD'/, 'archive search must reject US-priced-as-SGD rows');
  });
});
