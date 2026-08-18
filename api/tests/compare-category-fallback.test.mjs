import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('../dist/config');

config.redis.get = async () => null;
config.redis.setex = async () => 'OK';
config.redis.on = () => {};
config.redis.disconnect = () => {};
config.db.end = () => {};

let server;
let port;

before(async () => {
  config.db.query = async (sql, params) => {
    if (String(sql).includes('FROM comparison_pages')) {
      assert.deepEqual(params, ['electronics']);
      return { rows: [] };
    }
    if (String(sql).includes('SELECT DISTINCT category_path[1]')) {
      return { rows: [] };
    }
    if (String(sql).includes('FROM products')) {
      return { rows: [] };
    }
    return { rows: [] };
  };

  const { createApp } = require('../dist/server');
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

describe('compare category fallback', () => {
  it('GET /v1/compare/electronics returns an empty category payload instead of 404', async () => {
    const res = await fetch(`http://localhost:${port}/v1/compare/electronics?region=sea&country=SG`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-cache'), 'CATEGORY-FALLBACK');
    assert.equal(body.slug, 'electronics');
    assert.equal(body.category, 'Electronics');
    assert.deepEqual(body.products, []);
    assert.deepEqual(body.meta, { limit: 50, offset: 0, total: 0 });
  });

  it('GET /v1/compare/not-a-category still returns 404', async () => {
    const res = await fetch(`http://localhost:${port}/v1/compare/not-a-category?region=sea&country=SG`);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.error, 'Not found');
  });
});
