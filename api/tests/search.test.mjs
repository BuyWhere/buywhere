import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const queryMock = mock.fn();
const redisGetMock = mock.fn(() => Promise.resolve(null));
const redisSetMock = mock.fn(() => Promise.resolve('OK'));
const redisIncrMock = mock.fn(() => Promise.resolve(1));
const redisExpireMock = mock.fn(() => Promise.resolve(1));
const redisOnMock = mock.fn();

// Direct config mocking — mock.module() unavailable in CI's Node version
const config = require('../dist/config');
const mockClient = { query: queryMock, release: () => {} };
config.db.query = queryMock;
config.db.connect = () => Promise.resolve(mockClient);
config.db.end = () => {};
config.redis.get = redisGetMock;
config.redis.set = redisSetMock;
config.redis.incr = redisIncrMock;
config.redis.expire = redisExpireMock;
config.redis.on = redisOnMock;
config.redis.disconnect = () => {};

function makeProduct(id, overrides = {}) {
  return {
    id, sku: `src_${id}`, source: overrides.source || 'shopee_sg',
    title: overrides.title || `Product ${id}`,
    price: overrides.price ?? 99.99, currency: overrides.currency || 'SGD',
    url: `https://x.com/p${id}`, image_url: null,
    metadata: overrides.metadata || null,
    updated_at: '2026-05-03T00:00:00Z',
    region: overrides.region || 'SEA', country_code: overrides.country_code || 'SG',
  };
}

function defaultQueryHandler(sql, params) {
  if (typeof sql === 'string' && sql.includes('api_keys')) {
    return Promise.resolve({
      rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }],
    });
  }
  if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
    return Promise.resolve({ rows: [] });
  }
  if (typeof sql === 'string' && sql.includes('COUNT')) {
    return Promise.resolve({ rows: [{ count: '2' }] });
  }
  return Promise.resolve({
    rows: [makeProduct('1', { title: 'Gaming Laptop', price: 1299 }), makeProduct('2', { title: 'Office Laptop', price: 899 })],
  });
}

function setupDefaultMocks() {
  queryMock.mock.resetCalls();
  redisGetMock.mock.resetCalls();
  redisSetMock.mock.resetCalls();
  queryMock.mock.mockImplementation(defaultQueryHandler);
}

