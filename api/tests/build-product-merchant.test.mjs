// BUY-74689 — verify buildProduct emits merchant_name / merchant_slug from the
// batched merchants map, preserves the platform slug, and degrades gracefully
// when the merchant row is missing (orphaned merchant_id).
// BUY-74732 — also covers merchant-level slug persistence + scraped_via emission
// (per-row column takes precedence; merchant-level fallback when row value is null).
//
// These tests run against the compiled `dist/` so they don't require a live DB.
// The lookupMerchantMap helper is mocked by passing the map directly into
// buildProduct (which is what the production handlers do post-lookup).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildProduct } = require('../dist/lib/response');
const { slugifyMerchantName } = require('../dist/lib/merchantLookup');

const baseRow = {
  id: 'prod-1',
  title: 'Test Product',
  price: 99.99,
  currency: 'SGD',
  domain: 'bestdenki',
  merchant_id: 'bestdenki',
  url: 'https://bestdenki.com.sg/test',
  image_url: 'https://bestdenki.com.sg/img.jpg',
  region: 'SG',
  country_code: 'SG',
  updated_at: '2026-05-03T00:00:00Z',
  metadata: { brand: 'Test', category: 'Electronics' },
  category_path: ['Electronics', 'Laptops'],
};

describe('BUY-74689 — merchant name emission', () => {
  it('slugifies a simple Latin storefront name', () => {
    assert.equal(slugifyMerchantName('BestDenki'), 'bestdenki');
    assert.equal(slugifyMerchantName('Amazon Sg'), 'amazon-sg');
    assert.equal(slugifyMerchantName('  Shopee  '), 'shopee');
  });

  it('slugifies punctuation and runs of non-alphanumerics into a single dash', () => {
    assert.equal(slugifyMerchantName('Mr. DIY — Home Improvement!'), 'mr-diy-home-improvement');
    assert.equal(slugifyMerchantName('Foo & Bar / Baz'), 'foo-bar-baz');
  });

  it('collapses accented and CJK characters into a URL-safe kebab', () => {
    assert.equal(slugifyMerchantName('日本家電 電器'), '日本家電-電器');
  });

  it('returns empty string for purely-punctuation or empty input', () => {
    assert.equal(slugifyMerchantName(''), '');
    assert.equal(slugifyMerchantName('!!!'), '');
    assert.equal(slugifyMerchantName('   '), '');
  });

  it('emits merchant_name and merchant_slug from a batched map', () => {
    const merchantMap = {
      bestdenki: { name: 'BestDenki', slug: 'bestdenki', scraped_via: null },
    };
    const product = buildProduct(baseRow, 'SGD', false, merchantMap);

    assert.equal(product.merchant, 'bestdenki', 'platform slug preserved');
    assert.equal(product.merchant_id, 'bestdenki', 'opaque id preserved');
    assert.equal(product.merchant_name, 'BestDenki', 'real storefront name surfaced');
    assert.equal(product.merchant_slug, 'bestdenki', 'URL-safe slug surfaced');
  });

  it('emits merchant_slug derived from a multi-word or CJK name', () => {
    const merchantMap = {
      'mr.diy': { name: 'Mr. DIY', slug: slugifyMerchantName('Mr. DIY'), scraped_via: null },
      'apple-jp': { name: '日本家電', slug: slugifyMerchantName('日本家電'), scraped_via: null },
    };
    const withMr = buildProduct({ ...baseRow, merchant_id: 'mr.diy', domain: 'mr.diy' }, 'SGD', false, merchantMap);
    assert.equal(withMr.merchant_name, 'Mr. DIY');
    assert.equal(withMr.merchant_slug, 'mr-diy');

    const withJp = buildProduct({ ...baseRow, merchant_id: 'apple-jp', domain: 'apple-jp' }, 'SGD', false, merchantMap);
    assert.equal(withJp.merchant_name, '日本家電');
    assert.equal(withJp.merchant_slug, '日本家電');
  });

  it('emits null merchant_name when no map is supplied (legacy callers)', () => {
    const product = buildProduct(baseRow, 'SGD', false);
    assert.equal(product.merchant, 'bestdenki', 'platform slug still set');
    assert.equal(product.merchant_name, null, 'no map → null label');
    assert.equal(product.merchant_slug, null);
  });

  it('emits null merchant_name when merchant_id is missing in the map (orphaned)', () => {
    const merchantMap = {
      // bestdenki intentionally absent
      challenger: { name: 'Challenger', slug: 'challenger', scraped_via: null },
    };
    const product = buildProduct(baseRow, 'SGD', false, merchantMap);
    assert.equal(product.merchant, 'bestdenki');
    assert.equal(product.merchant_name, null);
    assert.equal(product.merchant_slug, null);
  });

  it('emits null merchant_name when merchant_id is null/empty on the row', () => {
    const product = buildProduct({ ...baseRow, merchant_id: null }, 'SGD', false, {});
    assert.equal(product.merchant_name, null);
    assert.equal(product.merchant_slug, null);
    assert.equal(product.merchant_id, null);
  });

  it('preserves the merchants slug when provided (no re-slugify)', () => {
    const merchantMap = {
      'bestdenki': { name: 'BestDenki', slug: 'bestdenki-sg', scraped_via: null },
    };
    const product = buildProduct(baseRow, 'SGD', false, merchantMap);
    assert.equal(product.merchant_slug, 'bestdenki-sg');
  });

  it('compact mode also carries merchant_name / merchant_slug', () => {
    const merchantMap = {
      bestdenki: { name: 'BestDenki', slug: 'bestdenki', scraped_via: null },
    };
    const product = buildProduct(baseRow, 'SGD', true, merchantMap);
    assert.equal(product.merchant_name, 'BestDenki');
    assert.equal(product.merchant_slug, 'bestdenki');
    assert.ok(Array.isArray(product.comparison_attributes));
  });
});

