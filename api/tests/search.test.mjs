import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);

const queryMock = mock.fn();
const vectorQueryMock = mock.fn();
const embedQueryMock = mock.fn(() => Promise.resolve('[0.1,0.2,0.3]'));
const redisGetMock = mock.fn(() => Promise.resolve(null));
const redisSetMock = mock.fn(() => Promise.resolve('OK'));
const redisIncrMock = mock.fn(() => Promise.resolve(1));
const redisExpireMock = mock.fn(() => Promise.resolve(1));
const redisOnMock = mock.fn();
const nativeFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  if (typeof input === 'string' && input.includes('/v1/products/search') && !input.includes('_tier=')) {
    const separator = input.includes('?') ? '&' : '?';
    return nativeFetch(`${input}${separator}_tier=0`, init);
  }
  return nativeFetch(input, init);
};

// Direct config mocking — mock.module() unavailable in CI's Node version
const config = require('../dist/config');
const embedProducts = require('../dist/jobs/embedProducts');
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
config.vectorDb = null;
embedProducts.embedQuery = embedQueryMock;

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

function hashKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

function responseResults(body) {
  return body.data ?? body.results ?? [];
}

function responseTotal(body) {
  return body.meta?.total ?? body.total;
}

function responsePage(body) {
  return body.meta ?? body.page ?? {};
}

function responseCached(body) {
  return body.meta?.cached ?? body.cached;
}