describe('NL search queries — response correctness', () => {
  let server;
  let port;

  before(async () => {
    const express = require('express');
    const productsRouter = require('../dist/routes/products').default;

    const app = express();
    app.use(express.json());
    app.use('/v1/products', productsRouter);
    server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    port = server.address().port;
  });

  after(() => { server?.close(); });
  beforeEach(() => { setupDefaultMocks(); });

  it('returns SearchResponse shape for simple NL query "laptop"', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.total, 2);
    assert.equal(body.results.length, 2);
    assert.equal(body.results[0].title, 'Gaming Laptop');
    assert.equal(body.results[0].price.amount, 1299);
    assert.equal(body.results[0].price.currency, 'SGD');
    assert.equal(body.results[1].title, 'Office Laptop');
    assert.ok(typeof body.response_time_ms === 'number');
    assert.equal(body.cached, false);
    assert.equal(body.page.limit, 20);
    assert.equal(body.page.offset, 0);
  });

  it('constructs FTS query with plainto_tsquery for NL query', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=gaming+laptop+2026`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const ftsCalls = queryMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('plainto_tsquery')
    );
    assert.ok(ftsCalls.length >= 1, 'Expected at least one FTS query');
    const ftsQuery = ftsCalls[0].arguments[0];
    assert.ok(ftsQuery.includes(`plainto_tsquery('english'`));
  });

  it('passes query text as parameter to plainto_tsquery', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=gaming+laptop+2026`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const ftsCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('ts_rank')
    );
    assert.ok(ftsCall, 'Expected ts_rank query');
    const params = ftsCall.arguments[1];
    assert.ok(Array.isArray(params));
    const qParam = params.find(p => typeof p === 'string' && p.includes('gaming'));
    assert.ok(qParam, 'Expected query text in params');
    assert.ok(qParam.includes('gaming laptop 2026'));
  });

  it('enforces country_code=SG when no country or region is provided', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    // Implementation uses CTE over-fetch (no separate COUNT); check filter is in data query
    const queryCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('country_code') && c.arguments[0].includes('FROM products')
    );
    assert.ok(queryCall, 'Expected country_code filter in query');
    assert.ok(queryCall.arguments[0].includes(`country_code = $`));
  });

  it('accepts country_code=US to override default SG', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('COUNT')) {
        const hasUS = sql.includes("'US'") || (Array.isArray(arguments[1]) && arguments[1].includes('US'));
        return Promise.resolve({ rows: [{ count: hasUS ? '3' : '0' }] });
      }
      return Promise.resolve({ rows: [makeProduct('1', { country_code: 'US' }), makeProduct('2', { country_code: 'US' }), makeProduct('3', { country_code: 'US' })] });
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=shoe&country_code=US`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.total, 3);
  });

  it('applies price range filters with NL query', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=headphones&min_price=50&max_price=200`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    // Implementation uses CTE over-fetch (no separate COUNT); check filters are in data query
    const dataCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('price >=')
    );
    assert.ok(dataCall, 'Expected price range filter in query');
    assert.ok(dataCall.arguments[0].includes('price >='));
    assert.ok(dataCall.arguments[0].includes('price <='));
  });

  it('handles empty query (filter-only search)', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?category=Electronics`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    // Should NOT have plainto_tsquery
    const ftsCalls = queryMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('plainto_tsquery')
    );
    assert.equal(ftsCalls.length, 0, 'No FTS query for empty q');
  });

  it('supports pagination via limit and offset', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('COUNT')) {
        return Promise.resolve({ rows: [{ count: '50' }] });
      }
      return Promise.resolve({ rows: [makeProduct('1'), makeProduct('2')] });
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop&limit=5&offset=10`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.page.limit, 5);
    assert.equal(body.page.offset, 10);

    const dataCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('LIMIT')
    );
    assert.ok(dataCall);
  });

  it('caps limit at 100', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop&limit=999`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();
    assert.equal(body.page.limit, 100);
  });

  it('handles special characters in query', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=iPhone+15+Pro+Max+%26+Mini`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const ftsCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('ts_rank')
    );
    assert.ok(ftsCall);
  });

  it('returns compact mode when compact=true', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('COUNT')) {
        return Promise.resolve({ rows: [{ count: '1' }] });
      }
      return Promise.resolve({
        rows: [makeProduct('1', { title: 'Test', price: 100, metadata: { brand: 'TestBrand', category: 'Electronics' } })],
      });
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=test&compact=true`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.results[0].canonical_id != null);
    assert.ok(body.results[0].normalized_price_usd != null);
    assert.ok(Array.isArray(body.results[0].comparison_attributes));
    assert.equal(body.results[0].comparison_attributes[0].key, 'brand');
    assert.equal(body.results[0].comparison_attributes[0].value, 'TestBrand');
  });

  it('returns cached response with cached=true flag', async () => {
    const cachedResponse = {
      results: [], total: 0, page: { limit: 20, offset: 0 },
      response_time_ms: 5, cached: true,
    };
    redisGetMock.mock.mockImplementation(() => Promise.resolve(JSON.stringify(cachedResponse)));

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.cached, true);
    assert.equal(body.total, 0);

    redisGetMock.mock.mockImplementation(() => Promise.resolve(null));
  });

  it('handles non-ASCII characters in NL query', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=caf%C3%A9+machine`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const ftsCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('plainto_tsquery')
    );
    assert.ok(ftsCall);
    const params = ftsCall.arguments[1];
    assert.ok(Array.isArray(params));
    const hasCafe = params.some(p => typeof p === 'string' && p.includes('caf'));
    assert.ok(hasCafe);
  });

  it('supports domain/platform filter with NL query', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=monitor&domain=amazon_us`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    // Implementation uses CTE over-fetch (no separate COUNT); check filter is in data query
    const dataCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('source =')
    );
    assert.ok(dataCall, 'Expected source= filter in query');
    assert.ok(dataCall.arguments[0].includes('source ='));
  });

  it('preserves backward-compat `country` param alias', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      // total is derived from row count (CTE over-fetch), not a COUNT query — return 2 rows
      return Promise.resolve({ rows: [makeProduct('1', { country_code: 'MY' }), makeProduct('2', { country_code: 'MY' })] });
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=shoe&country=MY`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.total, 2);
  });

  it('region filter overrides default SG country', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=watch&region=US`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    // Implementation uses CTE over-fetch (no separate COUNT); check filter is in data query
    const dataCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('region =')
    );
    assert.ok(dataCall, 'Expected region= filter in query');
    assert.ok(dataCall.arguments[0].includes('region ='));
  });

  it('uses small-result-set ordering (ts_rank) when approxCount <= 1000', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('COUNT')) {
        return Promise.resolve({ rows: [{ count: '50' }] });
      }
      return Promise.resolve({
        rows: [makeProduct('1', { title: 'Gaming Laptop', price: 1299, metadata: { brand: 'ASUS' } })],
      });
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const dataCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('ts_rank') && !c.arguments[0].includes('_candidates')
    );
    assert.ok(dataCall, 'Expected direct ts_rank ORDER BY (small result set path)');
    assert.ok(!dataCall.arguments[0].includes('_candidates'));
  });

  it('always uses top_ids CTE candidate-limit path for FTS queries', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({
        rows: [makeProduct('1', { title: 'Gaming Laptop', price: 1299, metadata: { brand: 'ASUS' } })],
      });
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    // FTS always uses WITH top_ids AS (...) CTE to cap candidates before ranking
    const dataCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('top_ids')
    );
    assert.ok(dataCall, 'Expected CTE with top_ids subquery for FTS queries');
  });
});

describe('NL search queries — error handling', () => {
  let server;
  let port;

  before(async () => {
    const express = require('express');
    const productsRouter = require('../dist/routes/products').default;

    const app = express();
    app.use(express.json());
    app.use('/v1/products', productsRouter);
    server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    port = server.address().port;
  });

  after(() => { server?.close(); });
  beforeEach(() => { setupDefaultMocks(); });

  it('returns 401 when no API key is provided', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`);
    assert.equal(res.status, 401);
  });

  it('returns 401 for invalid API key', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [] });
      }
      return defaultQueryHandler(sql);
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`, {
      headers: { Authorization: 'Bearer invalid-key' },
    });
    assert.equal(res.status, 401);
  });

  it('handles DB query failure gracefully with 500', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.reject(new Error('DB connection failed'));
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 500);
  });

  it('handles empty string query the same as missing q param', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const ftsCalls = queryMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('plainto_tsquery')
    );
    assert.equal(ftsCalls.length, 0);
  });

  it('handles missing q param entirely', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);
  });
});

describe('NL search — Redis caching behavior', () => {
  let server;
  let port;

  before(async () => {
    const express = require('express');
    const productsRouter = require('../dist/routes/products').default;

    const app = express();
    app.use(express.json());
    app.use('/v1/products', productsRouter);
    server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    port = server.address().port;
  });

  after(() => { server?.close(); });
  beforeEach(() => { setupDefaultMocks(); });

  it('checks Redis cache before querying DB', async () => {
    await fetch(`http://localhost:${port}/v1/products/search?q=cachetest`, {
      headers: { Authorization: 'Bearer test-key' },
    });

    const cacheCalls = redisGetMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('cachetest')
    );
    assert.ok(cacheCalls.length >= 1, 'Expected Redis cache check for query');
  });

  it('stores result in Redis after DB query', async () => {
    await fetch(`http://localhost:${port}/v1/products/search?q=storetest`, {
      headers: { Authorization: 'Bearer test-key' },
    });

    const cacheSetCalls = redisSetMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('storetest')
    );
    assert.ok(cacheSetCalls.length >= 1, 'Expected Redis cache set for query');
    assert.equal(cacheSetCalls[0].arguments[2], 'EX');
    assert.equal(cacheSetCalls[0].arguments[3], 3600); // BUY-31302: raised from 60s to 3600s
  });

  it('uses correct cache key format', async () => {
    await fetch(`http://localhost:${port}/v1/products/search?q=keyfmt`, {
      headers: { Authorization: 'Bearer test-key' },
    });

    const cacheGetCalls = redisGetMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].startsWith('fts:')
    );
    assert.ok(cacheGetCalls.length >= 1);
    assert.ok(cacheGetCalls[0].arguments[0].startsWith('fts:keyfmt:'));
  });
});
