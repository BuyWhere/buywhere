import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildProduct, buildSearchResponse, CURRENCY_RATES, COUNTRY_CURRENCY, evaluateNearMiss } = require('../dist/lib/response');

// BUY-71393: keep response tests deterministic regardless of whatever FX rates
// earlier tests loaded into the module cache.
const fxLoader = require('../dist/lib/fxRatesLoader');
fxLoader.getCachedFxRates = () => CURRENCY_RATES;
fxLoader.loadFxRates = async () => CURRENCY_RATES;

describe('buildProduct', () => {
  const baseRow = {
    id: 'prod-1',
    title: 'Test Product',
    price: 99.99,
    currency: 'SGD',
    domain: 'shopee_sg',
    url: 'https://shopee.sg/product/1',
    image_url: 'https://shopee.sg/img/1.jpg',
    region: 'SEA',
    country_code: 'SG',
    updated_at: '2026-05-03T00:00:00Z',
    metadata: { brand: 'Test', category: 'Electronics' },
  };

  it('builds canonical product from DB row (non-compact)', () => {
    const product = buildProduct(baseRow, 'SGD', false);

    assert.equal(product.id, 'prod-1');
    assert.equal(product.title, 'Test Product');
    assert.equal(product.price.amount, 99.99);
    assert.equal(product.price.currency, 'SGD');
    assert.equal(product.merchant, 'shopee_sg');
    assert.equal(product.url, 'https://shopee.sg/product/1');
    assert.equal(product.image_url, 'https://shopee.sg/img/1.jpg');
    assert.equal(product.region, 'SEA');
    assert.equal(product.country_code, 'SG');
    assert.ok(product.updated_at);
    assert.deepEqual(product.metadata, { brand: 'Test', category: 'Electronics' });
    assert.equal(product.has_affiliate_tracking, true);
    assert.equal(product.is_affiliate, true);
    assert.match(product.affiliate_disclosure, /commission/i);
  });

  it('discloses generated affiliate redirects for clean merchant URLs', () => {
    const product = buildProduct({
      ...baseRow,
      affiliate_url: null,
      url: 'https://www.bestbuy.com/site/test-product/12345.p',
    }, 'USD', false);

    assert.equal(product.url, 'https://www.bestbuy.com/site/test-product/12345.p');
    assert.ok(product.affiliate_redirect_url);
    assert.equal(product.has_affiliate_tracking, true);
    assert.equal(product.is_affiliate, true);
    assert.match(product.affiliate_disclosure, /commission/i);
  });

  it('builds compact product with normalized price and specs', () => {
    const row = {
      ...baseRow,
      metadata: { brand: 'TestBrand', category: 'Electronics', model: 'X100' },
    };
    const product = buildProduct(row, 'SGD', true);

    assert.equal(product.canonical_id, 'prod-1');
    assert.ok(product.normalized_price_usd != null);
    assert.equal(product.normalized_price_usd, +(99.99 * CURRENCY_RATES.SGD).toFixed(4));
    assert.deepEqual(product.structured_specs, { brand: 'TestBrand', category: 'Electronics', model: 'X100' });
    assert.ok(Array.isArray(product.comparison_attributes));
    assert.equal(product.comparison_attributes.length, 4);
    assert.equal(product.comparison_attributes[0].key, 'brand');
    assert.equal(product.comparison_attributes[0].value, 'TestBrand');
    assert.equal(product.comparison_attributes[1].key, 'category');
    assert.equal(product.comparison_attributes[2].key, 'price');
    assert.equal(product.comparison_attributes[3].key, 'model');
  });

  it('compact mode does not include raw metadata', () => {
    const row = {
      ...baseRow,
      metadata: { brand: 'B' },
    };
    const product = buildProduct(row, 'SGD', true);
    assert.equal(product.metadata, undefined);
  });

  it('handles null price', () => {
    const row = { ...baseRow, price: null };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.price.amount, null);
  });

  it('exposes availability.in_stock and falls back to positive-price rows as in stock', () => {
    const product = buildProduct(baseRow, 'SGD', false);
    assert.deepEqual(product.availability, { in_stock: true, status: 'in_stock' });
  });

  it('honors explicit out-of-stock rows in availability.in_stock', () => {
    const product = buildProduct({ ...baseRow, in_stock: false }, 'SGD', false);
    assert.equal(product.in_stock, false);
    assert.deepEqual(product.availability, { in_stock: false, status: 'out_of_stock' });
  });

  it('handles missing image_url', () => {
    const row = { ...baseRow, image_url: null };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.image_url, null);
  });

  it('removes source.unsplash.com placeholder image URLs', () => {
    const row = { ...baseRow, image_url: 'https://source.unsplash.com/400x400/?laptop' };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.image_url, null);
  });

  it('preserves valid merchant image URLs', () => {
    const row = { ...baseRow, image_url: 'https://images.example.com/products/laptop.jpg' };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.image_url, 'https://images.example.com/products/laptop.jpg');
  });

  it('includes deal fields when present', () => {
    const row = { ...baseRow, original_price: 199.99, discount_pct: 50.0 };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.original_price, 199.99);
    assert.equal(product.discount_pct, 50.0);
  });

  it('uses default currency when row has no currency', () => {
    const row = { ...baseRow, currency: null };
    const product = buildProduct(row, 'USD', false);
    assert.equal(product.price.currency, 'USD');
  });

  it('falls back to null for unmatched country currency', () => {
    const row = { ...baseRow, country_code: 'XX' };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.price.currency, 'SGD');
  });

  it('BUY-71419: PHP accessories at 125-250 PHP retain price and availability', () => {
    // 125 PHP ≈ $2.20, 250 PHP ≈ $4.40 — legitimate accessories, not feed errors
    const phpRows = [
      { ...baseRow, price: 125, currency: 'PHP', in_stock: true },
      { ...baseRow, price: 250, currency: 'PHP', in_stock: true },
    ];
    for (const row of phpRows) {
      const product = buildProduct(row, 'PHP', false);
      assert.equal(product.price.amount, row.price, `PHP ${row.price} should not be nullified`);
      assert.equal(product.price.currency, 'PHP');
      assert.equal(product.availability.in_stock, true);
      assert.equal(product.availability.status, 'in_stock');
    }
  });

  it('BUY-71419: non-USD prices >= 1 pass through; zero/null prices are nullified', () => {
    const belowFloor = buildProduct({ ...baseRow, price: 0, currency: 'SGD' }, 'SGD', false);
    assert.equal(belowFloor.price.amount, null, 'SGD 0 should be nullified');

    const atFloor = buildProduct({ ...baseRow, price: 1, currency: 'VND' }, 'VND', false);
    assert.equal(atFloor.price.amount, 1, 'VND 1 should pass');
  });

  it('BUY-63738: USD prices under $5 are nullified (laptop feed errors)', () => {
    const belowFloor = buildProduct({ ...baseRow, price: 1, currency: 'USD' }, 'USD', false);
    assert.equal(belowFloor.price.amount, null, '$1 should be nullified');
    assert.equal(belowFloor.availability.in_stock, false, '$1 product should be out_of_stock');

    const atFloor = buildProduct({ ...baseRow, price: 4.99, currency: 'USD' }, 'USD', false);
    assert.equal(atFloor.price.amount, null, '$4.99 should be nullified');
  });

  it('BUY-63738: USD prices at $5+ pass through', () => {
    const atFloor = buildProduct({ ...baseRow, price: 5, currency: 'USD' }, 'USD', false);
    assert.equal(atFloor.price.amount, 5, '$5 should pass');
  });

  it('handles metadata extraction in compact mode with minimal fields', () => {
    const row = {
      ...baseRow,
      metadata: { brand: 'JustBrand' },
    };
    const product = buildProduct(row, 'SGD', true);
    assert.equal(product.structured_specs.brand, 'JustBrand');
    assert.equal(product.comparison_attributes.length, 2);
  });

  it('handles empty metadata in non-compact mode', () => {
    const row = { ...baseRow, metadata: null };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.metadata, null);
  });

  it('canonical_id not present in non-compact mode', () => {
    const product = buildProduct(baseRow, 'SGD', false);
    assert.equal(product.canonical_id, undefined);
  });
});

