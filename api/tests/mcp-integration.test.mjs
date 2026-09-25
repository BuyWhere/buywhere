import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

process.env.NODE_ENV = 'test';
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';

const queryMock = mock.fn();
const redisGetMock = mock.fn(() => Promise.resolve(null));
const redisSetMock = mock.fn(() => Promise.resolve('OK'));
const redisIncrMock = mock.fn(() => Promise.resolve(1));
const redisExpireMock = mock.fn(() => Promise.resolve(1));

const config = require('../dist/config');
// Mock client returned by db.connect() — the route uses db.connect() for search queries
const mockClient = {
  query: queryMock,
  release: () => {},
};
config.db.query = queryMock;
config.db.connect = mock.fn(() => Promise.resolve(mockClient));
config.redis.get = redisGetMock;
config.redis.set = redisSetMock;
config.redis.incr = redisIncrMock;
config.redis.expire = redisExpireMock;
config.redis.on = () => {};

function makeProduct(id, overrides = {}) {
  return {
    id, sku: `src_${id}`, source: overrides.source || 'shopee_sg',
    domain: overrides.domain || overrides.source || 'shopee_sg',
    title: overrides.title || `Product ${id}`,
    price: overrides.price ?? 99.99, currency: overrides.currency || 'SGD',
    url: `https://x.com/p${id}`, image_url: overrides.image_url || null,
    metadata: overrides.metadata || null,
    updated_at: overrides.updated_at || '2026-05-03T00:00:00Z',
    region: overrides.region || 'SEA', country_code: overrides.country_code || 'SG',
    ...(overrides.original_price != null ? { original_price: overrides.original_price } : {}),
    ...(overrides.discount_pct != null ? { discount_pct: overrides.discount_pct } : {}),
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
  // BUY-72082 tier search stage-2: PK detail lookup joins back to products for
  // the full MCP output columns. Match it before `category_path` — this query's
  // column list legitimately contains `category_path` (a products column alias),
  // which would otherwise be swallowed by the category-listing branch below.
  if (typeof sql === 'string' && sql.includes('FROM products WHERE id IN')) {
    return Promise.resolve({
      rows: [makeProduct('1', { title: 'Gaming Laptop', price: 1299 }), makeProduct('2', { title: 'Office Laptop', price: 899 })],
    });
  }
  // FTS query (keyword/semantic/hybrid): uses "cand AS" CTE + ts_rank, SELECTs category_path
  if (typeof sql === 'string' && sql.includes('cand AS') && sql.includes('ts_rank')) {
    return Promise.resolve({
      rows: [makeProduct('1', { title: 'Gaming Laptop', price: 1299 }), makeProduct('2', { title: 'Office Laptop', price: 899 })],
    });
  }
  // 2026-09-05: this branch matched the bare substring `category_path`, which the
  // product-search SELECT lists legitimately contain (p.category_path / sp.category_path
  // are output columns). It therefore swallowed the real search queries and returned
  // CATEGORY rows to them — 0 products — which is why search_products, the `query`
  // alias and find_best_price have failed every CI run. The genuine category listing
  // is `SELECT category_path[1] AS slug ... COUNT(*) AS product_count`, so match the
  // aggregate alias, not the column name.
  if (typeof sql === 'string' && sql.includes('AS product_count')) {
    return Promise.resolve({ rows: [{ slug: 'electronics', name: 'Electronics', product_count: '150' }] });
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
  redisGetMock.mock.mockImplementation(() => Promise.resolve(null));
}

let server;
let port;

before(async () => {
  setupDefaultMocks();

  const express = require('express');
  const mcpRouter = require('../dist/routes/mcp').default;

  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpRouter);
  app.use('/', mcpRouter);
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  port = server.address().port;
});

after(() => {
  server?.close();
  // Disconnect Redis and Pool to prevent event-loop hang
  try { config.redis.disconnect(); } catch {}
  try { config.db.end(); } catch {}
});
beforeEach(() => { setupDefaultMocks(); });

describe('MCP JSON-RPC — public methods (no auth)', () => {
  it('GET /mcp returns server info descriptor', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.name, 'buywhere-catalog');
    assert.equal(body.protocol, 'mcp');
    assert.equal(body.protocolVersion, '2024-11-05');
    assert.equal(body.transport, 'http');
    assert.ok(Array.isArray(body.methods));
    assert.ok(body.methods.includes('initialize'));
    assert.ok(body.methods.includes('tools/list'));
    assert.ok(body.methods.includes('tools/call'));
    assert.ok(Array.isArray(body.tools));
  });

  it('initialize returns protocol capabilities', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 1);
    assert.ok(body.result);
    assert.equal(body.result.protocolVersion, '2024-11-05');
    assert.ok(body.result.capabilities);
    assert.ok(body.result.capabilities.tools);
    assert.equal(body.result.serverInfo.name, 'buywhere-catalog');
    assert.equal(body.result.serverInfo.version, '1.0.0');
  });

  it('tools/list returns tool manifest with all 8 tools', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.jsonrpc, '2.0');
    assert.ok(body.result);
    assert.ok(Array.isArray(body.result.tools));

    const toolNames = body.result.tools.map(t => t.name);
    const expected = ['search_products', 'get_product', 'compare_products', 'get_deals', 'list_categories', 'find_best_price', 'find_similar', 'ingest_products'];
    for (const name of expected) {
      assert.ok(toolNames.includes(name), `Missing tool: ${name}`);
    }
  });

  it('tools/list each tool has name, description, and inputSchema', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    });
    const body = await res.json();

    for (const tool of body.result.tools) {
      assert.ok(tool.name, `tool missing name`);
      assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `${tool.name} missing description`);
      assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
      assert.equal(tool.inputSchema.type, 'object');
    }
  });
});

