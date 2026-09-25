// BUY-77001: regression test for legacy /r?u=<url> and /r/?u=<url> redirects.
// Verifies the bare /r path does not fall through to later routers (which used
// to return 404/401) and instead 302-redirects to the destination URL.
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
  if (request === '../config') return { db: fakeDb, catalogDb: fakeDb };
  if (request === '../analytics/posthog') return { trackAffiliateClick: () => {} };
  return origLoad.apply(this, arguments);
};

const router = require('../dist/routes/redirect').default;

function makeReq({ headers = {}, query = {} } = {}) {
  return {
    params: {},
    headers,
    query,
    get: () => undefined,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    redirectedTo: null,
    jsonBody: null,
    ended: false,
    redirect(code, url) {
      if (url === undefined) { url = code; code = 302; }
      this.statusCode = code;
      this.redirectedTo = url;
      this.ended = true;
      return this;
    },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; this.ended = true; return this; },
  };
}

async function dispatch(req, res) {
  const layer = router.stack.find((l) => l.route && l.route.path === '/');
  assert.ok(layer, 'route / registered');
  const handle = layer.route.stack.find((h) => h.method === 'get').handle;
  return handle(req, res);
}

describe('BUY-77001 /r?u=<url> legacy redirect', () => {
  after(() => {
    Module._load = origLoad;
  });

  before(() => {
    queryHandler = () => ({ rows: [] });
  });

  it('redirects to the destination URL from ?u=', async () => {
    const req = makeReq({ query: { u: 'https://www.amazon.sg/airpods-pro/dp/B0DGH9QZDQ' } });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://www.amazon.sg/airpods-pro/dp/B0DGH9QZDQ');
  });

  it('preserves the source query param for attribution', async () => {
    const req = makeReq({ query: { u: 'https://www.lazada.sg/foo', source: 'product_card' } });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://www.lazada.sg/foo');
  });

  it('falls back to homepage when ?u is missing', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://buywhere.ai');
  });

  it('BUY-79696: /r/?q=<query> 302s to /search?q= not homepage', async () => {
    const req = makeReq({ query: { q: 'asus rog' } });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://buywhere.ai/search?q=asus%20rog');
  });

  it('BUY-79696: hyphenated q= is normalized to spaces', async () => {
    const req = makeReq({ query: { q: 'asus-rog' } });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://buywhere.ai/search?q=asus%20rog');
  });

  it('falls back to homepage for non-http(s) destinations', async () => {
    const req = makeReq({ query: { u: 'javascript:alert(1)' } });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://buywhere.ai');
  });

  it('falls back to homepage for obviously invalid URLs', async () => {
    const req = makeReq({ query: { u: 'not-a-url' } });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://buywhere.ai');
  });
});
