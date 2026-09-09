import assert from 'node:assert/strict';
import test from 'node:test';

import { BuyWhereClient, BuyWhereError, createClient } from '../dist/index.js';

test('SDK compare uses GET /v1/products/compare?ids=...', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      data: [
        { id: 'sku_123', title: 'A', price: { amount: 1, currency: 'SGD' }, merchant: 'm', url: 'u', image_url: null, region: 'sg', country_code: 'SG', updated_at: '2026-08-16T00:00:00Z', availability: { in_stock: true, status: 'in_stock' }, click_url: 'c' },
        { id: 'sku_456', title: 'B', price: { amount: 2, currency: 'SGD' }, merchant: 'm', url: 'u', image_url: null, region: 'sg', country_code: 'SG', updated_at: '2026-08-16T00:00:00Z', availability: { in_stock: true, status: 'in_stock' }, click_url: 'c' },
      ],
      meta: { total: 2, limit: 10, offset: 0, query_time_ms: 1 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = createClient('bw_live_test');
    assert.equal(typeof client.compare, 'function');

    await client.compare(['sku_123', 'sku_456']);
    assert.equal(calls[0].url, 'https://api.buywhere.ai/v1/products/compare?ids=sku_123%2Csku_456');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.body, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SDK compare rejects fewer than 2 ids with a clear error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called when ids < 2');
  };

  try {
    const client = createClient('bw_live_test');
    await assert.rejects(
      () => client.compare(['sku_123']),
      (err) => {
        assert.equal(err.name, 'BuyWhereError');
        assert.equal(err.statusCode, 400);
        assert.equal(err.errorCode, 'compare_ids_too_few');
        assert.match(err.message, /at least 2 product IDs/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SDK deals hits /v1/products/deals (not /v1/deals)', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      data: [],
      meta: { total: 0, limit: 2, offset: 0, query_time_ms: 1 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const sdk = createClient('bw_live_test');
    await sdk.deals.getDeals({ country: 'SG', limit: 2 });
    assert.equal(calls[0], 'https://api.buywhere.ai/v1/products/deals?country=SG&limit=2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SDK getDealsFeed throws a clear deprecation error (BUY-70605)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called by getDealsFeed');
  };

  try {
    const sdk = createClient('bw_live_test');
    await assert.rejects(
      () => sdk.deals.getDealsFeed({ country: 'SG' }),
      (err) => {
        assert.equal(err.name, 'BuyWhereError');
        assert.equal(err.statusCode, 410);
        assert.equal(err.errorCode, 'getDealsFeed_removed');
        assert.match(err.message, /client\.deals/);
        assert.match(err.message, /BUY-70605/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('priceHistory sends limit and since query params', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      product_id: 123,
      product_name: 'Test Product',
      country: 'US',
      currency: 'USD',
      period: '30d',
      price_history: [],
      lowest_price: 10,
      highest_price: 20,
      average_price: 15,
      lowest_price_date: '2026-04-01T00:00:00Z',
      highest_price_date: '2026-04-10T00:00:00Z',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = new BuyWhereClient('bw_live_test');
    await client.priceHistory('sku_123', {
      limit: 30,
      since: '2026-04-01T00:00:00Z',
    });
    assert.equal(
      requestedUrl,
      'https://api.buywhere.ai/v1/products/sku_123/price-history?limit=30&since=2026-04-01T00%3A00%3A00Z',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// BUY-70872: this previously asserted a mocked /v1/keys/{id}/rotate round-trip.
// api/src/routes/keys.ts only implements POST /v1/keys — the rotate route was never
// deployed, so the old test passed against a mock while 404ing in production.
test('rotateApiKey throws — /v1/keys/{id}/rotate was never deployed (BUY-70872)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called by rotateApiKey');
  };

  try {
    const client = createClient('bw_live_test');
    await assert.rejects(
      () => client.rotateApiKey(),
      (err) => {
        assert.equal(err.name, 'BuyWhereError');
        assert.equal(err.statusCode, 501);
        assert.equal(err.errorCode, 'rotateApiKey_unavailable');
        assert.match(err.message, /BUY-70872/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BuyWhereError exposes errorCode and requestId', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(JSON.stringify({
    error_code: 'rate_limit',
    message: 'Slow down',
    request_id: 'req_123',
  }), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const client = new BuyWhereClient('bw_live_test');
    await assert.rejects(
      () => client.compare(['sku_123', 'sku_456']),
      (error) => {
        assert.ok(error instanceof BuyWhereError);
        assert.equal(error.statusCode, 429);
        assert.equal(error.errorCode, 'rate_limit');
        assert.equal(error.requestId, 'req_123');
        assert.equal(error.message, 'Slow down');
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// BUY-70872: /v1/webhooks was never deployed. The SDK advertised a customer-facing
// subscription API but the server only has an internal relay at /webhooks.
test('webhooks client throws — /v1/webhooks was never deployed (BUY-70872)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called by webhooks');
  };

  try {
    const client = createClient('bw_live_test');
    await assert.rejects(
      () => client.webhooks.create('https://example.com/webhook', ['price_drop']),
      (err) => {
        assert.equal(err.name, 'BuyWhereError');
        assert.equal(err.statusCode, 501);
        assert.equal(err.errorCode, 'webhooks_unavailable');
        assert.match(err.message, /BUY-70872/);
        return true;
      }
    );
    await assert.rejects(
      () => client.webhooks.list(),
      (err) => err.errorCode === 'webhooks_unavailable'
    );
    await assert.rejects(
      () => client.webhooks.delete('wh_123'),
      (err) => err.errorCode === 'webhooks_unavailable'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// BUY-70872: /v1/products/{id}/alerts and /v1/products/{id}/reviews/summary were
// never deployed. These tests ensure the SDK fails fast instead of 404ing.
test('products client alerts/reviews throw — routes never deployed (BUY-70872)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for phantom product routes');
  };

  try {
    const client = createClient('bw_live_test');
    await assert.rejects(
      () => client.products.getAlerts({ product_id: 123 }),
      (err) => {
        assert.equal(err.statusCode, 501);
        assert.equal(err.errorCode, 'productAlerts_unavailable');
        assert.match(err.message, /BUY-70872/);
        return true;
      }
    );
    await assert.rejects(
      () => client.products.getReviewsSummary({ product_id: 123 }),
      (err) => {
        assert.equal(err.statusCode, 501);
        assert.equal(err.errorCode, 'reviewsSummary_unavailable');
        assert.match(err.message, /BUY-70872/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
