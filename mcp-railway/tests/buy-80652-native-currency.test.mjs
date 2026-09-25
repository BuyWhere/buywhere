// BUY-80652: SG/MY search must drop USD Shopify; unknown currency is not native.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { extractRowCurrency, filterNativeCurrencyRows } = require('../dist/lib/response');

describe('BUY-80652 native currency isolation', () => {
  it('drops USD Shopify labelled SG when mixed with SGD', () => {
    const rows = [
      { title: 'Callaway polo', currency: 'USD', country_code: 'SG', merchant: 'callawayapparel.myshopify.com' },
      { title: 'Carpenter Fold Shirt', price: { amount: 95, currency: 'SGD' }, country_code: 'SG' },
    ];
    const out = filterNativeCurrencyRows(rows, 'SG');
    assert.equal(out.length, 1);
    assert.equal(extractRowCurrency(out[0]), 'SGD');
  });

  it('returns empty rather than leaking only-USD MY shirts', () => {
    const rows = [
      { title: 'White Pocket Tee', price: { amount: 229, currency: 'USD' }, country_code: 'MY' },
    ];
    const out = filterNativeCurrencyRows(rows, 'MY');
    assert.equal(out.length, 0);
  });

  it('keeps MYR', () => {
    const rows = [
      { title: 'Tee', currency: 'MYR', country_code: 'MY' },
    ];
    const out = filterNativeCurrencyRows(rows, 'MY');
    assert.equal(out.length, 1);
  });
});
