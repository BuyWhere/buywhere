/**
 * Unit tests for affiliate link wrapping — BUY-18436
 * Tests pure logic: platform detection, URL building, precomputed URL resolution.
 * DB-dependent functions (wrapAffiliateUrl, loadAffiliateConfigs) are not tested here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  detectPlatform,
  buildAffiliateUrl,
  resolvePrecomputedAffiliateUrl,
} = require('../dist/lib/affiliateWrapper');

describe('detectPlatform', () => {
  it('detects shopee_sg from shopee.sg URLs', () => {
    assert.equal(detectPlatform('https://shopee.sg/product/123'), 'shopee_sg');
    assert.equal(detectPlatform('https://www.shopee.sg/product/123'), 'shopee_sg');
  });

  it('detects lazada_sg from lazada.sg URLs', () => {
    assert.equal(detectPlatform('https://www.lazada.sg/products/x.html'), 'lazada_sg');
    assert.equal(detectPlatform('https://lazada.sg/products/x.html'), 'lazada_sg');
  });

  it('returns null for unsupported platforms', () => {
    assert.equal(detectPlatform('https://amazon.sg/dp/B123'), null);
    assert.equal(detectPlatform('https://qoo10.sg/item/123'), null);
    assert.equal(detectPlatform('https://courts.com.sg/product'), null);
  });

  it('returns null for invalid URLs', () => {
    assert.equal(detectPlatform('not-a-url'), null);
    assert.equal(detectPlatform(''), null);
  });
});

describe('buildAffiliateUrl', () => {
  const CLICK_ID = 'test-click-id-001';

  it('wraps Shopee SG URLs with pid and click_id', () => {
    const raw = 'https://shopee.sg/product/123';
    const config = { platform: 'shopee_sg', networkId: 'involve_asia', trackingId: 'PUB123', isActive: true };
    const result = buildAffiliateUrl(raw, config, CLICK_ID);

    assert.ok(result.startsWith('https://s.shopee.sg/affiliate-redirect'), `got: ${result}`);
    assert.ok(result.includes(`pid=${encodeURIComponent('PUB123')}`), `missing pid in: ${result}`);
    assert.ok(result.includes(`click_id=${CLICK_ID}`), `missing click_id in: ${result}`);
    assert.ok(result.includes(encodeURIComponent(raw)), `missing encoded raw URL in: ${result}`);
  });

  it('wraps Lazada SG URLs with trackingId path and sub_aff_id', () => {
    const raw = 'https://lazada.sg/products/x.html';
    const config = { platform: 'lazada_sg', networkId: 'involve_asia', trackingId: 'LZD456', isActive: true };
    const result = buildAffiliateUrl(raw, config, CLICK_ID);

    assert.ok(result.startsWith('https://c.lazada.sg/t/'), `got: ${result}`);
    assert.ok(result.includes('LZD456'), `missing trackingId in: ${result}`);
    assert.ok(result.includes(`sub_aff_id=${CLICK_ID}`), `missing sub_aff_id in: ${result}`);
    assert.ok(result.includes(encodeURIComponent(raw)), `missing encoded raw URL in: ${result}`);
  });

  it('falls back to appending params for unknown platform', () => {
    const raw = 'https://some-platform.com/item?id=99';
    const config = { platform: 'unknown_platform', networkId: 'generic', trackingId: 'GEN789', isActive: true };
    const result = buildAffiliateUrl(raw, config, CLICK_ID);

    const parsed = new URL(result);
    assert.equal(parsed.searchParams.get('aff_id'), 'GEN789');
    assert.equal(parsed.searchParams.get('click_id'), CLICK_ID);
  });

  it('produces different wrapped URLs for different clickIds', () => {
    const raw = 'https://shopee.sg/product/999';
    const config = { platform: 'shopee_sg', networkId: 'involve_asia', trackingId: 'PUB123', isActive: true };
    const r1 = buildAffiliateUrl(raw, config, 'click-aaa');
    const r2 = buildAffiliateUrl(raw, config, 'click-bbb');
    assert.notEqual(r1, r2);
  });
});

describe('resolvePrecomputedAffiliateUrl', () => {
  it('returns non-empty string as-is', () => {
    const url = 'https://c.lazada.sg/t/XYZ?url=encoded';
    assert.equal(resolvePrecomputedAffiliateUrl(url), url);
  });

  it('returns null for null input', () => {
    assert.equal(resolvePrecomputedAffiliateUrl(null), null);
  });

  it('returns null for empty string', () => {
    assert.equal(resolvePrecomputedAffiliateUrl(''), null);
  });

  it('returns null for undefined', () => {
    assert.equal(resolvePrecomputedAffiliateUrl(undefined), null);
  });

  it('returns null for non-string types', () => {
    assert.equal(resolvePrecomputedAffiliateUrl(123), null);
    assert.equal(resolvePrecomputedAffiliateUrl({}), null);
  });
});

describe('buildProduct with affiliate_url (via response module)', () => {
  const { buildProduct } = require('../dist/lib/response');

  const baseRow = {
    id: 'prod-1',
    title: 'Shopee Product',
    price: 29.99,
    currency: 'SGD',
    domain: 'shopee_sg',
    url: 'https://shopee.sg/product/1',
    image_url: null,
    region: 'SEA',
    country_code: 'SG',
    updated_at: '2026-05-16T00:00:00Z',
    metadata: null,
  };

  it('uses raw url when affiliate_url is absent', () => {
    const product = buildProduct(baseRow, 'SGD', false);
    assert.equal(product.url, 'https://shopee.sg/product/1');
    assert.equal(product.affiliate_url, undefined);
  });

  it('uses affiliate_url as url when present in row', () => {
    const row = { ...baseRow, affiliate_url: 'https://s.shopee.sg/affiliate-redirect?pid=PUB&click_id=abc&url=...' };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.url, row.affiliate_url);
    assert.equal(product.affiliate_url, row.affiliate_url);
  });

  it('ignores empty string affiliate_url and falls back to raw url', () => {
    const row = { ...baseRow, affiliate_url: '' };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.url, 'https://shopee.sg/product/1');
    assert.equal(product.affiliate_url, undefined);
  });

  it('returns raw url unchanged for platforms with no affiliate config', () => {
    const row = { ...baseRow, domain: 'amazon_sg', url: 'https://amazon.sg/dp/B123', affiliate_url: null };
    const product = buildProduct(row, 'SGD', false);
    assert.equal(product.url, 'https://amazon.sg/dp/B123');
    assert.equal(product.affiliate_url, undefined);
  });
});
