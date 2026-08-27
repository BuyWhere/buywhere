// BUY-75368: integration test for /v1/admin/probes/status probeAuth().
//
// Asserts:
//   - 401 with no auth header (preserves existing behaviour)
//   - 401 with garbage token
//   - 200 with MONITORING_API_KEY (NEW — Cart's monitoring tier)
//   - 200 with BUYWHERE_ADMIN_API_KEYS (legacy admin tier)
//   - 200 response carries 7-day buckets for A1 dead-redirect calc
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Configure BEFORE requiring the router. We give the test both tiers:
//   admin: BUYWHERE_ADMIN_API_KEYS=admin-key-123
//   monitoring: MONITORING_API_KEY=mon-key-456
process.env.BUYWHERE_ADMIN_API_KEYS = 'admin-key-123';
process.env.MONITORING_API_KEY = 'mon-key-456';

const config = require('../dist/config');
// Stub DB so the handler returns predictable data.
config.db.query = async (sql) => {
  if (sql.includes('COALESCE(url_status')) {
    return { rows: [{ status: 'ok', count: '100' }, { status: 'redirect', count: '5' }] };
  }
  // 24h due bucket (legacy, contains stale_24h but NOT stale_7d).
  if (sql.includes('never_checked') && sql.includes("'24 hours'") && !sql.includes("'7 days'")) {
    return { rows: [{ never_checked: '40', stale_24h: '5', fresh_24h: '55' }] };
  }
  // 7-day due bucket (NEW).
  if (sql.includes('stale_7d')) {
    return { rows: [{ never_checked: '40', stale_7d: '10', fresh_24h: '55', fresh_7d: '60' }] };
  }
  if (sql.includes('url_probe_log')) {
    return { rows: [{ status: 'ok', count: '200' }, { status: 'redirect', count: '15' }] };
  }
  return { rows: [] };
};
config.db.connect = async () => ({ query: config.db.query, release: () => {} });
config.db.end = () => {};
config.redis.set = async () => 'OK';
config.redis.get = async () => null;
config.redis.disconnect = () => {};
config.redis.on = () => {};

const probesRouter = require('../dist/routes/admin/probes').default;

const app = express();
app.use(probesRouter);

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
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET', headers },
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

describe('BUY-75368: /v1/admin/probes/status probeAuth()', () => {
  it('rejects requests with no Authorization header (401)', async () => {
    const res = await get('/v1/admin/probes/status');
    assert.equal(res.status, 401);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'UNAUTHORIZED');
  });

  it('rejects requests with an invalid bearer token (401)', async () => {
    const res = await get('/v1/admin/probes/status', { Authorization: 'Bearer wrong-key' });
    assert.equal(res.status, 401);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'UNAUTHORIZED');
  });

  it('accepts BUYWHERE_ADMIN_API_KEYS (legacy admin tier)', async () => {
    const res = await get('/v1/admin/probes/status', {
      Authorization: 'Bearer admin-key-123',
    });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.probe_enabled !== undefined);
  });

  it('accepts MONITORING_API_KEY (NEW — Cart monitoring tier)', async () => {
    const res = await get('/v1/admin/probes/status', {
      Authorization: 'Bearer mon-key-456',
    });
    assert.equal(res.status, 200, 'monitoring tier must be accepted');
    const body = JSON.parse(res.body);
    assert.ok(body.probe_enabled !== undefined);
  });

  it('response includes 7-day buckets for A1 dead-redirect calc', async () => {
    const res = await get('/v1/admin/probes/status', {
      Authorization: 'Bearer mon-key-456',
    });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    // due_7d is the new 7-day staleness distribution.
    assert.ok(body.due_7d, 'response must include due_7d; got body: ' + res.body);
    assert.ok('stale_7d' in body.due_7d, `due_7d must include stale_7d; got: ${JSON.stringify(body.due_7d)}`);
    assert.ok('fresh_7d' in body.due_7d, `due_7d must include fresh_7d; got: ${JSON.stringify(body.due_7d)}`);
    assert.ok('fresh_24h' in body.due_7d, `due_7d must include fresh_24h; got: ${JSON.stringify(body.due_7d)}`);
    // probes_last_7d is the new 7-day probe log bucket.
    assert.ok(body.probes_last_7d, `response must include probes_last_7d; got body: ${res.body}`);
  });
});
