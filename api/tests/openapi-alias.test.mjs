import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('../dist/config');

config.db.end = () => {};
config.redis.on = () => {};
config.redis.disconnect = () => {};

let server;
let port;

before(async () => {
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

describe('openapi alias', () => {
  it('GET /openapi returns the public OpenAPI document', async () => {
    const res = await fetch(`http://localhost:${port}/openapi`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/json/i);
    assert.equal(body.openapi, '3.0.0');
    assert.equal(body.info?.title, 'BuyWhere Product Catalog API');
  });
});
