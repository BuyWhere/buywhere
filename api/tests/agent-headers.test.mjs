import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { withAgentHeaders, _internals } = require('../dist/middleware/agentHeaders');

const {
  PROTOCOL,
  AGENT_CARD_URL,
  LLMS_TXT_URL,
  AGENT_INDEX_URL,
  AGENT_AUTH_VALUE,
  ALL_FIVE_EXPOSE,
} = _internals;

// BUY-71736: P2.3 — agent-discovery HTTP headers on api.buywhere.ai.
// Mounts withAgentHeaders on a synthetic Express app and verifies the
// five X-Agent-* headers (plus Access-Control-Expose-Headers) appear
// under the expected conditions.

function buildApp(opts = {}) {
  const app = express();
  app.use(withAgentHeaders);
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/v1/products', (_req, res) => {
    res.status(opts.productsStatus || 200).json({ items: [] });
  });
  app.get('/v1/products/search', (_req, res) => res.json({ items: [] }));
  app.get('/v1/products/:id', (_req, res) => res.json({ id: 'x' }));
  app.get('/v1/compare', (_req, res) => res.json({ items: [] }));
  app.get('/v1/search', (_req, res) => res.json({ items: [] }));
  app.get('/llms.txt', (_req, res) => res.type('text/plain').send('hi'));
  app.get('/.well-known/agent.json', (_req, res) =>
    res.json({ card: 'signed', signature: 'sig-bytes' }),
  );
  app.get('/v1/keys', (_req, res) => {
    res.status(opts.keysStatus || 401).json({ error: 'unauthorized' });
  });
  app.get('/v1/admin/x', (_req, res) => {
    res.status(403).json({ error: 'forbidden' });
  });
  return app;
}

let server;
let port;

before(async () => {
  server = http.createServer(buildApp());
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});

after(() => server?.close());

function lower(headers) {
  const out = {};
  for (const [k, v] of headers.entries()) out[k.toLowerCase()] = v;
  return out;
}

async function get(path) {
  const res = await fetch(`http://localhost:${port}${path}`);
  const body = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* not JSON */ }
  return { status: res.status, headers: lower(res.headers), body, parsed };
}

describe('withAgentHeaders — constants on every response', () => {
  it('emits X-Agent-Protocol, X-Agent-Card, X-LLMs-Txt on /health', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-agent-protocol'], PROTOCOL);
    assert.equal(res.headers['x-agent-card'], AGENT_CARD_URL);
    assert.equal(res.headers['x-llms-txt'], LLMS_TXT_URL);
  });

  it('emits all five in Access-Control-Expose-Headers', async () => {
    const res = await get('/health');
    const expose = (res.headers['access-control-expose-headers'] || '').toLowerCase();
    for (const h of ALL_FIVE_EXPOSE.split(',').map((s) => s.trim().toLowerCase())) {
      assert.ok(expose.includes(h), `expected expose list to include ${h}, got: ${expose}`);
    }
  });
});

describe('withAgentHeaders — X-Agent-Index on 200 catalog routes', () => {
  it('sets X-Agent-Index on /v1/products (200)', async () => {
    const res = await get('/v1/products?q=laptop');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-agent-index'], AGENT_INDEX_URL);
  });

  it('sets X-Agent-Index on /v1/products/search (200)', async () => {
    const res = await get('/v1/products/search?q=laptop');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-agent-index'], AGENT_INDEX_URL);
  });

  it('sets X-Agent-Index on /v1/products/:id (200)', async () => {
    const res = await get('/v1/products/abc-123');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-agent-index'], AGENT_INDEX_URL);
  });

  it('sets X-Agent-Index on /v1/compare (200)', async () => {
    const res = await get('/v1/compare');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-agent-index'], AGENT_INDEX_URL);
  });

  it('sets X-Agent-Index on /v1/search (200)', async () => {
    const res = await get('/v1/search');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-agent-index'], AGENT_INDEX_URL);
  });

  it('does NOT set X-Agent-Index on /.well-known/agent.json', async () => {
    const res = await get('/.well-known/agent.json');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-agent-index'], undefined);
    // but constants are still there
    assert.equal(res.headers['x-agent-protocol'], PROTOCOL);
    // and body is intact (JWS-signature-safe)
    assert.deepEqual(res.parsed, { card: 'signed', signature: 'sig-bytes' });
  });

  it('does NOT set X-Agent-Index on /llms.txt', async () => {
    const res = await get('/llms.txt');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-agent-index'], undefined);
    assert.equal(res.body, 'hi');
  });

  it('does NOT set X-Agent-Index on /health (non-catalog)', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-agent-index'], undefined);
  });
});

describe('withAgentHeaders — X-Agent-Auth on 401/403', () => {
  it('sets X-Agent-Auth on 401', async () => {
    const res = await get('/v1/keys');
    assert.equal(res.status, 401);
    assert.equal(res.headers['x-agent-auth'], AGENT_AUTH_VALUE);
  });

  it('sets X-Agent-Auth on 403', async () => {
    const res = await get('/v1/admin/x');
    assert.equal(res.status, 403);
    assert.equal(res.headers['x-agent-auth'], AGENT_AUTH_VALUE);
  });

  it('does NOT set X-Agent-Auth on 200', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-agent-auth'], undefined);
  });
});

describe('withAgentHeaders — body integrity', () => {
  it('does not modify /v1/products response body (catalog)', async () => {
    const expected = { items: [{ id: 1 }] };
    const app = express();
    app.use(withAgentHeaders);
    app.get('/v1/products', (_req, res) => res.json(expected));
    const s = http.createServer(app);
    await new Promise((r) => s.listen(0, r));
    try {
      const p = s.address().port;
      const res = await fetch(`http://localhost:${p}/v1/products`);
      const body = await res.json();
      assert.deepEqual(body, expected);
    } finally {
      s.close();
    }
  });
});