describe('MCP JSON-RPC — tools/call (authenticated)', () => {
  it('search_products returns results in JSON-RPC content envelope', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 10, method: 'tools/call',
        params: { name: 'search_products', arguments: { q: 'laptop' } },
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 10);
    assert.ok(body.result);
    assert.ok(Array.isArray(body.result.content));
    assert.equal(body.result.content[0].type, 'text');

    const data = JSON.parse(body.result.content[0].text);
    assert.ok(Array.isArray(data.data));
    assert.equal(data.data.length, 2);
    assert.equal(data.data[0].title, 'Gaming Laptop');
    assert.equal(data.data[0].price.amount, 1299);
    assert.ok(typeof data.meta.response_time_ms === 'number');
  });

  it('search_products passes country_code filter when provided', async () => {
    await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 11, method: 'tools/call',
        params: { name: 'search_products', arguments: { q: 'laptop', country_code: 'SG' } },
      }),
    });

    const calls = queryMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('country_code')
    );
    assert.ok(calls.length >= 1, 'Expected country_code filter');
  });

  it('search_products with compact=true returns compact fields', async () => {
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
        rows: [makeProduct('1', { title: 'Compact Product', price: 50, metadata: { brand: 'TestBrand' } })],
      });
    });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 12, method: 'tools/call',
        params: { name: 'search_products', arguments: { q: 'test', compact: true } },
      }),
    });
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.equal(data.data[0].canonical_id, '1');
    assert.ok(data.data[0].normalized_price_usd != null);
    assert.ok(Array.isArray(data.data[0].comparison_attributes));
  });

  it('get_product returns single product', async () => {
    queryMock.mock.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({
        rows: [makeProduct('abc-123', { title: 'Specific Product', price: 199.99 })],
      });
    });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 13, method: 'tools/call',
        params: { name: 'get_product', arguments: { id: 'abc-123' } },
      }),
    });
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.equal(data.data[0].id, 'abc-123');
    assert.equal(data.data[0].title, 'Specific Product');
    assert.equal(data.data[0].price.amount, 199.99);
  });

  it('get_product returns error for missing product', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 14, method: 'tools/call',
        params: { name: 'get_product', arguments: { id: 'nonexistent' } },
      }),
    });
    const body = await res.json();
    assert.ok(body.error);
    assert.equal(body.error.code, -32001);
    assert.ok(body.error.message.includes('not found'));
  });

  it('compare_products returns multiple products', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({
        rows: [
          makeProduct('p1', { title: 'Phone A', price: 999 }),
          makeProduct('p2', { title: 'Phone B', price: 799 }),
        ],
      });
    });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 15, method: 'tools/call',
        params: { name: 'compare_products', arguments: { ids: ['p1', 'p2'] } },
      }),
    });
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.equal(data.data.length, 2);
    assert.equal(data.data[0].title, 'Phone A');
    assert.equal(data.data[1].title, 'Phone B');
  });

  it('compare_products rejects fewer than 2 IDs', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 16, method: 'tools/call',
        params: { name: 'compare_products', arguments: { ids: ['p1'] } },
      }),
    });
    const body = await res.json();
    assert.ok(body.error);
    assert.equal(body.error.code, -32602);
  });

  it('get_deals returns discounted products', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 17, method: 'tools/call',
        params: { name: 'get_deals', arguments: { min_discount: 20, limit: 5 } },
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.result);
    assert.ok(Array.isArray(body.result.content));
  });

  it('list_categories returns category list', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 18, method: 'tools/call',
        params: { name: 'list_categories', arguments: {} },
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    const data = JSON.parse(body.result.content[0].text);
    assert.ok(Array.isArray(data.data));
    assert.ok(data.meta);
  });

  it('find_best_price returns cheapest listing', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({
        rows: [
          { id: 'bp1', title: 'Cheap Phone', price: '599', currency: 'SGD', domain: 'shopee_sg', url: 'https://x.com/bp1', image_url: null, country_code: 'SG', rank: 0.5 },
          { id: 'bp2', title: 'Expensive Phone', price: '999', currency: 'SGD', domain: 'amazon_sg', url: 'https://x.com/bp2', image_url: null, country_code: 'SG', rank: 0.3 },
        ],
      });
    });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 19, method: 'tools/call',
        params: { name: 'find_best_price', arguments: { product_name: 'phone' } },
      }),
    });
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.ok(data.best_price);
    assert.equal(data.best_price.title, 'Cheap Phone');
    assert.equal(data.best_price.price.amount, 599);
    assert.ok(data.best_price.normalized_price_usd != null);
    assert.ok(Array.isArray(data.alternatives));
    assert.equal(data.alternatives.length, 1);
    assert.equal(data.alternatives[0].title, 'Expensive Phone');
  });

  it('find_best_price requires product_name', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 20, method: 'tools/call',
        params: { name: 'find_best_price', arguments: {} },
      }),
    });
    const body = await res.json();
    assert.ok(body.error);
    assert.equal(body.error.code, -32602);
  });

  // BUY-63229: scam-priced outliers (e.g. $0.97 giveaway junk) must not win
  // the price-ASC sort over legitimate listings. Median-USD filter rejects
  // candidates priced below 15% of the median USD-normalized price.
  it('find_best_price rejects scam-priced median outliers (BUY-63229)', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      // Mock returns rows in price-ASC order (as the real query does).
      // 2026-09-05: currency is USD, matching country_code US. These rows were
      // SGD-on-US — precisely the mislabelling BUY-80323's native-currency filter
      // rejects — so every row was dropped before ranking and best_price came back
      // null. The fixture contradicted the test's own USD reasoning below.
      // Scam listings come first (cheap), then real listings.
      return Promise.resolve({
        rows: [
          // Scam giveaway junk — should be REJECTED by the outlier guard.
          { id: 'scam1', title: 'Anker 165W Power Bank giveaway', price: '0.97', currency: 'USD', domain: 'thegiveawayguys.co.uk', url: 'https://x.com/scam1', image_url: null, country_code: 'US', updated_at: '2026-07-18' },
          { id: 'scam2', title: 'Anker Power Bank $1 deal', price: '1.00', currency: 'USD', domain: 'shady-store.com', url: 'https://x.com/scam2', image_url: null, country_code: 'US', updated_at: '2026-07-18' },
          // Legitimate listings in price-ASC order.
          { id: 'real3', title: 'Anker 325 Power Bank', price: '29.99', currency: 'USD', domain: 'walmart.com', url: 'https://x.com/real3', image_url: null, country_code: 'US', updated_at: '2026-07-18' },
          { id: 'real2', title: 'Anker PowerCore 20000mAh', price: '49.99', currency: 'USD', domain: 'amazon.com', url: 'https://x.com/real2', image_url: null, country_code: 'US', updated_at: '2026-07-18' },
          { id: 'real1', title: 'Anker 737 Power Bank 24000mAh', price: '109.99', currency: 'USD', domain: 'bestbuy.com', url: 'https://x.com/real1', image_url: null, country_code: 'US', updated_at: '2026-07-18' },
        ],
      });
    });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 22, method: 'tools/call',
        params: { name: 'find_best_price', arguments: { product_name: 'anker power bank', country_code: 'US' } },
      }),
    });
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.ok(data.best_price, 'should return a best_price');
    // The scam-priced listings must NOT be the best_price — the median of real
    // listings is ~$30 USD, so 15% threshold = ~$4.50 USD. $0.97/$1.00 are below.
    assert.notEqual(data.best_price.id, 'scam1', 'scam1 ($0.97) must not be best_price');
    assert.notEqual(data.best_price.id, 'scam2', 'scam2 ($1.00) must not be best_price');
    // The cheapest legitimate listing should be the winner (real3 at $29.99).
    assert.equal(data.best_price.id, 'real3', 'cheapest legitimate listing should win');
    assert.equal(data.best_price.title, 'Anker 325 Power Bank');
    // Guard metadata should indicate the guard was applied.
    assert.equal(data.meta.guard_applied, true);
    assert.ok(data.meta.median_usd > 0, 'median_usd should be populated');
    assert.ok(data.meta.min_allowed_usd > 0, 'min_allowed_usd should be populated');
  });

  // BUY-63229: with only legitimate listings (no outliers), the guard shouldn't
  // reject anything and the cheapest legitimate listing should win.
  it('find_best_price returns legitimate cheapest when no outliers (BUY-63229)', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({
        rows: [
          // Mock returns rows in price-ASC order (as the real query does).
          { id: 'leg4', title: 'iPhone 13', price: '599.00', currency: 'SGD', domain: 'amazon.com', url: 'https://x.com/leg4', image_url: null, country_code: 'SG', updated_at: '2026-07-18' },
          { id: 'leg3', title: 'iPhone 14', price: '699.00', currency: 'SGD', domain: 'amazon.com', url: 'https://x.com/leg3', image_url: null, country_code: 'SG', updated_at: '2026-07-18' },
          { id: 'leg2', title: 'iPhone 15', price: '799.00', currency: 'SGD', domain: 'bestbuy.com', url: 'https://x.com/leg2', image_url: null, country_code: 'SG', updated_at: '2026-07-18' },
          { id: 'leg1', title: 'iPhone 15 Pro', price: '999.00', currency: 'SGD', domain: 'apple.com', url: 'https://x.com/leg1', image_url: null, country_code: 'SG', updated_at: '2026-07-18' },
        ],
      });
    });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 23, method: 'tools/call',
        params: { name: 'find_best_price', arguments: { product_name: 'iphone', country_code: 'SG' } },
      }),
    });
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.ok(data.best_price);
    assert.equal(data.best_price.id, 'leg4');
    assert.equal(data.best_price.price.amount, 599.00);
    // With no outliers, the guard should not flag anything.
    assert.equal(data.meta.guard_applied, false);
  });

  // BUY-59390 — find_similar previously surfaced -32603 raw SQL errors when given a
  // UUID-shaped product_id (product_embeddings.product_id is bigint). Reject upfront
  // with -32602 and never reach the vector DB query.
  it('find_similar rejects UUID input with -32602 (BUY-59390)', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 21, method: 'tools/call',
        params: { name: 'find_similar', arguments: { product_id: 'b3aa5b4d-aaaa-bbbb-cccc-dddddddddddd' } },
      }),
    });
    const body = await res.json();
    assert.ok(body.error, 'should return error envelope');
    assert.equal(body.error.code, -32602);
    assert.match(body.error.message, /Invalid product_id format/);
  });
});