describe('buildSearchResponse', () => {
  const sampleProduct = {
    id: 'p1', title: 'P1', price: { amount: 10, currency: 'SGD' },
    merchant: 'm1', url: 'https://x.com/p1', image_url: null,
    region: null, country_code: null, updated_at: null,
  };

  it('wraps products with metadata', () => {
    const res = buildSearchResponse([sampleProduct], 1, 20, 0, 150, false);

    assert.equal(res.data.length, 1);
    assert.equal(res.meta.total, 1);
    assert.equal(res.meta.limit, 20);
    assert.equal(res.meta.offset, 0);
    assert.equal(res.meta.response_time_ms, 150);
    assert.equal(res.meta.cached, false);
    assert.deepEqual(res.data[0], sampleProduct);
  });

  it('reports cached=true', () => {
    const res = buildSearchResponse([], 0, 20, 0, 5, true);
    assert.equal(res.meta.cached, true);
  });

  it('handles empty results', () => {
    const res = buildSearchResponse([], 0, 20, 0, 10, false);
    assert.equal(res.data.length, 0);
    assert.equal(res.meta.total, 0);
  });

  it('handles pagination offset', () => {
    const res = buildSearchResponse([], 100, 10, 30, 20, false);
    assert.equal(res.meta.limit, 10);
    assert.equal(res.meta.offset, 30);
  });

  it('response_time_ms is always a number', () => {
    const res = buildSearchResponse([sampleProduct], 1, 20, 0, 0, false);
    assert.equal(typeof res.meta.response_time_ms, 'number');
    assert.equal(res.meta.response_time_ms, 0);
  });

  it('preserves product array order', () => {
    const p2 = { ...sampleProduct, id: 'p2' };
    const p3 = { ...sampleProduct, id: 'p3' };
    const res = buildSearchResponse([sampleProduct, p2, p3], 3, 20, 0, 5, false);
    assert.equal(res.data[0].id, 'p1');
    assert.equal(res.data[1].id, 'p2');
    assert.equal(res.data[2].id, 'p3');
  });
});

