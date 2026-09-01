// BUY-67318: hide buy-side fields when probe worker confirms the product URL is dead.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildProduct } = require('../dist/lib/response');

describe('BUY-67318: hide buy-side fields for dead product URLs', () => {
  const baseRow = {
    id: 'prod-dead-1',
    title: 'Dead Product',
    price: 99.99,
    currency: 'SGD',
    domain: 'harvey_norman_sg',
    url: 'https://www.harveynorman.com.sg/some-delisted-product',
    image_url: 'https://harveynorman.com.sg/img/1.jpg',
    region: 'SEA',
    country_code: 'SG',
    updated_at: '2026-08-01T00:00:00Z',
    metadata: { brand: 'Test', category: 'Electronics' },
    category_path: ['Electronics', 'Laptops'],
    url_last_checked_at: '2026-08-15T12:00:00Z',
  };

  it('nulls url and omits click_url / affiliate_redirect_url / affiliate_url when url_status=dead', () => {
    const product = buildProduct({ ...baseRow, url_status: 'dead' }, 'SGD', false);
    assert.equal(product.url, null, 'url must be null');
    assert.equal(product.url_status, 'dead', 'url_status must remain dead so consumers can render a tombstone');
    assert.equal(product.click_url, undefined, 'click_url must not be present');
    assert.equal(product.affiliate_redirect_url, undefined, 'affiliate_redirect_url must not be present');
    assert.equal(product.affiliate_url, undefined, 'affiliate_url must not be present');
    assert.equal(product.has_affiliate_tracking, false);
    assert.equal(product.is_affiliate, false);
    assert.equal(product.affiliate_disclosure, undefined, 'disclosure must be omitted when no buy surface');
  });

  it('leads URL through when url_status is null (never checked)', () => {
    const product = buildProduct({ ...baseRow, url_status: null }, 'SGD', false);
    assert.equal(product.url, baseRow.url);
    assert.equal(product.url_status, null);
    assert.ok(product.click_url, 'click_url must be generated when URL is alive');
  });

  it('leads URL through when url_status is "ok"', () => {
    const product = buildProduct({ ...baseRow, url_status: 'ok' }, 'SGD', false);
    assert.equal(product.url, baseRow.url);
    assert.ok(product.click_url);
    assert.ok(product.affiliate_redirect_url);
  });

  it('leads URL through when url_status is "transient" (HTTP 5xx/timeout, retrying)', () => {
    const product = buildProduct({ ...baseRow, url_status: 'transient' }, 'SGD', false);
    assert.equal(product.url, baseRow.url);
    assert.equal(product.url_status, 'transient');
    assert.ok(product.click_url);
  });
});