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

describe('public developer discovery routes', () => {
  it('GET /developers/sitemap-index.xml returns public sitemap XML', async () => {
    const res = await fetch(`http://localhost:${port}/developers/sitemap-index.xml`);
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/xml/i);
    assert.match(body, /<sitemapindex/);
    assert.match(body, /\/developers\/sitemap\.xml/);
    assert.doesNotMatch(body, /UNAUTHORIZED|Missing Authorization/i);
  });

  it('keeps adjacent developer discovery routes public', async () => {
    const routes = [
      ['/developers', /# BuyWhere Developer Portal/],
      ['/developers/robots.txt', /User-agent: \*/],
      ['/developers/sitemap.xml', /<urlset/],
    ];

    for (const [path, bodyPattern] of routes) {
      const res = await fetch(`http://localhost:${port}${path}`);
      const body = await res.text();

      assert.equal(res.status, 200, path);
      assert.match(body, bodyPattern, path);
      assert.doesNotMatch(body, /UNAUTHORIZED|Missing Authorization/i, path);
    }
  });
});
