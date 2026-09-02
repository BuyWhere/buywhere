// BUY-60606 / BUY-60383: regression test for the affiliate redirect guard.
// destinationUrl is resolved from our own DB (admin-curated), so the guard only
// blocks dangerous schemes (javascript:, data:). Any valid http(s) merchant URL
// is permitted. AFFILIATE_STRICT_ALLOWLIST=1 re-enables domain matching.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let queryHandler = () => ({ rows: [] });

const fakeDb = {
  query: (...args) => {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text ?? '';
    return Promise.resolve(queryHandler(text, args));
  },
  on: () => {},
};

const Module = require('module');
const origLoad = Module._load;

function loadRouter() {
  Module._load = function (request, parent, isMain) {
    if (request === '../config') return { db: fakeDb, catalogDb: fakeDb };
    if (request === '../analytics/posthog') return { trackAffiliateClick: () => {} };
    return origLoad.apply(this, arguments);
  };
  // Bust the require cache so env changes take effect.
  delete require.cache[require.resolve('../dist/routes/redirect')];
  return require('../dist/routes/redirect').default;
}

function makeReq({ slug = 'direct', productId = '1', query = {} }) {
  return { params: { affiliateSlug: slug, productId }, headers: {}, query, get: () => undefined };
}

function makeRes() {
  return {
    statusCode: 200, redirectedTo: null, jsonBody: null, ended: false,
    redirect(code, url) { if (url === undefined) { url = code; code = 302; } this.statusCode = code; this.redirectedTo = url; this.ended = true; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; this.ended = true; return this; },
  };
}

async function dispatch(router, req, res) {
  const layer = router.stack.find((l) => l.route && l.route.path === '/:affiliateSlug/:productId');
  const handle = layer.route.stack.find((h) => h.method === 'get').handle;
  return handle(req, res);
}

function productWithUrl(url) {
  return (text) => {
    if (text.includes('FROM affiliate_links')) return { rows: [] };
    if (text.includes('FROM products')) return { rows: [{ url, merchant_id: 'test' }] };
    return { rows: [] };
  };
}

describe('BUY-60606 redirect guard — trust DB-resolved destinations', () => {
  after(() => { Module._load = origLoad; });

  it('allows any https merchant URL (amazon.com)', async () => {
    const router = loadRouter();
    queryHandler = productWithUrl('https://www.amazon.com/dp/B0D1VY9GH3');
    const res = makeRes();
    await dispatch(router, makeReq({ productId: '646476722422638173' }), res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://www.amazon.com/dp/B0D1VY9GH3');
  });

  it('allows bestbuy.com', async () => {
    const router = loadRouter();
    queryHandler = productWithUrl('https://www.bestbuy.com/site/laptop/123');
    const res = makeRes();
    await dispatch(router, makeReq({}), res);
    assert.equal(res.statusCode, 302);
  });

  it('allows walmart.com', async () => {
    const router = loadRouter();
    queryHandler = productWithUrl('https://www.walmart.com/ip/456');
    const res = makeRes();
    await dispatch(router, makeReq({}), res);
    assert.equal(res.statusCode, 302);
  });

  it('allows awstrack.me affiliate deeplink', async () => {
    const router = loadRouter();
    queryHandler = productWithUrl('https://awstrack.me/xyz/abc');
    const res = makeRes();
    await dispatch(router, makeReq({}), res);
    assert.equal(res.statusCode, 302);
  });

  it('allows subdomain of merchant (music.amazon.com)', async () => {
    const router = loadRouter();
    queryHandler = productWithUrl('https://music.amazon.com/albums/123');
    const res = makeRes();
    await dispatch(router, makeReq({}), res);
    assert.equal(res.statusCode, 302);
  });

  it('allows arbitrary merchant not in any list (e.g. some-boutique-store.com)', async () => {
    const router = loadRouter();
    queryHandler = productWithUrl('https://some-boutique-store.com/products/42');
    const res = makeRes();
    await dispatch(router, makeReq({}), res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://some-boutique-store.com/products/42');
  });

  it('blocks javascript: scheme (open-redirect / XSS guard)', async () => {
    const router = loadRouter();
    queryHandler = productWithUrl('javascript:alert(1)');
    const res = makeRes();
    await dispatch(router, makeReq({}), res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.jsonBody, { error: 'Destination not permitted' });
  });

  it('blocks data: scheme', async () => {
    const router = loadRouter();
    queryHandler = productWithUrl('data:text/html,<script>alert(1)</script>');
    const res = makeRes();
    await dispatch(router, makeReq({}), res);
    assert.equal(res.statusCode, 403);
  });

  it('blocks malformed URL', async () => {
    const router = loadRouter();
    queryHandler = productWithUrl('not-a-url');
    const res = makeRes();
    await dispatch(router, makeReq({}), res);
    assert.equal(res.statusCode, 403);
  });
});
