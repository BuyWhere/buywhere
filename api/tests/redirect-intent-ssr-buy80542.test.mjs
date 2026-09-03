// BUY-80542: /r/:query must SSR product cards (200) instead of 302 /search.
import { describe, it, after, before } from 'node:test';
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

function makeReq({ querySlug, query = {} } = {}) {
  return {
    params: { query: querySlug },
    headers: {},
    query,
    get: () => undefined,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    redirectedTo: null,
    body: null,
    contentType: null,
    headers: {},
    redirect(code, url) {
      if (url === undefined) { url = code; code = 302; }
      this.statusCode = code;
      this.redirectedTo = url;
      return this;
    },
    status(code) { this.statusCode = code; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    type(t) { this.contentType = t; return this; },
    send(body) { this.body = body; return this; },
  };
}

async function dispatch(req, res) {
  const layer = router.stack.find((l) => l.route && l.route.path === '/:query');
  assert.ok(layer, 'route /:query registered');
  const handle = layer.route.stack.find((h) => h.method === 'get').handle;
  return handle(req, res);
}

describe('BUY-80542 /r/:query intent SSR', () => {
  after(() => {
    Module._load = origLoad;
  });

  before(() => {
    queryHandler = (text) => {
      if (String(text).includes('products_partitioned_')) {
        return {
          rows: [{
            id: '42',
            title: 'Coffee maker 12-cup',
            price: '89.00',
            currency: 'SGD',
            image_url: null,
            domain: 'lazada.sg',
            url: 'https://www.lazada.sg/coffee',
          }],
        };
      }
      return { rows: [] };
    };
  });

  it('returns 200 HTML with a product card and /r/direct CTA (no 302 to /search)', async () => {
    const req = makeReq({ querySlug: 'coffee' });
    const res = makeRes();
    await dispatch(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.redirectedTo, null);
    assert.match(String(res.body), /product-card/);
    assert.match(String(res.body), /\/r\/direct\/42/);
    assert.doesNotMatch(String(res.body), /marketing search landing/i);
  });

  it('country=SG still returns 200 (does not 302)', async () => {
    const req = makeReq({ querySlug: 'headphones', query: { country: 'SG' } });
    const res = makeRes();
    await dispatch(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.redirectedTo, null);
  });

  it('unknown slug returns 404 empty-state, never 302 to /search', async () => {
    queryHandler = () => ({ rows: [] });
    const req = makeReq({ querySlug: 'zzzznonexistentslugxyz' });
    const res = makeRes();
    await dispatch(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.redirectedTo, null);
    assert.match(String(res.body), /empty-state/);
  });
});
