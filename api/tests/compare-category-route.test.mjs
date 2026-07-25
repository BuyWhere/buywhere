import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const queryMock = mock.fn();
const redisGetMock = mock.fn(() => Promise.resolve(null));
const redisSetexMock = mock.fn(() => Promise.resolve('OK'));

const config = require('../dist/config');
config.db.query = queryMock;
config.redis.get = redisGetMock;
config.redis.setex = redisSetexMock;

function categoryRow(category, id) {
  return {
    id: String(id),
    title: `${category} Product ${id}`,
    brand: 'BuyWhere',
    image_url: null,
    price: '99.99',
    currency: 'SGD',
    url: `https://example.com/${id}`,
    source: 'shopee_sg',
    is_active: true,
    updated_at: '2026-07-25T00:00:00Z',
    sku: `sku-${id}`,
    mpn: null,
  };
}

function setupMocks() {
  queryMock.mock.resetCalls();
  redisGetMock.mock.resetCalls();
  redisSetexMock.mock.resetCalls();
  redisGetMock.mock.mockImplementation(() => Promise.resolve(null));
  redisSetexMock.mock.mockImplementation(() => Promise.resolve('OK'));
  queryMock.mock.mockImplementation((sql, params) => {
    if (typeof sql === 'string' && sql.includes('FROM comparison_pages')) {
      return Promise.resolve({ rows: [] });
    }
    if (typeof sql === 'string' && sql.includes('CROSS JOIN LATERAL unnest')) {
      return Promise.resolve({ rows: [{ name: params[3][1] || params[2] }] });
    }
    if (typeof sql === 'string' && sql.includes('category_path &&')) {
      return Promise.resolve({ rows: [categoryRow(params[2][0], 1), categoryRow(params[2][0], 2)] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('/v1/compare/:category fallback route', () => {
  let server;
  let port;

  before(async () => {
    const express = require('express');
    const compareSlugRouter = require('../dist/routes/compareSlug').default;

    const app = express();
    app.use(express.json());
    app.use('/v1/compare', compareSlugRouter);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server?.close());
  beforeEach(() => setupMocks());

  for (const category of ['electronics', 'fashion', 'home-living']) {
    it(`returns non-empty category comparison payload for ${category}`, async () => {
      const res = await fetch(`http://localhost:${port}/v1/compare/${category}?region=sea&country=SG`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.slug, category);
      assert.equal(body.country_code, 'SG');
      assert.equal(body.currency, 'SGD');
      assert.ok(Array.isArray(body.products));
      assert.ok(body.products.length > 0);
      assert.ok(Array.isArray(body.products[0].prices));
      assert.ok(body.products[0].prices.length > 0);
      assert.equal(res.headers.get('x-cache'), 'CATEGORY-FALLBACK');
    });
  }

  it('looks up category matches at any category_path depth and filters by country', async () => {
    const res = await fetch(`http://localhost:${port}/v1/compare/electronics?region=sea&country=SG`);
    assert.equal(res.status, 200);

    const slugLookup = queryMock.mock.calls.find(
      (call) => typeof call.arguments[0] === 'string' && call.arguments[0].includes('CROSS JOIN LATERAL unnest')
    );
    assert.ok(slugLookup, 'expected category_path unnest lookup');
    assert.deepEqual(slugLookup.arguments[1].slice(0, 3), ['SGD', 'SG', 'electronics']);

    const productsQuery = queryMock.mock.calls.find(
      (call) => typeof call.arguments[0] === 'string' && call.arguments[0].includes('category_path &&')
    );
    assert.ok(productsQuery, 'expected product query to use category_path overlap');
    assert.deepEqual(productsQuery.arguments[1].slice(0, 2), ['SGD', 'SG']);
  });
});
