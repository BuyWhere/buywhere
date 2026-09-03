// BUY-66199: regression test for currency normalization in search_products.
//
// A search_products query with country_code=US returned real results whose
// prices were in EUR (a .eu merchant mislabeled country_code=US). The native
// EUR currency must be preserved honestly (we never relabel an amount to a
// currency it wasn't priced in), BUT the response must now also carry a
// correct FX-normalized normalized_price_usd so US-market callers have a USD
// reference — matching find_best_price, which already exposes USD.
//
// This mirrors the shape of api/tests/response.test.mjs and runs under
// `node --test` against the compiled dist (npm test target).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildProduct, CURRENCY_RATES, extractNumericPrice } = require('../dist/lib/response');

describe('buildProduct currency normalization (BUY-66199)', () => {
  // Mirrors the live evidence row from mcp.buywhere.ai at 2026-08-04T18:00Z.
  const eurRowMislabeledAsUS = {
    id: 'ev-kits-iphone',
    title: 'EV Kits - iPhone',
    price: '99.98',            // EUR amount, as stored
    currency: 'EUR',           // native storefront currency
    domain: 'shopify_buy30620_crate',
    url: 'https://quadlockcase.eu/products/ev-kits-iphone',
    image_url: null,
    region: 'us',
    country_code: 'US',        // mislabel: .eu merchant tagged US
    updated_at: '2026-08-04T18:00:00Z',
    metadata: { brand: 'Quad Lock' },
  };

  it('exposes normalized_price_usd in NON-compact responses (the regression)', () => {
    // defaultCurrency 'USD' is the country_code=US derived default; the row's
    // EUR wins for price.currency, but USD must still be derivable.
    const product = buildProduct(eurRowMislabeledAsUS, 'USD', false);
    assert.equal(product.price.currency, 'EUR', 'native currency preserved, not silently relabeled');
    assert.equal(product.price.amount, 99.98);
    assert.equal(product.country_code, 'US');
    // EUR must be in the rate table, else normalized_price_usd is null.
    assert.equal(CURRENCY_RATES.EUR, 1.09);
    assert.equal(product.normalized_price_usd, +(99.98 * 1.09).toFixed(4));
  });

  it('still exposes normalized_price_usd in compact responses (unchanged)', () => {
    const product = buildProduct(eurRowMislabeledAsUS, 'USD', true);
    assert.equal(product.price.currency, 'EUR');
    assert.equal(product.normalized_price_usd, +(99.98 * 1.09).toFixed(4));
    assert.equal(product.canonical_id, 'ev-kits-iphone');
  });

  it('normalizes a genuine USD US row to the same amount (rate 1)', () => {
    const product = buildProduct(
      { ...eurRowMislabeledAsUS, currency: 'USD', price: '108.00' },
      'USD',
      false,
    );
    assert.equal(product.price.currency, 'USD');
    assert.equal(product.normalized_price_usd, 108);
  });

  it('falls back to the country default currency when the row has none', () => {
    const product = buildProduct({ ...eurRowMislabeledAsUS, currency: null }, 'USD', false);
    assert.equal(product.price.currency, 'USD');
    assert.equal(product.normalized_price_usd, +(99.98 * 1).toFixed(4));
  });

  it('returns null normalized_price_usd for an unknown currency (no silent wrong number)', () => {
    const product = buildProduct({ ...eurRowMislabeledAsUS, currency: 'XYZ' }, 'USD', false);
    // We do NOT fabricate a USD figure for a currency we have no rate for.
    assert.equal(product.normalized_price_usd, null);
    assert.equal(product.price.currency, 'XYZ');
  });
});

describe('BUY-80524: FBP v1 amount must survive numeric pg prices', () => {
  function mapFbpAmount(raw) {
    // Mirrors mcp-railway handleFindBestPrice mapping after BUY-80524.
    return extractNumericPrice(raw);
  }

  it('keeps a JS number from node-pg numeric/float8', () => {
    assert.equal(mapFbpAmount(18.59), 18.59);
  });

  it('still parses string numeric from text-mode pg', () => {
    assert.equal(mapFbpAmount('42.55'), 42.55);
  });

  it('unwraps nested {amount,currency} from REST fallback rows', () => {
    assert.equal(mapFbpAmount({ amount: 82, currency: 'SGD' }), 82);
  });

  it('JSON-serializes a finite amount, never NaN→null', () => {
    const amount = mapFbpAmount(75.57);
    const encoded = JSON.parse(JSON.stringify({ price: { amount, currency: 'SGD' } }));
    assert.equal(encoded.price.amount, 75.57);
  });
});


describe('BUY-69998: country_code and region agree', () => {
  it('replaces leftover sg region on a US row', () => {
    const product = buildProduct(
      { ...eurRowMislabeledAsUS, country_code: 'US', region: 'sg' },
      'USD',
      false,
    );
    assert.equal(product.country_code, 'US');
    assert.equal(product.region, 'us');
  });

  it('uses vn region for VN rows', () => {
    const product = buildProduct(
      { ...eurRowMislabeledAsUS, country_code: 'VN', region: 'sg', currency: 'VND' },
      'VND',
      false,
    );
    assert.equal(product.country_code, 'VN');
    assert.equal(product.region, 'vn');
  });
});