describe('MCP JSON-RPC — error handling', () => {
  it('requires authentication for tools/call', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 30, method: 'tools/call',
        params: { name: 'search_products', arguments: { q: 'laptop' } },
      }),
    });
    assert.equal(res.status, 401);
  });

  it('returns error for unknown method', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 31, method: 'nonexistent/method',
      }),
    });
    const body = await res.json();
    assert.ok(body.error);
    assert.equal(body.error.code, -32601);
    assert.ok(body.error.message.includes('Method not found'));
  });

  it('returns error for missing tool name', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 32, method: 'tools/call',
        params: { arguments: { q: 'test' } },
      }),
    });
    const body = await res.json();
    assert.ok(body.error);
    assert.equal(body.error.code, -32602);
    assert.ok(body.error.message.includes('Missing tool name'));
  });

  it('returns error for unknown tool', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 33, method: 'tools/call',
        params: { name: 'nonexistent_tool', arguments: {} },
      }),
    });
    const body = await res.json();
    assert.ok(body.error);
    assert.equal(body.error.code, -32601);
    assert.ok(body.error.message.includes('Unknown tool'));
  });

  it('returns error for invalid JSON-RPC envelope', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({ not: 'rpc' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
    assert.equal(body.error.code, -32600);
  });

  it('includes envelope code in error responses', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 34, method: 'tools/call',
        params: { name: 'get_product', arguments: { id: 'missing' } },
      }),
    });
    const body = await res.json();
    assert.ok(body.error);
    assert.ok(body.error.data);
    assert.ok(body.error.data.envelope);
    assert.ok(body.error.data.envelope.error);
    assert.ok(body.error.data.envelope.error.code);
  });

  // BUY-74597: an upstream DB error must NOT produce an unqualified JSON-RPC
  // error envelope. The degraded contract says the tool returns a 200-OK
  // MCP envelope with `meta.status="degraded"` and `meta.degraded=true`. Agents
  // branch on `meta.degraded === true`.
  //
  // BUY-79642: when the catalog throws but REST has hits, those REST products
  // are served (not empty). The envelope still carries degraded=true so agents
  // know the catalog path failed. In the test environment REST succeeds with mock
  // rows, so the test checks for degraded=true + status=degraded on a non-empty
  // response. A DB-error test where REST also fails (returns empty) would need
  // the full degraded metadata triplet (confidence/emptiness_reason/diagnostic).
  it('handles DB error gracefully', async () => {
    queryMock.mock.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('api_keys')) {
        return Promise.resolve({ rows: [{ id: 'test-k', key_hash: 'x', name: 'test', tier: 'free', signup_channel: null, attribution_source: null, is_active: true }] });
      }
      if (typeof sql === 'string' && (sql.includes('last_used_at') || sql.includes('query_log'))) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.reject(new Error('DB connection failed'));
    });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 35, method: 'tools/call',
        params: { name: 'search_products', arguments: { q: 'laptop' } },
      }),
    });
    const body = await res.json();
    // Spec §4: no tool may return an unqualified empty result when the cause
    // is upstream exception / timeout / auth / circuit breaker. The MCP layer
    // must translate the DB failure into a canonical degraded envelope (200-OK).
    assert.equal(body.error, undefined, 'JSON-RPC error envelope must NOT be returned on upstream DB failure');
    assert.ok(body.result, 'JSON-RPC result envelope must be present');
    const content = JSON.parse(body.result.content[0].text);
    // BUY-74597: degraded flag is the primary signal agents branch on.
    assert.equal(content.meta.degraded, true, 'meta.degraded must be true on upstream DB failure');
    assert.equal(content.meta.status, 'degraded', 'meta.status must be "degraded"');
    // BUY-79642: when REST fills the gap, products are served. In CI the
    // fallback hits live api.buywhere.ai with the test Bearer and gets 401
    // (BUY-80191 CI), so the envelope is empty + api_error — still valid.
    const n = (content.products || content.data || []).length;
    if (n === 0) {
      assert.equal(content.meta.emptiness_reason, 'api_error',
        'empty degraded envelope must classify catalog+REST failure as api_error');
    }
  });

  it('preserves request id in error responses', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'req-xyz-789', method: 'tools/call',
        params: { name: 'unknown_tool', arguments: {} },
      }),
    });
    const body = await res.json();
    assert.equal(body.id, 'req-xyz-789');
  });
});