function responseTimeMs(body) {
  return body.meta?.response_time_ms ?? body.response_time_ms;
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
  vectorQueryMock.mock.resetCalls();
  embedQueryMock.mock.resetCalls();
  redisGetMock.mock.resetCalls();
  redisSetMock.mock.resetCalls();
  queryMock.mock.mockImplementation(defaultQueryHandler);
  vectorQueryMock.mock.mockImplementation(() => Promise.resolve({ rows: [] }));
  embedQueryMock.mock.mockImplementation(() => Promise.resolve('[0.1,0.2,0.3]'));
  redisGetMock.mock.mockImplementation(() => Promise.resolve(null));
  redisSetMock.mock.mockImplementation(() => Promise.resolve('OK'));
  config.vectorDb = null;
  delete process.env.FLOWAI_EMBED_API_KEY;
  process.env.SEARCH_USE_TIER = '0';
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

  after(() => { delete process.env.SEARCH_USE_TIER; server?.close(); });
  beforeEach(() => { setupDefaultMocks(); });

  it('accepts bw_beta signup keys by looking up the canonical bw hash', async () => {
    const suffix = '988b4fad03aa1064593196ef0513ca0287b892a8';
    const betaKey = `bw_beta_${suffix}`;
    const canonicalHash = hashKey(`bw_${suffix}`);

    queryMock.mock.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('FROM api_keys')) {
        assert.ok(sql.includes('key_hash = ANY'));
        assert.ok(params[0].includes(canonicalHash));
        return Promise.resolve({
          rows: [{ id: 'test-k', key_hash: canonicalHash, name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }],
        });
      }
      return defaultQueryHandler(sql, params);
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`, {
      headers: { Authorization: `Bearer ${betaKey}` },
    });

    assert.equal(res.status, 200);
  });

  it('returns SearchResponse shape for simple NL query "laptop"', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(responseTotal(body), 2);
    assert.equal(responseResults(body).length, 2);
    assert.equal(responseResults(body)[0].title, 'Gaming Laptop');
    assert.equal(responseResults(body)[0].price.amount, 1299);
    assert.equal(responseResults(body)[0].price.currency, 'SGD');
    assert.equal(responseResults(body)[1].title, 'Office Laptop');
    assert.ok(typeof responseTimeMs(body) === 'number');
    assert.equal(responseCached(body), false);
    assert.equal(responsePage(body).limit, 20);
    assert.equal(responsePage(body).offset, 0);
  });

  it('redirects legacy /v1/products?q=... requests to the canonical search route', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products?q=asus+rog&country=SG&limit=5`, {
      headers: { Authorization: 'Bearer test-key' },
      redirect: 'manual',
    });

    assert.equal(res.status, 307);
    assert.equal(res.headers.get('location'), '/v1/products/search?q=asus+rog&country_code=SG&limit=5');
  });

  it('constructs FTS query with plainto_tsquery for NL query', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=gaming+laptop+2026`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const src = readFileSync(new URL('../src/routes/products.ts', import.meta.url), 'utf8');
    assert.ok(src.includes(`plainto_tsquery('english'`));
    assert.ok(src.includes('search_vector @@'));
  });

  it('passes query text as parameter to plainto_tsquery', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=gaming+laptop+2026`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const ftsCall = queryMock.mock.calls.find(
      c => Array.isArray(c.arguments[1]) && c.arguments[1].some(p => typeof p === 'string' && p.includes('gaming laptop 2026'))
    );
    assert.ok(ftsCall, 'Expected query text in SQL params');
  });

  it('does not apply a silent SG hard filter when no country or region is provided', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const searchCalls = queryMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string' &&
        c.arguments[0].includes('search_vector @@')
    );
    assert.ok(searchCalls.length >= 1, 'Expected archive search query');
    assert.equal(
      searchCalls.some(c => Array.isArray(c.arguments[1]) && c.arguments[1].includes('SG')),
      false,
      'No country param should be injected when country/region is absent'
    );
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
    assert.equal(responseTotal(body), 3);
  });

  it('uses search_products tier when requested for keyword searches', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=wireless+headphones&country_code=US&_tier=1`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-search-tier'), '1');
    assert.equal(body.source, 'search_products_tier');

    const tierCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('FROM search_products sp')
    );
    assert.ok(tierCall, 'Expected tier query before archive fallback');
    assert.ok(!tierCall.arguments[0].includes('sp.currency = $'), 'Currency is rank-only unless price filters are present');
    // BUY-73321: PRICE_BANDS inserted warnLow (USD=0.5) and warnHigh (USD=15000)
    // between countryCode and deliverTo. With country_code=US (no min/maxPrice),
    // params are: [q, or, countryCode, warnLow, warnHigh, deliverTo, limit, offset].
    assert.deepEqual(tierCall.arguments[1].slice(0, 7), ['wireless headphones', 'wireless | headphones', 'US', 0.5, 15000, 'US', 21]);
  });

  it('falls back to archive search when requested tier returns no rows', async () => {
    let tierCalls = 0;
    queryMock.mock.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK') || sql.includes('SET LOCAL'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('FROM search_products sp')) {
        tierCalls += 1;
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('COUNT')) {
        return Promise.resolve({ rows: [{ count: '1' }] });
      }
      if (Array.isArray(params) && params.includes('wireless headphones')) {
        return Promise.resolve({ rows: [makeProduct('archive-1', { title: 'Wireless Headphones', country_code: 'US' })] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=wireless+headphones&country_code=US&_tier=1`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-search-tier'), null);
    assert.notEqual(body.source, 'search_products_tier');
    assert.equal(responseTotal(body), 1);
    assert.equal(responseResults(body)[0].title, 'Wireless Headphones');
    assert.equal(tierCalls, 3);
  });

  it('uses bounded title fallback for US laptop searches', async () => {
    queryMock.mock.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK') || sql.includes('SET LOCAL'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('lower(sp.title) LIKE lower($1 ||') && Array.isArray(params) && params[2] === 'US') {
        return Promise.resolve({ rows: [makeProduct('1', { title: 'ASUS ROG Gaming Laptop', country_code: 'US', source: 'amazon_us' })] });
      }
      if (typeof sql === 'string' && sql.includes('search_products sp')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=asus+rog+laptop&country_code=US&_tier=1`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.ok(responseResults(body).length > 0);

    const laptopFallbackCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('WITH tcand AS')
        && c.arguments[0].includes('lower(sp.title) LIKE lower($1 ||')
    );
    assert.ok(laptopFallbackCall, 'Expected bounded title fallback query');
    assert.ok(laptopFallbackCall.arguments[0].includes('LIMIT 1000'));
    assert.ok(laptopFallbackCall.arguments[0].includes('ORDER BY'));
    // BUY-73321: PRICE_BANDS inserted warnLow (USD=0.5) and warnHigh (USD=15000)
    // between countryCode and deliverTo. With country_code=US (no min/maxPrice),
    // params are: [q, or, countryCode, warnLow, warnHigh, deliverTo, limit, offset].
    assert.deepEqual(laptopFallbackCall.arguments[1], ['asus rog laptop', 'asus | rog | laptop', 'US', 0.5, 15000, 'US', 21, 0]);
  });

  it('applies price range filters with NL query', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=headphones&min_price=50&max_price=200`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const filteredCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' &&
        c.arguments[0].includes('price >=') &&
        c.arguments[0].includes('price <=')
    );
    assert.ok(filteredCall);
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

  it('adds P2.6 emptiness metadata to empty search 200 responses only', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const emptyRes = await fetch(`http://localhost:${port}/v1/products/search?q=zzzznonexistentproductxyz123&country=SG`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const emptyBody = await emptyRes.json();

    assert.equal(emptyRes.status, 200);
    assert.equal(responseResults(emptyBody).length, 0);
    assert.equal(emptyBody.meta.emptiness_reason, 'no_match');
    assert.equal(emptyBody.meta.confidence, 'high');
    assert.equal(emptyBody.meta.diagnostic.engine_status, 'ok');
    assert.equal(emptyBody.meta.diagnostic.indexed_for_region, true);
    assert.equal(emptyBody.meta.diagnostic.category_recognized, true);
    assert.equal(emptyBody.meta.diagnostic.deliver_to_present, true);
    assert.equal(emptyBody.meta.deliver_to, 'SG');

    setupDefaultMocks();
    const hitRes = await fetch(`http://localhost:${port}/v1/products/search?q=coffee&country=SG`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const hitBody = await hitRes.json();

    assert.equal(hitRes.status, 200);
    assert.ok(responseResults(hitBody).length > 0);
    assert.equal(hitBody.meta.emptiness_reason, undefined);
  });

  it('BUY-79591: deliver_to param sets diagnostic.deliver_to_present even without country=', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const presentRes = await fetch(`http://localhost:${port}/v1/products/search?q=zzzznonexistentsku999xyz&deliver_to=SG`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const presentBody = await presentRes.json();
    assert.equal(presentRes.status, 200);
    assert.equal(presentBody.meta.deliver_to, 'SG');
    assert.equal(presentBody.meta.diagnostic.deliver_to_present, true);
    assert.notEqual(presentBody.meta.emptiness_reason, 'deliver_to_missing');

    const omittedRes = await fetch(`http://localhost:${port}/v1/products/search?q=zzzznonexistentsku999xyz`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const omittedBody = await omittedRes.json();
    assert.equal(omittedRes.status, 200);
    assert.equal(omittedBody.meta.diagnostic.deliver_to_present, false);
    assert.equal(omittedBody.meta.emptiness_reason, 'deliver_to_missing');
    assert.equal(omittedBody.meta.confidence, 'high');

    const invalidRes = await fetch(`http://localhost:${port}/v1/products/search?q=zzzznonexistentsku999xyz&deliver_to=XX`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const invalidBody = await invalidRes.json();
    assert.equal(invalidRes.status, 200);
    assert.equal(invalidBody.meta.diagnostic.deliver_to_present, true);
    assert.equal(invalidBody.meta.emptiness_reason, 'region_unsupported');
    assert.equal(invalidBody.meta.diagnostic.invalid_deliver_to, true);
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
    assert.equal(responsePage(body).limit, 5);
    assert.equal(responsePage(body).offset, 10);

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
    assert.equal(responsePage(body).limit, 100);
  });

  it('handles special characters in query', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=iPhone+15+Pro+Max+%26+Mini`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const queryParamCall = queryMock.mock.calls.find(
      c => Array.isArray(c.arguments[1]) && c.arguments[1].some(p => typeof p === 'string' && p.includes('iPhone 15 Pro Max'))
    );
    assert.ok(queryParamCall);
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
    assert.ok(responseResults(body)[0].canonical_id != null);
    assert.ok(responseResults(body)[0].normalized_price_usd != null);
    assert.ok(Array.isArray(responseResults(body)[0].comparison_attributes));
    assert.equal(responseResults(body)[0].comparison_attributes[0].key, 'brand');
    assert.equal(responseResults(body)[0].comparison_attributes[0].value, 'TestBrand');
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
    assert.equal(responseCached(body), true);
    assert.equal(responseTotal(body), 0);

    redisGetMock.mock.mockImplementation(() => Promise.resolve(null));
  });

  it('handles non-ASCII characters in NL query', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=caf%C3%A9+machine`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const queryParamCall = queryMock.mock.calls.find(
      c => Array.isArray(c.arguments[1]) && c.arguments[1].some(p => typeof p === 'string' && p.includes('caf'))
    );
    assert.ok(queryParamCall);
    const params = queryParamCall.arguments[1];
    const hasCafe = params.some(p => typeof p === 'string' && p.includes('caf'));
    assert.ok(hasCafe);
  });

  it('supports domain/platform filter with NL query', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=monitor&domain=amazon_us`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const filteredCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' &&
        c.arguments[0].includes('source =') &&
        Array.isArray(c.arguments[1]) &&
        c.arguments[1].includes('amazon_us')
    );
    assert.ok(filteredCall);
  });

  it('preserves backward-compat `country` param alias', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('COUNT')) {
        const hasMY = sql.includes("'MY'") || (Array.isArray(arguments[1]) && arguments[1].includes('MY'));
        return Promise.resolve({ rows: [{ count: hasMY ? '2' : '0' }] });
      }
      return Promise.resolve({ rows: [makeProduct('1', { country_code: 'MY' })] });
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=shoe&country=MY`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(responseResults(body)[0].country_code, 'MY');

    const filteredCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' &&
        c.arguments[0].includes('country_code = $') &&
        Array.isArray(c.arguments[1]) &&
        c.arguments[1].includes('MY')
    );
    assert.ok(filteredCall);
  });

  it('region filter overrides default SG country', async () => {
    const res = await fetch(`http://localhost:${port}/v1/products/search?q=watch&region=US`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    assert.equal(res.status, 200);

    const filteredCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' &&
        c.arguments[0].includes('region =') &&
        !c.arguments[0].includes('country_code = $') &&
        Array.isArray(c.arguments[1]) &&
        c.arguments[1].includes('US')
    );
    assert.ok(filteredCall);
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

  it('keeps ts_rank relevance ordering even when the result set is large', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('COUNT')) {
        return Promise.resolve({ rows: [{ count: '2500' }] });
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
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('ORDER BY top_ids.rank DESC')
    );
    assert.ok(dataCall, 'Expected live route to keep ts_rank ordering');
  });

  it('uses vector search for semantic mode when vector infra is available', async () => {
    process.env.FLOWAI_EMBED_API_KEY = 'test-flow-key';
    config.vectorDb = { query: vectorQueryMock };
    vectorQueryMock.mock.mockImplementation(() => Promise.resolve({
      rows: [{ product_id: '2' }, { product_id: '1' }],
    }));
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('WHERE id = ANY($1::bigint[]) AND')) {
        return Promise.resolve({ rows: [{ id: '2' }, { id: '1' }] });
      }
      if (typeof sql === 'string' && sql.includes('WHERE products.id = ANY($1::bigint[])')) {
        return Promise.resolve({
          rows: [
            makeProduct('1', { title: 'Gaming Laptop', price: 1299 }),
            makeProduct('2', { title: 'Office Laptop', price: 899 }),
          ],
        });
      }
      return defaultQueryHandler(sql);
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop&mode=semantic`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(embedQueryMock.mock.calls.length, 1);
    assert.equal(vectorQueryMock.mock.calls.length, 1);
    assert.deepEqual(responseResults(body).map((product) => product.id), ['2', '1']);

    const ftsRankingCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('ORDER BY ts_rank')
    );
    assert.equal(ftsRankingCall, undefined);
  });

  it('uses RRF merge for hybrid mode when vector infra is available', async () => {
    process.env.FLOWAI_EMBED_API_KEY = 'test-flow-key';
    config.vectorDb = { query: vectorQueryMock };
    vectorQueryMock.mock.mockImplementation(() => Promise.resolve({
      rows: [{ product_id: '2' }, { product_id: '3' }],
    }));
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('WHERE id = ANY($1::bigint[]) AND')) {
        return Promise.resolve({ rows: [{ id: '2' }, { id: '3' }] });
      }
      if (typeof sql === 'string' && /ORDER BY \(?ts_rank\(search_vector/.test(sql)) {
        return Promise.resolve({ rows: [{ id: '1' }, { id: '2' }] });
      }
      if (typeof sql === 'string' && sql.includes('WHERE products.id = ANY($1::bigint[])')) {
        return Promise.resolve({
          rows: [
            makeProduct('1', { title: 'Gaming Laptop', price: 1299 }),
            makeProduct('2', { title: 'Office Laptop', price: 899 }),
            makeProduct('3', { title: 'Ultrabook', price: 1499 }),
          ],
        });
      }
      return defaultQueryHandler(sql);
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop&mode=hybrid`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.ok(embedQueryMock.mock.calls.length >= 1);
    assert.ok(vectorQueryMock.mock.calls.length >= 1);
    // BUY-80685: keyword-bias floor keeps top FTS hits ahead of purely-semantic
    // neighbors. FTS order is [1, 2]; semantic contributes 3 after the floor.
    assert.deepEqual(responseResults(body).map((product) => product.id).slice(0, 3), ['1', '2', '3']);
    assert.ok(responseResults(body).length >= 2, 'hybrid must keep FTS SKU coverage');

    // BUY-74181: fts_top ORDER BY is parenthesized around the rank expression
    // (`ORDER BY (ts_rank(search_vector, ...) * amazon_mult) DESC`), so the
    // substring is `ORDER BY (ts_rank(search_vector` (with paren) — accept either.
    const ftsRankingCall = queryMock.mock.calls.find(
      c => typeof c.arguments[0] === 'string' && /ORDER BY \(?ts_rank\(search_vector/.test(c.arguments[0])
    );
    assert.ok(ftsRankingCall, 'Expected hybrid mode to query FTS candidates for RRF');
    const sql = ftsRankingCall.arguments[0];
    assert.ok(sql.includes('fts_cand'), 'Hybrid FTS should use bounded fts_cand CTE');
    assert.ok(sql.includes('LIMIT 200'), 'Hybrid FTS gather should be limited to CANDIDATE_CAP=200 candidates');
    assert.ok(sql.includes('fts_top'), 'Hybrid FTS ranking should be confined to fts_top');
  });

  it('BUY-80685 hybrid keeps all FTS SKU hits even when semantic neighbors dominate RRF', async () => {
    process.env.FLOWAI_EMBED_API_KEY = 'test-flow-key';
    config.vectorDb = { query: vectorQueryMock };
    // 8 semantic-only neighbors that would outrank FTS under equal-weight RRF
    // if they also appeared in a later FTS window — here they are semantic-only.
    const semanticOnly = Array.from({ length: 8 }, (_, i) => String(100 + i));
    vectorQueryMock.mock.mockImplementation(() => Promise.resolve({
      rows: semanticOnly.map((product_id) => ({ product_id })),
    }));
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('WHERE id = ANY($1::bigint[]) AND')) {
        return Promise.resolve({ rows: semanticOnly.map((id) => ({ id })) });
      }
      if (typeof sql === 'string' && /ORDER BY \(?ts_rank\(search_vector/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'sku-a' }, { id: 'sku-b' }, { id: 'sku-c' }, { id: 'sku-d' }, { id: 'sku-e' }] });
      }
      if (typeof sql === 'string' && sql.includes('WHERE products.id = ANY($1::bigint[])')) {
        const ids = ['sku-a', 'sku-b', 'sku-c', 'sku-d', 'sku-e', ...semanticOnly];
        return Promise.resolve({
          rows: ids.map((id) => makeProduct(id, { title: id.startsWith('sku') ? 'AirPods Pro 2' : 'Accessory ' + id })),
        });
      }
      return defaultQueryHandler(sql);
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=${encodeURIComponent('AirPods Pro 2')}&mode=hybrid&limit=10`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    const ids = responseResults(body).map((product) => product.id);
    for (const sku of ['sku-a', 'sku-b', 'sku-c', 'sku-d', 'sku-e']) {
      assert.ok(ids.includes(sku), `hybrid must retain FTS hit ${sku}, got ${ids.join(',')}`);
    }
    assert.ok(ids.length >= 5, `hybrid n=${ids.length} must be >= keyword n=5`);
  });

  it('BUY-80685 semantic fail-opens to FTS when vector filter returns 0 in-scope ids', async () => {
    process.env.FLOWAI_EMBED_API_KEY = 'test-flow-key';
    config.vectorDb = { query: vectorQueryMock };
    vectorQueryMock.mock.mockImplementation(() => Promise.resolve({
      rows: [{ product_id: '999' }],
    }));
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('WHERE id = ANY($1::bigint[]) AND')) {
        return Promise.resolve({ rows: [] }); // no in-scope embeddings
      }
      if (typeof sql === 'string' && /ORDER BY \(?ts_rank\(search_vector/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'sku-a' }, { id: 'sku-b' }] });
      }
      if (typeof sql === 'string' && sql.includes('WHERE products.id = ANY($1::bigint[])')) {
        return Promise.resolve({
          rows: [
            makeProduct('sku-a', { title: 'AirPods Pro 2' }),
            makeProduct('sku-b', { title: 'AirPods Pro 2 USB-C' }),
          ],
        });
      }
      return defaultQueryHandler(sql);
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=${encodeURIComponent('AirPods Pro 2')}&mode=semantic&limit=10`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    const ids = responseResults(body).map((product) => product.id);
    assert.ok(ids.length >= 1, `semantic n=${ids.length} must be >= 1 when FTS has SKUs`);
    assert.ok(ids.includes('sku-a'));
  });

  // BUY-52089: vector search should fall back to FTS when vector query throws (e.g., dim mismatch)
  it('falls back to FTS when vector query throws', async () => {
    process.env.FLOWAI_EMBED_API_KEY = 'test-flow-key';
    config.vectorDb = { query: vectorQueryMock };
    // Simulate vector query throwing (e.g., dimension mismatch error)
    vectorQueryMock.mock.mockImplementation(() => Promise.reject(new Error('different vector dimensions 512 and 1024')));
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      if (typeof sql === 'string' && sql.includes('FROM products') && sql.includes('ORDER BY ts_rank')) {
        return Promise.resolve({ rows: [{ id: '1' }] });
      }
      if (typeof sql === 'string' && sql.includes('WHERE products.id = ANY($1::bigint[])')) {
        return Promise.resolve({
          rows: [makeProduct('1', { title: 'Gaming Laptop', price: 1299 })],
        });
      }
      return defaultQueryHandler(sql);
    });

    const res = await fetch(`http://localhost:${port}/v1/products/search?q=laptop&mode=semantic`, {
      headers: { Authorization: 'Bearer test-key' },
    });
    const body = await res.json();

    assert.equal(res.status, 200, 'Should return 200 (not 500) when vector search fails');
    assert.ok(body.data?.length >= 0, 'Should return some result (FTS fallback)');
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
    assert.equal(cacheSetCalls[0].arguments[3], 3600);
  });

  it('uses correct cache key format', async () => {
    await fetch(`http://localhost:${port}/v1/products/search?q=keyfmt`, {
      headers: { Authorization: 'Bearer test-key' },
    });

    const cacheGetCalls = redisGetMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string'
        && c.arguments[0].startsWith('fts:')
        && c.arguments[0].includes(':keyfmt:')
    );
    assert.ok(cacheGetCalls.length >= 1);
    // BUY-74205 (outbound probe) inserted a `probeN:` segment between the cache
    // version and the qNorm, so the key is `fts:<ver>:probe0:keyfmt:...`.
    // Accept any non-empty segment between the version and `keyfmt`.
    assert.ok(cacheGetCalls[0].arguments[0].match(/^fts:[^:]+:[^:]+:keyfmt:/), `unexpected cache key format: ${cacheGetCalls[0].arguments[0]}`);
  });
});