describe('price sanitizer (BUY-71393)', () => {
  const baseRow = {
    id: 'prod-1',
    title: 'Test Product',
    price: 99.99,
    currency: 'SGD',
    domain: 'shopee_sg',
    url: 'https://shopee.sg/product/1',
    image_url: 'https://shopee.sg/img/1.jpg',
    region: 'SEA',
    country_code: 'SG',
    updated_at: '2026-05-03T00:00:00Z',
    metadata: { brand: 'Test', category: 'Electronics' },
  };

  it('preserves high-value SGD prices that are within the USD band', () => {
    const product = buildProduct({ ...baseRow, price: 10799, currency: 'SGD' }, 'SGD', false);
    assert.equal(product.price.amount, 10799);
    assert.equal(product.price.currency, 'SGD');
  });

  it('preserves high-value THB prices that are within the USD band', () => {
    const product = buildProduct({ ...baseRow, price: 46490, currency: 'THB' }, 'THB', false);
    assert.equal(product.price.amount, 46490);
    assert.equal(product.price.currency, 'THB');
  });

  it('nullifies VND prices above the USD maximum', () => {
    const product = buildProduct({ ...baseRow, price: 300_000_000, currency: 'VND' }, 'VND', false);
    assert.equal(product.price.amount, null);
  });

  it('preserves VND prices within the USD band', () => {
    const product = buildProduct({ ...baseRow, price: 200_000_000, currency: 'VND' }, 'VND', false);
    assert.equal(product.price.amount, 200_000_000);
  });

  it('nullifies USD prices above the USD maximum', () => {
    const product = buildProduct({ ...baseRow, price: 12000, currency: 'USD' }, 'USD', false);
    assert.equal(product.price.amount, null);
  });

  it('nullifies USD prices below the USD minimum', () => {
    const product = buildProduct({ ...baseRow, price: 3, currency: 'USD' }, 'USD', false);
    assert.equal(product.price.amount, null);
  });

  it('preserves GBP prices within the USD band', () => {
    const product = buildProduct({ ...baseRow, price: 5000, currency: 'GBP' }, 'GBP', false);
    assert.equal(product.price.amount, 5000);
  });

  it('nullifies GBP prices above the USD maximum', () => {
    const product = buildProduct({ ...baseRow, price: 15000, currency: 'GBP' }, 'GBP', false);
    assert.equal(product.price.amount, null);
  });
});

