// BUY-60548: regression test for /r/:slug/:productId redirect.
// Verifies the handler resolves the real merchant URL from the products table
// when no affiliate_links row exists (the 'direct' fallback slug), instead of
// silently 302-ing to the homepage (FALLBACK_URL).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// --- Mock the db pool and analytics before loading the router. ---
// Capture queries so each test can script the rows the "DB" returns.
let queryHandler = () => ({ rows: [] });

const fakeDb = {
  query: (...args) => {
    // support both (text, params) and (configObj)
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text ?? '';
    return Promise.resolve(queryHandler(text, args));
  },
  on: () => {},
};

const Module = require('module');
const origResolve = Module._resolveFilename;
const origLoad = Module._load;

Module._resolveFilename = function (req, ...rest) {
  return origResolve.call(this, req, ...rest);
};

Module._load = function (request, parent, isMain) {
  if (request === '../config') return { db: fakeDb };
  if (request === '../analytics/posthog') return { trackAffiliateClick: () => {} };
  return origLoad.apply(this, arguments);
};

const router = require('../dist/routes/redirect').default;

// Minimal Express-ish request/response doubles.
function makeReq({ slug, productId, headers = {}, query = {} }) {
  return {
    params: { affiliateSlug: slug, productId },
    headers,
    query,
    get: () => undefined,
  };
}

function makeRes() {
  const res = {
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
  return res;
}

async function dispatch(req, res) {
  // The express Router stores GET handlers on router.stack. Find the matching
  // route for /:affiliateSlug/:productId and invoke its handler.
  const layer = router.stack.find((l) => l.route && l.route.path === '/:affiliateSlug/:productId');
  assert.ok(layer, 'route /:affiliateSlug/:productId registered');
  // pick the GET handler
  const handle = layer.route.stack.find((h) => h.method === 'get').handle;
  return handle(req, res);
}

describe('BUY-60548 /r/:slug/:productId redirect', () => {
  after(() => {
    Module._load = origLoad;
  });

  it('redirects to the product merchant URL when no affiliate_links row exists', async () => {
    // affiliate_links lookup returns no rows; products lookup returns the merchant url.
    queryHandler = (text) => {
      if (text.includes('FROM affiliate_links')) return { rows: [] };
      if (text.includes('FROM products')) {
        return {
          rows: [{ url: 'https://www.amazon.sg/dp/B0D1VY9GH3', merchant_id: 'amazon_sg' }],
        };
      }
      return { rows: [] };
    };

    const req = makeReq({
      slug: 'direct',
      productId: '56308327',
      query: { source: 'product_card' },
    });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://www.amazon.sg/dp/B0D1VY9GH3');
    assert.notEqual(res.redirectedTo, 'https://buywhere.ai', 'must not fall back to homepage');
  });

  it('routes the confirmed broken BUY-65154 Compumarts destination to graceful BuyWhere alternatives', async () => {
    const brokenUrl = 'https://compumarts.com/products/asus-rog-strix-g16-g614pw-ts161w-ryzen-9-8940hx-rtx-5080-16gb-gddr7-1tb-pcie-4-0-nvme-ssd-16-inch-2-5k-300hz-gaming-laptop';
    queryHandler = (text) => {
      if (text.includes('FROM affiliate_links')) return { rows: [] };
      if (text.includes('FROM products')) {
        return { rows: [{ url: brokenUrl, merchant_id: 'shopify_scrape' }] };
      }
      return { rows: [] };
    };

    const req = makeReq({ slug: 'direct', productId: '678974890', query: { source: 'product_card' } });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(
      res.redirectedTo,
      'https://buywhere.ai/search?q=ASUS%20ROG%20Strix%20G16%20G614PW'
    );
    assert.notEqual(res.redirectedTo, brokenUrl);
  });

  it('rotates the same broken URL when it comes from affiliate_links', async () => {
    const brokenUrl = 'https://compumarts.com/products/asus-rog-strix-g16-g614pw-ts161w-ryzen-9-8940hx-rtx-5080-16gb-gddr7-1tb-pcie-4-0-nvme-ssd-16-inch-2-5k-300hz-gaming-laptop';
    queryHandler = (text) => {
      if (text.includes('FROM affiliate_links')) {
        return {
          rows: [{
            id: 'link-broken',
            merchant_id: 'shopify_scrape',
            affiliate_url: brokenUrl,
            destination_url: brokenUrl,
          }],
        };
      }
      return { rows: [] };
    };

    const req = makeReq({ slug: 'direct', productId: '678974890', query: { source: 'product_card' } });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(
      res.redirectedTo,
      'https://buywhere.ai/search?q=ASUS%20ROG%20Strix%20G16%20G614PW'
    );
  });

  it('falls back to the product URL even if the affiliate_links query errors', async () => {
    // Simulate the original bug: affiliate_links query throws (e.g. bad column),
    // but the product fallback must still resolve the destination.
    queryHandler = (text) => {
      if (text.includes('FROM affiliate_links')) {
        throw new Error('column "platform" does not exist');
      }
      if (text.includes('FROM products')) {
        return {
          rows: [{ url: 'https://shopee.sg/product/xyz', merchant_id: 'shopee_sg' }],
        };
      }
      return { rows: [] };
    };

    const req = makeReq({ slug: 'direct', productId: '999', query: {} });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://shopee.sg/product/xyz');
  });

  it('uses the affiliate_links destination_url when a link exists', async () => {
    queryHandler = (text) => {
      if (text.includes('FROM affiliate_links')) {
        return {
          rows: [{
            id: 'link-1',
            merchant_id: 'lazada_sg',
            destination_url: 'https://lazada.sg/aff?id=123',
          }],
        };
      }
      return { rows: [] };
    };

    const req = makeReq({ slug: 'lazada_sg', productId: '42', query: { source: 'product_card' } });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://lazada.sg/aff?id=123');
  });

  it('redirects to FALLBACK_URL only when neither link nor product exists', async () => {
    queryHandler = () => ({ rows: [] });

    const req = makeReq({ slug: 'direct', productId: 'does-not-exist', query: {} });
    const res = makeRes();

    await dispatch(req, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://buywhere.ai');
  });
});
