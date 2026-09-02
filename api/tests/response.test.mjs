import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildProduct, buildSearchResponse, CURRENCY_RATES, COUNTRY_CURRENCY, deriveEmptiness } = require('../dist/lib/response');

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
    category_path: ['Electronics', 'Laptops'],
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
    assert.equal(product.region, 'sg');
    assert.equal(product.country_code, 'SG');
    assert.ok(product.updated_at);
    assert.deepEqual(product.category_path, ['Electronics', 'Laptops']);
    // BUY-78233: both meta and metadata must be exposed
    assert.deepEqual(product.metadata, { brand: 'Test', category: 'Electronics' });
    assert.deepEqual(product.meta, { brand: 'Test', category: 'Electronics' });
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

  it('BUY-79642: ISO region from country_code, nested REST price', () => {
    const nested = buildProduct({
      ...baseRow,
      region: 'sea',
      country_code: 'SG',
      price: { amount: 1299, currency: 'SGD' },
    }, 'SGD', false);
    assert.equal(nested.region, 'sg');
    assert.equal(nested.price.amount, 1299);
    assert.equal(nested.price.currency, 'SGD');

    const us = buildProduct({
      ...baseRow,
      region: 'sea',
      country_code: 'US',
      currency: 'USD',
      price: 999,
    }, 'USD', false);
    assert.equal(us.region, 'us');
    assert.equal(us.price.amount, 999);
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

  it('BUY-79816: nulls Best Denki Magento placeholder JPEGs', () => {
    const row = {
      ...baseRow,
      image_url:
        'https://cdn.bestdenki.com.sg/media/catalog/product/cache/7eb369f27775f2db92648609527c34e5/2/9/2918110-1.jpg',
    };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.image_url, null);
  });

  it('removes ASIN-derived Amazon media URLs', () => {
    const row = { ...baseRow, image_url: 'https://m.media-amazon.com/images/I/B10162255701._AC_SY360_.jpg' };
    const product = buildProduct(row, 'USD', false);
    assert.equal(product.image_url, null);
  });

  it('preserves real Amazon media URLs', () => {
    const row = { ...baseRow, image_url: 'https://m.media-amazon.com/images/I/61vJtKbAssL._AC_SL1500_.jpg' };
    const product = buildProduct(row, 'USD', false);
    assert.equal(product.image_url, 'https://m.media-amazon.com/images/I/61vJtKbAssL._AC_SL1500_.jpg');
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

  describe('mode-identity (BUY-76440)', () => {
    it('defaults to no mode_used on non-search builders', () => {
      const res = buildSearchResponse([sampleProduct], 1, 20, 0, 5, false);
      assert.equal(res.meta.mode_used, undefined);
      assert.equal(res.meta.mode_used_engine, undefined);
    });

    it('emits mode_used=_semantic_ + pgvector engine when mode=semantic', () => {
      const res = buildSearchResponse([sampleProduct], 1, 20, 0, 5, false, undefined, false, 'US', null, 'semantic');
      assert.equal(res.meta.mode_used, 'semantic');
      assert.match(res.meta.mode_used_engine, /pgvector hnsw/i);
    });

    it('emits mode_used=hybrid + rrf engine when mode=hybrid', () => {
      const res = buildSearchResponse([sampleProduct], 1, 20, 0, 5, false, undefined, false, 'US', null, 'hybrid');
      assert.equal(res.meta.mode_used, 'hybrid');
      assert.match(res.meta.mode_used_engine, /rrf/i);
    });

    it('emits mode_used=keyword + fts engine when mode=keyword', () => {
      const res = buildSearchResponse([sampleProduct], 1, 20, 0, 5, false, undefined, false, 'US', null, 'keyword');
      assert.equal(res.meta.mode_used, 'keyword');
      assert.match(res.meta.mode_used_engine, /fts/i);
    });

    it('mode_used stays present on empty degraded envelopes', () => {
      const res = buildSearchResponse([], 0, 20, 0, 5, false, true, false, 'US', null, 'semantic');
      assert.equal(res.meta.mode_used, 'semantic');
      assert.equal(res.meta.degraded, true);
    });
  });
});

describe('deriveEmptiness (BUY-71542 + BUY-72044 / P2.6A)', () => {
  const baseSignals = {
    regionHasAnyData: true,
    categoryHasAnyData: true,
    apiError: false,
    rateLimited: false,
    regionSupported: true,
    categoryRequested: false,
    requestedCategory: null,
    requestedCountry: 'SG',
    rateLimitRemaining: null,
    deliverToPresent: true,
    unfilteredHasAnyData: null,
    queryAmbiguous: null,
  };

  it('returns deliver_to_missing when caller omitted buyer market', () => {
    const derived = deriveEmptiness({
      ...baseSignals,
      deliverToPresent: false,
      unfilteredHasAnyData: null,
    });

    assert.equal(derived.emptiness_reason, 'deliver_to_missing');
    assert.equal(derived.diagnostic.deliver_to_present, false);
    assert.equal(derived.confidence, 'high');
  });

  it('returns no_match for supported empty searches with no global match', () => {
    const derived = deriveEmptiness({ ...baseSignals, unfilteredHasAnyData: false });

    assert.equal(derived.emptiness_reason, 'no_match');
    assert.equal(derived.confidence, 'high');
  });

  it('returns region_unsupported for unsupported regions', () => {
    const derived = deriveEmptiness({
      ...baseSignals,
      regionSupported: false,
      requestedCountry: 'ZZ',
    });

    assert.equal(derived.emptiness_reason, 'region_unsupported');
    assert.equal(derived.confidence, 'low');
    assert.equal(derived.diagnostic.invalid_deliver_to, true);
  });

  it('attaches emptiness metadata only to empty buildSearchResponse envelopes', () => {
    const derived = deriveEmptiness({ ...baseSignals });
    const empty = buildSearchResponse([], 0, 20, 0, 5, false, undefined, false, 'SG', derived);

    assert.equal(empty.meta.emptiness_reason, 'no_match');
    assert.equal(empty.meta.diagnostic.deliver_to_present, true);
    assert.equal(empty.meta.deliver_to, 'SG');

    const sampleProduct = {
      id: 'p1', title: 'P1', price: { amount: 10, currency: 'SGD' },
      merchant: 'm1', url: 'https://x.com/p1', image_url: null,
      region: null, country_code: null, updated_at: null,
    };
    const nonEmpty = buildSearchResponse([sampleProduct], 1, 20, 0, 5, false, undefined, false, 'SG', derived);

    assert.equal(nonEmpty.meta.emptiness_reason, undefined);
    assert.equal(nonEmpty.meta.diagnostic, undefined);
  });

  it('includes full degraded metadata for timeout envelopes', () => {
    const derived = deriveEmptiness({
      ...baseSignals,
      degradedKind: 'timeout',
      timedOutStage: 'catalog_search',
    });
    const degraded = buildSearchResponse([], 0, 20, 0, 5, false, true, false, 'US', derived);

    assert.equal(degraded.meta.degraded, true);
    assert.equal(degraded.meta.status, 'degraded');
    assert.equal(degraded.meta.emptiness_reason, 'timeout');
    assert.equal(degraded.meta.degraded_kind, 'timeout');
    assert.equal(degraded.meta.degraded_reason, 'catalog_search');
    assert.equal(degraded.meta.confidence, 'low');
    assert.equal(degraded.meta.diagnostic.engine_status, 'degraded');
    assert.equal(degraded.meta.diagnostic.timed_out_stage, 'catalog_search');
    assert.equal(degraded.meta.diagnostic.deliver_to_present, true);
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
    assert.equal(COUNTRY_CURRENCY.PH, 'PHP');
    assert.equal(COUNTRY_CURRENCY.ID, 'IDR');
    assert.equal(COUNTRY_CURRENCY.JP, 'JPY');
    assert.equal(COUNTRY_CURRENCY.DE, 'EUR');
    assert.equal(COUNTRY_CURRENCY.AU, 'AUD');
  });
});
