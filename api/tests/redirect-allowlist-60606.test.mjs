// BUY-60606 / BUY-60383: regression test for the affiliate redirect allowlist.
// Verifies that US/global merchant domains (country=us revenue path) pass the
// destination guard, subdomains of permitted roots are allowed, and unsafe
// destinations (javascript:, unknown lookalike hosts) are still rejected.
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

Module._load = function (request, parent, isMain) {
  if (request === '../config') return { db: fakeDb };
  if (request === '../analytics/posthog') return { trackAffiliateClick: () => {} };
  return origLoad.apply(this, arguments);
};

const router = require('../dist/routes/redirect').default;

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

async function dispatch(req, res) {
  const layer = router.stack.find((l) => l.route && l.route.path === '/:affiliateSlug/:productId');
  const handle = layer.route.stack.find((h) => h.method === 'get').handle;
  return handle(req, res);
}

// Helper: program the "DB" to return a single product with the given url.
function productWithUrl(url) {
  return (text) => {
    if (text.includes('FROM affiliate_links')) return { rows: [] };
    if (text.includes('FROM products')) return { rows: [{ url, merchant_id: 'test' }] };
    return { rows: [] };
  };
}

describe('BUY-60606 redirect allowlist — US/global revenue path', () => {
  after(() => { Module._load = origLoad; });

  it('allows amazon.com (country=us merchant)', async () => {
    queryHandler = productWithUrl('https://www.amazon.com/dp/B0D1VY9GH3');
    const res = makeRes();
    await dispatch(makeReq({ productId: '646476722422638173' }), res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://www.amazon.com/dp/B0D1VY9GH3');
  });

  it('allows bestbuy.com', async () => {
    queryHandler = productWithUrl('https://www.bestbuy.com/site/laptop/123');
    const res = makeRes();
    await dispatch(makeReq({}), res);
    assert.equal(res.statusCode, 302);
  });

  it('allows walmart.com', async () => {
    queryHandler = productWithUrl('https://www.walmart.com/ip/456');
    const res = makeRes();
    await dispatch(makeReq({}), res);
    assert.equal(res.statusCode, 302);
  });

  it('allows awstrack.me affiliate deeplink', async () => {
    queryHandler = productWithUrl('https://awstrack.me/xyz/abc');
    const res = makeRes();
    await dispatch(makeReq({}), res);
    assert.equal(res.statusCode, 302);
  });

  it('allows subdomain of permitted root (music.amazon.com)', async () => {
    queryHandler = productWithUrl('https://music.amazon.com/albums/123');
    const res = makeRes();
    await dispatch(makeReq({}), res);
    assert.equal(res.statusCode, 302);
  });

  it('still rejects unknown lookalike host', async () => {
    queryHandler = productWithUrl('https://arnazon.com/evil');
    const res = makeRes();
    await dispatch(makeReq({}), res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.jsonBody, { error: 'Destination not permitted' });
  });

  it('still rejects non-http javascript: destination', async () => {
    queryHandler = productWithUrl('javascript:alert(1)');
    const res = makeRes();
    await dispatch(makeReq({}), res);
    // new URL('javascript:...') throws in some runtimes; either way it must not 302
    assert.notEqual(res.statusCode, 302);
    assert.equal(res.redirectedTo, null);
  });
});