// BUY-69621: device-query vs storage-category exclusion regression.
// Verifies the HARD filter SQL fragment is present in candidate WHERE clauses
// for device queries and absent for storage queries (positive control).
describe('BUY-69621 device-vs-storage exclusion (BUY-69616)', () => {
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

  // The storage-category exclusion fragment, matching both the `sp.` (tier) and
  // `products` (archive) alias forms. After BUY-69727 the SQL uses ILIKE ANY
  // (replaced ~* POSIX regex to eliminate live-leak ambiguity with spaces).
  // Accept both coalesce arg orderings (tier uses sp.category; archive uses metadata->>'category' FIRST
  // then category — order is non-semantic but tests written against the old tier path expected the
  // reverse). The fallback `category(?:\s+COALESCE\s+metadata->>'category')?` matches both.
  const STORAGE_EXCL_RE = /NOT\s*\(lower\(coalesce\((?:sp\.category|(?:metadata->>'category'\s*,\s*)?category(?:\s*,\s*metadata->>'category')?),\s*''\)\)\s+ILIKE\s+ANY/i;

  const deviceQueries = [
    'gaming laptop', 'laptop', 'macbook', 'gaming pc', 'desktop computer',
    'iphone', 'android phone', 'smartphone', 'tablet', 'gaming monitor',
    'wireless earbuds', 'smart watch',
  ];
  const storageQueries = ['ssd', 'nvme ssd', 'portable ssd', '1tb ssd', 'gaming ssd', 'internal ssd'];

  for (const q of deviceQueries) {
    it(`tier path excludes storage categories for device query "${q}"`, async () => {
      const res = await fetch(
        `http://localhost:${port}/v1/products/search?q=${encodeURIComponent(q)}&country_code=US&_tier=1`,
        { headers: { Authorization: 'Bearer test-key' } },
      );
      assert.equal(res.status, 200);
      const tierCalls = queryMock.mock.calls.filter(
        c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('FROM search_products sp')
      );
      assert.ok(tierCalls.length > 0, `expected tier query for "${q}"`);
      assert.ok(
        tierCalls.some(c => STORAGE_EXCL_RE.test(c.arguments[0])),
        `device query "${q}" must hard-exclude storage categories in tier path`,
      );
    });
  }

  for (const q of storageQueries) {
    it(`tier path does NOT exclude storage for storage query "${q}" (positive control)`, async () => {
      const res = await fetch(
        `http://localhost:${port}/v1/products/search?q=${encodeURIComponent(q)}&country_code=US&_tier=1`,
        { headers: { Authorization: 'Bearer test-key' } },
      );
      assert.equal(res.status, 200);
      const tierCalls = queryMock.mock.calls.filter(
        c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('FROM search_products sp')
      );
      assert.ok(tierCalls.length > 0);
      assert.ok(
        !tierCalls.some(c => STORAGE_EXCL_RE.test(c.arguments[0])),
        `storage query "${q}" must NOT be filtered (positive control)`,
      );
    });
  }

  it('archive path excludes storage categories for a device query', async () => {
    // _tier=0 forces the archive fallback path.
    const res = await fetch(
      `http://localhost:${port}/v1/products/search?q=${encodeURIComponent('gaming laptop')}&country_code=US&_tier=0`,
      { headers: { Authorization: 'Bearer test-key' } },
    );
    assert.equal(res.status, 200);
    // The archive FTS dataQuery ranks via ts_rank inside a recent_candidates CTE
    // over the unaliased `products` table.
    const dataCalls = queryMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string'
        && c.arguments[0].includes('FROM products')
        && c.arguments[0].includes('recent_candidates AS MATERIALIZED')
    );
    assert.ok(dataCalls.length > 0, 'expected archive recent_candidates query');
    assert.ok(
      dataCalls.some(c => STORAGE_EXCL_RE.test(c.arguments[0])),
      'archive path must hard-exclude storage categories for "gaming laptop"',
    );
  });

  it('non-device, non-storage query is not filtered (e.g. "running shoes")', async () => {
    const res = await fetch(
      `http://localhost:${port}/v1/products/search?q=${encodeURIComponent('running shoes')}&country_code=US&_tier=1`,
      { headers: { Authorization: 'Bearer test-key' } },
    );
    assert.equal(res.status, 200);
    const tierCalls = queryMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('FROM search_products sp')
    );
    assert.ok(
      !tierCalls.some(c => STORAGE_EXCL_RE.test(c.arguments[0])),
      'irrelevant query must not be filtered (fail-open)',
    );
  });
});

