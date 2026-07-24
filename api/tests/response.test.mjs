import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildProduct, buildSearchResponse, CURRENCY_RATES, COUNTRY_CURRENCY } = require('../dist/lib/response');

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

  it('handles missing image_url', () => {
    const row = { ...baseRow, image_url: null };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.image_url, null);
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

    assert.equal(res.results.length, 1);
    assert.equal(res.total, 1);
    assert.equal(res.page.limit, 20);
    assert.equal(res.page.offset, 0);
    assert.equal(res.response_time_ms, 150);
    assert.equal(res.cached, false);
    assert.deepEqual(res.results[0], sampleProduct);
  });

  it('reports cached=true', () => {
    const res = buildSearchResponse([], 0, 20, 0, 5, true);
    assert.equal(res.cached, true);
  });

  it('handles empty results', () => {
    const res = buildSearchResponse([], 0, 20, 0, 10, false);
    assert.equal(res.results.length, 0);
    assert.equal(res.total, 0);
  });

  it('handles pagination offset', () => {
    const res = buildSearchResponse([], 100, 10, 30, 20, false);
    assert.equal(res.page.limit, 10);
    assert.equal(res.page.offset, 30);
  });

  it('response_time_ms is always a number', () => {
    const res = buildSearchResponse([sampleProduct], 1, 20, 0, 0, false);
    assert.equal(typeof res.response_time_ms, 'number');
    assert.equal(res.response_time_ms, 0);
  });

  it('preserves product array order', () => {
    const p2 = { ...sampleProduct, id: 'p2' };
    const p3 = { ...sampleProduct, id: 'p3' };
    const res = buildSearchResponse([sampleProduct, p2, p3], 3, 20, 0, 5, false);
    assert.equal(res.results[0].id, 'p1');
    assert.equal(res.results[1].id, 'p2');
    assert.equal(res.results[2].id, 'p3');
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
