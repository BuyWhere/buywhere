import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('../../dist/config');

config.db.end = () => {};
config.redis.on = () => {};
config.redis.disconnect = () => {};

let server;
let port;

const mockRows = [
  {
    id: '550e8400-e29b-41d4-a716-446655440000',
    product_id: '10000000001',
    merchant_id: 'shopee_sg',
    url: 'https://shopee.sg/product/1',
    status: 'ok',
    reason: null,
    response_code: 200,
    checked_at: '2026-08-18T09:00:00.000Z',
    latency_ms: 234,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    product_id: '10000000002',
    merchant_id: 'lazada_sg',
    url: 'https://lazada.sg/product/2',
    status: 'dead',
    reason: 'timeout',
    response_code: null,
    checked_at: '2026-08-18T08:55:00.000Z',
    latency_ms: 5001,
  },
];

before(async () => {
  config.db.query = async (sql, params) => {
    const sqlText = String(sql);
    if (sqlText.includes('COUNT(*)')) {
      return { rows: [{ total: `${mockRows.length}` }] };
    }
    if (sqlText.includes('FROM url_probe_log')) {
      const limit = params?.[params.length - 2] ?? mockRows.length;
      const offset = params?.[params.length - 1] ?? 0;

      // Simple filtering simulation for test params (status/product_id/cursor).
      let filtered = [...mockRows];
      if (sqlText.includes('status = $')) {
        const statusParamIndex = (sqlText.match(/status = \$(\d+)/) || [])[1];
        if (statusParamIndex) {
          const statusValue = params[parseInt(statusParamIndex, 10) - 1];
          filtered = filtered.filter((r) => r.status === statusValue);
        }
      }
      if (sqlText.includes('product_id = $')) {
        const pidParamIndex = (sqlText.match(/product_id = \$(\d+)/) || [])[1];
        if (pidParamIndex) {
          const pidValue = params[parseInt(pidParamIndex, 10) - 1];
          filtered = filtered.filter((r) => r.product_id === pidValue);
        }
      }
      const cursorMatch = sqlText.match(/\(checked_at, id\) < \(\$(\d+), \$(\d+)\)/);
      if (cursorMatch) {
        const checkedAtParam = params[parseInt(cursorMatch[1], 10) - 1];
        const idParam = params[parseInt(cursorMatch[2], 10) - 1];
        filtered = filtered.filter(
          (r) => r.checked_at < checkedAtParam || (r.checked_at === checkedAtParam && r.id < idParam)
        );
      }

      return { rows: filtered.slice(offset, offset + limit) };
    }
    return { rows: [] };
  };

  const { createApp } = require('../../dist/server');
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  try { await config.db.end(); } catch {}
  try { config.redis.disconnect(); } catch {}
});

async function adminFetch(path) {
  return fetch(`http://localhost:${port}${path}`, {
    headers: { Authorization: 'Bearer test-admin-key' },
  });
}

describe('GET /v1/admin/probes/logs', () => {
  it('requires authorization', async () => {
    const res = await fetch(`http://localhost:${port}/v1/admin/probes/logs`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'UNAUTHORIZED');
  });

  it('returns paginated probe logs', async () => {
    const res = await adminFetch('/v1/admin/probes/logs?limit=2&offset=0');
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.ok(Array.isArray(body.data), 'data is an array');
    assert.equal(body.data.length, 2);
    assert.ok(body.pagination, 'pagination object present');
    assert.equal(body.pagination.limit, 2);
    assert.equal(body.pagination.offset, 0);
    assert.equal(body.pagination.total, 2);
    assert.equal(body.pagination.returned, 2);
    assert.ok(body.pagination.next_cursor);

    for (const row of body.data) {
      assert.ok('product_id' in row);
      assert.ok('url' in row);
      assert.ok('status' in row);
      assert.ok('checked_at' in row);
      assert.ok('response_code' in row);
    }
  });

  it('filters by status and product_id', async () => {
    const res = await adminFetch('/v1/admin/probes/logs?limit=1&status=ok&product_id=10000000001');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].status, 'ok');
    assert.equal(body.data[0].product_id, '10000000001');
  });

  it('supports cursor pagination', async () => {
    const first = await adminFetch('/v1/admin/probes/logs?limit=1').then((r) => r.json());
    assert.equal(first.data.length, 1);
    const cursor = first.pagination.next_cursor;
    assert.ok(cursor, 'next_cursor returned');

    const second = await adminFetch(`/v1/admin/probes/logs?limit=1&cursor=${encodeURIComponent(cursor)}`).then((r) => r.json());
    assert.ok(Array.isArray(second.data));
    assert.equal(second.data.length, 1);
    assert.notEqual(second.data[0].id, first.data[0].id);
  });

  it('honours the root /admin/probes/logs alias', async () => {
    const res = await adminFetch('/admin/probes/logs?limit=1');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
  });
});