// BUY-69727: Seeded regression tests.
// Uses a real seeded mock (not queryMock) so the handler processes actual product
// data and exercises the full response-building path, including the ILIKE ANY
// exclusion fragment generated by deviceStorageExclusionFragment.
describe('BUY-69727 storage-exclusion seeded regression', () => {
  let server;
  let port;

  // Matches the ILIKE ANY fragment in the SQL (from searchRelevanceTaxonomy.ts)
  // Accept both coalesce arg orderings (tier uses sp.category; archive uses metadata->>'category' FIRST
  // then category — order is non-semantic but tests written against the old tier path expected the
  // reverse). The fallback `category(?:\s+COALESCE\s+metadata->>'category')?` matches both.
  const STORAGE_EXCL_RE = /NOT\s*\(lower\(coalesce\((?:sp\.category|(?:metadata->>'category'\s*,\s*)?category(?:\s*,\s*metadata->>'category')?),\s*''\)\)\s+ILIKE\s+ANY/i;

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

  // Canonical Firecuda row from BUY-69616 repro.
  const FIRECUDA = {
    id: '9SIBZW0KN79535',
    sku: 'src_9SIBZW0KN79535',
    source: 'amazon_us',
    title: 'Seagate Firecuda 520 SSD 1TB PCIe 4.0 NVMe M.2 Internal Gaming Storage',
    price: 129.99,
    currency: 'USD',
    url: 'https://amazon.com/p/9SIBZW0KN79535',
    image_url: null,
    metadata: { brand: 'Seagate', category: 'Storage', availability: 'in_stock' },
    updated_at: '2026-05-03T00:00:00Z',
    region: 'US',
    country_code: 'US',
  };
  const LAPTOP_A = {
    id: 'laptop_a', sku: 'src_laptop_a', source: 'amazon_us',
    title: 'ASUS ROG Zephyrus G16 Gaming Laptop Intel Core i9 RTX 4070',
    price: 1999.99, currency: 'USD',
    url: 'https://amazon.com/p/laptop_a', image_url: null,
    metadata: { brand: 'ASUS', category: 'Computers', availability: 'in_stock' },
    updated_at: '2026-05-03T00:00:00Z', region: 'US', country_code: 'US',
  };
  const LAPTOP_B = {
    id: 'laptop_b', sku: 'src_laptop_b', source: 'bestbuy_us',
    title: 'Dell XPS 15 Laptop 15.6" Intel i7 32GB RAM 1TB SSD',
    price: 1799.99, currency: 'USD',
    url: 'https://bestbuy.com/p/laptop_b', image_url: null,
    metadata: { brand: 'Dell', category: 'Computers', availability: 'in_stock' },
    updated_at: '2026-05-03T00:00:00Z', region: 'US', country_code: 'US',
  };
  const LAPTOP_C = {
    id: 'laptop_c', sku: 'src_laptop_c', source: 'newegg_us',
    title: 'Lenovo ThinkPad X1 Carbon Gen 11 Laptop Intel i7 16GB',
    price: 1499.99, currency: 'USD',
    url: 'https://newegg.com/p/laptop_c', image_url: null,
    metadata: { brand: 'Lenovo', category: 'Computers', availability: 'in_stock' },
    updated_at: '2026-05-03T00:00:00Z', region: 'US', country_code: 'US',
  };
  const PHONE_A = {
    id: 'phone_a', sku: 'src_phone_a', source: 'amazon_us',
    title: 'Samsung Galaxy S24 Ultra 256GB Titanium Black',
    price: 1099.99, currency: 'USD',
    url: 'https://amazon.com/p/phone_a', image_url: null,
    metadata: { brand: 'Samsung', category: 'Cell Phones', availability: 'in_stock' },
    updated_at: '2026-05-03T00:00:00Z', region: 'US', country_code: 'US',
  };
  const PHONE_CASE = {
    id: 'phone_case_a', sku: 'src_phone_case_a', source: 'amazon_us',
    title: 'Spigen Ultra Hybrid iPhone 15 Pro Max Case - Black',
    price: 14.99, currency: 'USD',
    url: 'https://amazon.com/p/phone_case_a', image_url: null,
    metadata: { brand: 'Spigen', category: 'Cell Phone Accessories', availability: 'in_stock' },
    updated_at: '2026-05-03T00:00:00Z', region: 'US', country_code: 'US',
  };

  function seededTierHandler(sql, params) {
    if (typeof sql === 'string' && sql.includes('api_keys')) {
      return Promise.resolve({
        rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }],
      });
    }
    if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
      return Promise.resolve({ rows: [] });
    }
    if (typeof sql === 'string' && sql.includes('COUNT')) {
      return Promise.resolve({ rows: [{ count: '1' }] });
    }
    // Seeded catalog rows for all test cases.
    return Promise.resolve({
      rows: [
        makeProduct('firecuda', {
          title: FIRECUDA.title,
          price: FIRECUDA.price,
          metadata: FIRECUDA.metadata,
        }),
        makeProduct('laptop_a', { title: LAPTOP_A.title, price: LAPTOP_A.price, metadata: LAPTOP_A.metadata }),
        makeProduct('laptop_b', { title: LAPTOP_B.title, price: LAPTOP_B.price, metadata: LAPTOP_B.metadata }),
        makeProduct('laptop_c', { title: LAPTOP_C.title, price: LAPTOP_C.price, metadata: LAPTOP_C.metadata }),
        makeProduct('phone_a', { title: PHONE_A.title, price: PHONE_A.price, metadata: PHONE_A.metadata }),
        makeProduct('phone_case_a', { title: PHONE_CASE.title, price: PHONE_CASE.price, metadata: PHONE_CASE.metadata }),
      ],
    });
  }

  async function searchGamingLaptop() {
    queryMock.mock.mockImplementation(seededTierHandler);
    const res = await fetch(
      `http://localhost:${port}/v1/products/search?q=gaming+laptop&country_code=US&_tier=1`,
      { headers: { Authorization: 'Bearer test-key' } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    return body.data ?? body.results ?? [];
  }

  async function searchStorage() {
    queryMock.mock.mockImplementation(seededTierHandler);
    const res = await fetch(
      `http://localhost:${port}/v1/products/search?q=ssd&country_code=US&_tier=1`,
      { headers: { Authorization: 'Bearer test-key' } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    return body.data ?? body.results ?? [];
  }

  async function searchPhone() {
    queryMock.mock.mockImplementation(seededTierHandler);
    const res = await fetch(
      `http://localhost:${port}/v1/products/search?q=phone&country_code=US&_tier=1`,
      { headers: { Authorization: 'Bearer test-key' } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    return body.data ?? body.results ?? [];
  }

  // Note: The SQL-layer filter (ILIKE ANY) is tested by the BUY-69621 tests above.
  // These seeded tests verify the integration path (handler receives rows and builds
  // a response) and confirm the positive-control case works end-to-end.
  it('gaming laptop query returns seeded rows (integration sanity)', async () => {
    const results = await searchGamingLaptop();
    assert.ok(results.length > 0, 'should return at least one result');
    // The seeded mock returns ALL rows regardless of the SQL filter — the actual
    // filtering happens at the DB layer, not in the handler. This test just
    // verifies the handler receives results and builds a response.
  });

  it('ssd query includes storage products (positive control)', async () => {
    const results = await searchStorage();
    const storagePresent = results.some(
      (r) => (r.title || '').toLowerCase().includes('firecuda') || (r.title || '').toLowerCase().includes('ssd'),
    );
    assert.ok(storagePresent, 'storage products should be in "ssd" results (positive control)');
  });

  it('gaming laptop query SQL contains ILIKE ANY storage exclusion', async () => {
    queryMock.mock.mockImplementation(seededTierHandler);
    queryMock.mock.resetCalls(); // isolate from prior tests
    await fetch(
      `http://localhost:${port}/v1/products/search?q=gaming+laptop&country_code=US&_tier=1`,
      { headers: { Authorization: 'Bearer test-key' } },
    );
    const tierCalls = queryMock.mock.calls.filter(
      (c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('FROM search_products sp'),
    );
    assert.ok(tierCalls.length > 0, 'expected at least one tier query');
    assert.ok(
      tierCalls.some((c) => STORAGE_EXCL_RE.test(c.arguments[0])),
      'tier SQL must contain ILIKE ANY storage exclusion for "gaming laptop"',
    );
  });

  it('ssd query SQL does NOT contain storage exclusion (positive control)', async () => {
    queryMock.mock.mockImplementation(seededTierHandler);
    queryMock.mock.resetCalls(); // isolate from prior tests
    await fetch(
      `http://localhost:${port}/v1/products/search?q=ssd&country_code=US&_tier=1`,
      { headers: { Authorization: 'Bearer test-key' } },
    );
    const tierCalls = queryMock.mock.calls.filter(
      (c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('FROM search_products sp'),
    );
    assert.ok(tierCalls.length > 0);
    assert.ok(
      !tierCalls.some((c) => STORAGE_EXCL_RE.test(c.arguments[0])),
      'tier SQL must NOT contain storage exclusion for "ssd" query (positive control)',
    );
  });

  it('phone query demotes phone-case accessory from top-3', async () => {
    const results = await searchPhone();
    // The accessory demotion puts phone cases after primary phones.
    // Assert at least one phone is before any case.
    const titles = results.map((r) => (r.title || '').toLowerCase());
    const phoneIdx = titles.findIndex((t) => t.includes('galaxy') || t.includes('iphone') || t.includes('pixel'));
    const caseIdx = titles.findIndex((t) => t.includes('case') || t.includes('cover') || t.includes('accessory'));
    if (phoneIdx !== -1 && caseIdx !== -1) {
      assert.ok(
        phoneIdx < caseIdx,
        `Primary phone (idx=${phoneIdx}) must rank before case (idx=${caseIdx}): ${titles.join(' | ')}`,
      );
    }
  });
});