describe('COUNTRY_CURRENCY', () => {
  it('maps known country codes to currencies', () => {
    assert.equal(COUNTRY_CURRENCY.SG, 'SGD');
    assert.equal(COUNTRY_CURRENCY.US, 'USD');
    assert.equal(COUNTRY_CURRENCY.GB, 'GBP');
    assert.equal(COUNTRY_CURRENCY.VN, 'VND');
    assert.equal(COUNTRY_CURRENCY.TH, 'THB');
    assert.equal(COUNTRY_CURRENCY.MY, 'MYR');
  });
});

describe('evaluateNearMiss', () => {
  const goodProduct = {
    id: 'p1', title: 'P1', price: { amount: 99, currency: 'SGD' },
    merchant: 'shop', url: 'https://shop.sg/p1', image_url: 'https://shop.sg/img.jpg',
    region: null, country_code: 'SG', updated_at: null, availability: { in_stock: true, status: 'in_stock' },
    has_affiliate_tracking: false, is_affiliate: false,
  };
  it('returns near_miss=false for zero rows', () => {
    const result = evaluateNearMiss([]);
    assert.equal(result.near_miss, false);
    assert.deepEqual(result.near_miss_predicate_fails, []);
  });
  it('returns near_miss=false for multiple rows', () => {
    const result = evaluateNearMiss([goodProduct, { ...goodProduct, id: 'p2' }]);
    assert.equal(result.near_miss, false);
  });
  it('returns near_miss=false for single good row', () => {
    const result = evaluateNearMiss([goodProduct], 'SG');
    assert.equal(result.near_miss, false);
    assert.deepEqual(result.near_miss_predicate_fails, []);
  });
  it('flags missing price', () => {
    const result = evaluateNearMiss([{ ...goodProduct, price: { amount: null, currency: 'SGD' } }], 'SG');
    assert.equal(result.near_miss, true);
    assert.ok(result.near_miss_predicate_fails.includes('price'));
  });
  it('flags zero price', () => {
    const result = evaluateNearMiss([{ ...goodProduct, price: { amount: 0, currency: 'SGD' } }], 'SG');
    assert.equal(result.near_miss, true);
    assert.ok(result.near_miss_predicate_fails.includes('price'));
  });
  it('flags wrong currency for country', () => {
    const result = evaluateNearMiss([{ ...goodProduct, price: { amount: 10, currency: 'USD' } }], 'SG');
    assert.equal(result.near_miss, true);
    assert.ok(result.near_miss_predicate_fails.includes('price'));
  });
  it('flags missing currency', () => {
    const result = evaluateNearMiss([{ ...goodProduct, price: { amount: 10, currency: null } }], 'SG');
    assert.equal(result.near_miss, true);
    assert.ok(result.near_miss_predicate_fails.includes('currency'));
  });
  it('flags non-ISO currency', () => {
    const result = evaluateNearMiss([{ ...goodProduct, price: { amount: 10, currency: 'XYZ' } }], 'SG');
    assert.equal(result.near_miss, true);
    assert.ok(result.near_miss_predicate_fails.includes('currency'));
  });
  it('flags missing availability', () => {
    const result = evaluateNearMiss([{ ...goodProduct, availability: undefined }], 'SG');
    assert.equal(result.near_miss, true);
    assert.ok(result.near_miss_predicate_fails.includes('availability'));
  });
  it('flags missing image_url', () => {
    const result = evaluateNearMiss([{ ...goodProduct, image_url: null }], 'SG');
    assert.equal(result.near_miss, true);
    assert.ok(result.near_miss_predicate_fails.includes('image_url'));
  });
  it('accepts branded SVG as usable image', () => {
    const result = evaluateNearMiss([{ ...goodProduct, image_url: 'data:image/svg+xml;base64,PHN2Zz4=' }], 'SG');
    assert.equal(result.near_miss, false);
  });
  it('flags dead merchant URL via url_status', () => {
    const result = evaluateNearMiss([{ ...goodProduct, url_status: 'dead' }], 'SG');
    assert.equal(result.near_miss, true);
    assert.ok(result.near_miss_predicate_fails.includes('merchant_url'));
  });
  it('flags missing URL', () => {
    const result = evaluateNearMiss([{ ...goodProduct, url: '' }], 'SG');
    assert.equal(result.near_miss, true);
    assert.ok(result.near_miss_predicate_fails.includes('merchant_url'));
  });
});