describe('BUY-74732 — merchant_slug column + scraped_via resolution', () => {
  it('emits scraped_via from the row when present (per-row precedence)', () => {
    const merchantMap = {
      tangs: { name: 'Tangs', slug: 'tangs-sg', scraped_via: 'affiliate' },
    };
    const product = buildProduct(
      { ...baseRow, merchant_id: 'tangs', scraped_via: 'first_party' },
      'SGD', false, merchantMap,
    );
    assert.equal(product.merchant_name, 'Tangs');
    assert.equal(product.merchant_slug, 'tangs-sg', 'persisted merchants.slug wins over JS slugify');
    assert.equal(product.scraped_via, 'first_party', 'row-level scraped_via wins over merchant-level');
  });

  it('falls back to merchant-level scraped_via when the row has none', () => {
    const merchantMap = {
      tangs: { name: 'Tangs', slug: 'tangs-sg', scraped_via: 'first_party' },
    };
    const product = buildProduct(
      { ...baseRow, merchant_id: 'tangs' },
      'SGD', false, merchantMap,
    );
    assert.equal(product.scraped_via, 'first_party', 'merchant-level first_party surfaces');
  });

  it('emits scraped_via=null when neither row nor merchant has the flag', () => {
    const merchantMap = {
      tangs: { name: 'Tangs', slug: 'tangs-sg', scraped_via: null },
    };
    const product = buildProduct(baseRow, 'SGD', false, merchantMap);
    assert.equal(product.scraped_via, null, 'no flag → null (FE falls back to config.verified)');
  });

  it('emits scraped_via=null when merchant_id is orphaned (no map entry)', () => {
    const product = buildProduct(baseRow, 'SGD', false, {});
    assert.equal(product.scraped_via, null);
  });

  it('trims whitespace on scraped_via', () => {
    const merchantMap = {
      tangs: { name: 'Tangs', slug: 'tangs-sg', scraped_via: '  first_party  ' },
    };
    const product = buildProduct(
      { ...baseRow, merchant_id: 'tangs', scraped_via: '  first_party  ' },
      'SGD', false, merchantMap,
    );
    assert.equal(product.scraped_via, 'first_party');
  });
});