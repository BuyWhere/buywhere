// BUY-75313: keyless GET path at anonymous self-serve limits.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

process.env.BUYWHERE_INTERNAL_API_KEY = process.env.BUYWHERE_INTERNAL_API_KEY || 'ssr-test-secret-XYZ-12345-abcdef';

const config = require('../dist/config.js');
const redisStore = new Map();
config.redis.incr = async (key) => {
  const n = (redisStore.get(key) || 0) + 1;
  redisStore.set(key, n);
  return n;
};
config.redis.expire = async () => 1;
config.redis.get = async () => null;
config.db.query = async (sql) => {
  if (typeof sql === 'string' && sql.includes('FROM api_keys')) {
    return { rows: [{
      id: 'keyed-1',
      key_hash: 'abc',
      name: 'keyed',
      tier: 'free',
      signup_channel: 'test',
      attribution_source: 'test',
      is_active: true,
      is_internal: false,
      daily_request_count: 0,
      daily_reset_at: new Date(Date.now() + 86400000),
      weekly_request_count: 0,
      weekly_reset_at: new Date(Date.now() + 7 * 86400000),
      created_at: new Date(),
      rpm_limit: 10,
      daily_limit: 10000,
      failed_request_count: 0,
    }] };
  }
  return { rows: [] };
};

const { allowAnonymous, requireApiKey, checkRateLimit } = require('../dist/middleware/apiKey.js');
const { TIER_LIMITS } = require('../dist/config.js');

function request(app, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close();
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(raw); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, json, raw });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

describe('BUY-75313 keyless read path', () => {
  it('exposes anonymous tier at 60 rpm / 1000 daily', () => {
    assert.equal(TIER_LIMITS.anonymous.rpm, 60);
    assert.equal(TIER_LIMITS.anonymous.daily, 1000);
  });

  it('anonymous GET 200 with rate-limit headers', async () => {
    redisStore.clear();
    const app = express();
    app.get('/v1/products/search', allowAnonymous, checkRateLimit, (req, res) => {
      assert.equal(req.apiKeyRecord.tier, 'anonymous');
      assert.match(req.apiKeyRecord.id, /^anon:[0-9a-f]{32}$/);
      res.json({ ok: true, products: [1,2,3,4,5,6] });
    });
    const r = await request(app, { path: '/v1/products/search?q=airpods' });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.ok(r.headers['x-ratelimit-limit']);
    assert.ok(r.headers['x-ratelimit-limit-day']);
  });

  it('anonymous POST still 401 with register recipe', async () => {
    const app = express();
    app.post('/v1/products/ingest', requireApiKey, (_req, res) => res.json({ ok: true }));
    const r = await request(app, { method: 'POST', path: '/v1/products/ingest' });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'missing_api_key');
    assert.equal(r.json.register.method, 'POST');
  });

  it('over-quota 429 includes register hint', async () => {
    redisStore.clear();
    const app = express();
    app.get('/v1/products/search', allowAnonymous, (req, res) => res.json({ ok: true }));
    const first = await request(app, { path: '/v1/products/search' });
    assert.equal(first.status, 200);
    for (const k of redisStore.keys()) {
      if (String(k).includes('rl:anon:daily:')) redisStore.set(k, 1000);
    }
    const r = await request(app, { path: '/v1/products/search' });
    assert.equal(r.status, 429);
    assert.equal(r.json.tier, 'anonymous');
    const hint = r.json.hint?.register_for_10x || r.json.register;
    assert.equal(hint.method, 'POST');
    assert.match(hint.url, /auth\/register\?verify=false/);
  });

  it('BUY-80256: PROBE_IPS skip anonymous daily cap', async () => {
    redisStore.clear();
    process.env.PROBE_IPS = '203.0.113.9';
    const app = express();
    app.set('trust proxy', true);
    app.get('/v1/products/search', allowAnonymous, (req, res) => res.json({ ok: true, internal: req.apiKeyRecord.isInternal }));
    for (const k of ['a']) {
      void k;
    }
    // seed daily at cap then request from probe IP
    const first = await request(app, { path: '/v1/products/search', headers: { 'X-Forwarded-For': '203.0.113.9' } });
    assert.equal(first.status, 200);
    for (const k of redisStore.keys()) {
      if (String(k).includes('rl:anon:daily:')) redisStore.set(k, 9999);
    }
    const r = await request(app, { path: '/v1/products/search', headers: { 'X-Forwarded-For': '203.0.113.9' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    delete process.env.PROBE_IPS;
  });

  it('keyed request is unaffected (still requireApiKey path)', async () => {
    redisStore.clear();
    const app = express();
    app.get('/v1/products/search', allowAnonymous, checkRateLimit, (req, res) => {
      res.json({ tier: req.apiKeyRecord.tier, id: req.apiKeyRecord.id });
    });
    const bad = await request(app, {
      path: '/v1/products/search',
      headers: { Authorization: 'Bearer definitely-not-a-key' },
    });
    assert.equal(bad.status, 401);
  });
});
