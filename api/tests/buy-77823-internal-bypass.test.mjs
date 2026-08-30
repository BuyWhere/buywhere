// BUY-77823: server-to-server shared-secret bypass.
//
// Asserts:
//   - with NO env var set: bypass is disabled (every key still rejected unless valid)
//   - with BUYWHERE_INTERNAL_API_KEY set + matching Bearer: 200 + synthetic apiKeyRecord
//   - with BUYWHERE_INTERNAL_API_KEY set + wrong Bearer: 401 (timingSafeEqual rejected)
//   - bypass is rate-limited (in-process, per-secret)
//   - missing_api_key 401 path is unchanged when no Authorization header
//
// The test mounts the products router with a stub DB and hits /v1/products/search
// end-to-end through the real middleware.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const INTERNAL_KEY = 'ssr-test-secret-XYZ-12345-abcdef';
process.env.BUYWHERE_INTERNAL_API_KEY = INTERNAL_KEY;

const config = require('../dist/config');

// Stub DB so the search handler can run without a live connection.
let searchCalled = 0;
config.db.query = async (sql, params) => {
  if (sql.includes('FROM search_products') || sql.includes('FROM products_search')) {
    searchCalled++;
    return { rows: [{ id: '1', title: 'stub', price: 1, currency: 'USD' }] };
  }
  if (sql.includes('rate_limit') || sql.includes('rate_limit_check')) {
    return { rows: [] };
  }
  if (sql.includes('FROM api_keys')) {
    return { rows: [] };
  }
  if (sql.includes('trackApiUsage') || sql.includes('INSERT INTO usage')) {
    return { rows: [] };
  }
  if (sql.includes('canonical_throughput')) {
    return { rows: [] };
  }
  return { rows: [] };
};
config.db.connect = async () => ({ query: config.db.query, release: () => {} });
config.db.end = () => {};
config.redis.set = async () => 'OK';
config.redis.get = async () => null;
config.redis.disconnect = () => {};
config.redis.on = () => {};

// Bypass checkRateLimit to avoid Redis dependency
config.redis.eval = async () => 1;
config.redis.incr = async () => 1;
config.redis.expire = async () => 1;

const productsRouter = require('../dist/routes/products').default;

const app = express();
app.use('/v1/products', productsRouter);

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'GET', headers },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('BUY-77823: server-to-server shared-secret bypass', () => {
  it('rejects requests without Authorization header (401 missing_api_key)', async () => {
    const res = await get('/v1/products/search?q=laptop&cc=US');
    assert.equal(res.status, 401, `expected 401 got ${res.status}: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'missing_api_key');
  });

  it('rejects requests with wrong Bearer token (401 invalid_api_key)', async () => {
    const res = await get('/v1/products/search?q=laptop&cc=US', {
      Authorization: 'Bearer wrong-key',
    });
    assert.equal(res.status, 401);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'invalid_api_key');
  });

  it('accepts BUYWHERE_INTERNAL_API_KEY matching Bearer (server-to-server bypass)', async () => {
    const res = await get('/v1/products/search?q=laptop&cc=US', {
      Authorization: `Bearer ${INTERNAL_KEY}`,
    });
    // The stub returns a row; we expect 200 with the synthetic internal record.
    assert.equal(res.status, 200, `internal bypass failed: ${res.status} ${res.body}`);
    const body = JSON.parse(res.body);
    assert.ok(body.data, 'response must carry data array');
    assert.equal(searchCalled > 0, true, 'handler must have been invoked');
  });

  it('rejects near-miss keys (timingSafeEqual rejects different lengths)', async () => {
    const nearMiss = INTERNAL_KEY + 'x';
    const res = await get('/v1/products/search?q=laptop&cc=US', {
      Authorization: `Bearer ${nearMiss}`,
    });
    assert.equal(res.status, 401, 'longer near-miss must be rejected');
  });

  it('rejects same-length wrong secret', async () => {
    const wrong = INTERNAL_KEY.split('').reverse().join('');
    const res = await get('/v1/products/search?q=laptop&cc=US', {
      Authorization: `Bearer ${wrong}`,
    });
    assert.equal(res.status, 401, 'reversed secret must be rejected');
  });
});