describe('MCP JSON-RPC — caching behavior', () => {
  it('returns cached search results with cached=true', async () => {
    const cachedResponse = {
      results: [makeProduct('cached-1', { title: 'Cached Item', price: 42 })],
      total: 1, page: { limit: 20, offset: 0 },
      response_time_ms: 3, cached: false,
    };
    redisGetMock.mock.mockImplementation((key) => {
      if (typeof key === 'string' && key.startsWith('fts:') && key.includes(':cached:')) {
        return Promise.resolve(JSON.stringify(cachedResponse));
      }
      return Promise.resolve(null);
    });

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 40, method: 'tools/call',
        params: { name: 'search_products', arguments: { q: 'cached' } },
      }),
    });
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.equal(data.cached, true);
    assert.equal(data.results[0].title, 'Cached Item');
  });

  it('caches deals results after DB query', async () => {
    await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 41, method: 'tools/call',
        params: { name: 'get_deals', arguments: { min_discount: 10 } },
      }),
    });

    const cacheSetCalls = redisSetMock.mock.calls.filter(
      c => typeof c.arguments[0] === 'string' && c.arguments[0].includes('deals_mcp:')
    );
    assert.ok(cacheSetCalls.length >= 1, 'Expected deals cache set');
  });
});

describe('MCP JSON-RPC — protocol compliance', () => {
  it('null id in envelope returns null id in response', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: null, method: 'initialize' }),
    });
    const body = await res.json();
    assert.equal(body.id, null);
  });

  it('numeric id preserved in response', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'initialize' }),
    });
    const body = await res.json();
    assert.equal(body.id, 42);
  });

  it('string id preserved in response', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'abc-123', method: 'initialize' }),
    });
    const body = await res.json();
    assert.equal(body.id, 'abc-123');
  });

  it('tools/list search_products has required input fields', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 50, method: 'tools/list' }),
    });
    const body = await res.json();
    const searchTool = body.result.tools.find(t => t.name === 'search_products');
    assert.ok(searchTool);
    const props = searchTool.inputSchema.properties;
    assert.ok(props.q);
    assert.ok(props.domain);
    assert.ok(props.country_code);
    assert.ok(props.min_price);
    assert.ok(props.max_price);
    assert.ok(props.limit);
    assert.ok(props.offset);
    assert.ok(props.compact);
  });

  it('search_products respects limit cap at 100', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 51, method: 'tools/call',
        params: { name: 'search_products', arguments: { q: 'test', limit: 999 } },
      }),
    });
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    assert.equal(data.meta.limit, 100);
  });

  // BUY-75287: `query` alias for `q` must return real results, not the
  // reltuples-derived "total" (~364,777,600) with 0 rows. Atlas cycle 23
  // called search_products with `query` and the API silently fell into the
  // no-q browse branch, looking like fabricated cache data.
  // Note: uses SG (has FTS child-table hits) not TH — BUY-79642 introduced
  // REST fallback for SEA markets with empty FTS, and TH has no REST hits in
  // the test environment (would return 0 before reaching the FTS assertion).
  it('search_products accepts `query` alias for `q` (BUY-75287)', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 33, method: 'tools/call',
        params: { name: 'search_products', arguments: { query: 'running shoes', country_code: 'SG', limit: 5 } },
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.result, `expected result envelope, got: ${JSON.stringify(body).slice(0, 400)}`);
    const data = JSON.parse(body.result.content[0].text);
    // Mock fixture returns 2 products with count '2'. The alias must run the
    // FTS path, NOT the no-q browse branch.
    assert.ok(Array.isArray(data.data), `expected data array, got: ${JSON.stringify(data).slice(0, 400)}`);
    assert.equal(data.data.length, 2, `expected 2 results from FTS, got ${data.data.length} — likely fell into no-q browse branch`);
    assert.notEqual(data.meta.total, 364777600, 'relruples-derived "fabricated" total must not leak');
    assert.ok(data.meta.total <= 1001, `total must be capped (LIMIT 1001), got ${data.meta.total}`);
  });
});
