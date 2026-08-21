import assert from 'node:assert/strict';
import test from 'node:test';

import { BuyWhereClient, BuyWhereError, createClient } from '../dist/index.js';

test('SDK compare is callable and posts product ids', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      products: [],
      meta: {
        total_products: 0,
        total_merchants: 0,
        last_updated: '2026-04-26T00:00:00Z',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = createClient('bw_live_test');
    assert.equal(typeof client.compare, 'function');

    await client.compare(['sku_123', 'sku_456']);
    assert.equal(calls[0].url, 'https://api.buywhere.ai/v1/products/compare');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      product_ids: ['sku_123', 'sku_456'],
    });
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

test('rotateApiKey resolves current key id and maps response fields', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));

    if (String(url).endsWith('/v1/auth/me')) {
      return new Response(JSON.stringify({
        key_id: 'key_123',
        tier: 'live',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      new_api_key: 'bw_live_rotated',
      old_key_expires_at: '2026-04-27T00:00:00Z',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = createClient('bw_live_test');
    const rotation = await client.rotateApiKey();
    assert.deepEqual(rotation, {
      newApiKey: 'bw_live_rotated',
      oldKeyExpiresAt: '2026-04-27T00:00:00Z',
    });
    assert.deepEqual(calls, [
      'https://api.buywhere.ai/v1/auth/me',
      'https://api.buywhere.ai/v1/keys/key_123/rotate',
    ]);
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

test('webhooks client can create, list, and delete', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });

    if ((init.method ?? 'GET') === 'POST') {
      return new Response(JSON.stringify({
        id: 'wh_123',
        url: 'https://example.com/webhook',
        product_ids: [],
        events: ['price_drop'],
        active: true,
        created_at: '2026-04-26T00:00:00Z',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if ((init.method ?? 'GET') === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify({
      total: 1,
      webhooks: [{
        id: 'wh_123',
        url: 'https://example.com/webhook',
        product_ids: [],
        events: ['price_drop'],
        active: true,
        created_at: '2026-04-26T00:00:00Z',
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = createClient('bw_live_test');
    const created = await client.webhooks.create('https://example.com/webhook', ['price_drop']);
    const listed = await client.webhooks.list();
    await client.webhooks.delete(created.id);

    assert.equal(created.id, 'wh_123');
    assert.equal(listed.length, 1);
    assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
      'POST https://api.buywhere.ai/v1/webhooks',
      'GET https://api.buywhere.ai/v1/webhooks',
      'DELETE https://api.buywhere.ai/v1/webhooks/wh_123',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('products client can get alerts for a product', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      alerts: [
        {
          id: 'alert_abc',
          product_id: 123,
          target_price: 49.99,
          direction: 'below',
          callback_url: 'https://example.com/webhook',
          active: true,
          created_at: '2026-04-26T00:00:00Z',
        },
        {
          id: 'alert_def',
          product_id: 123,
          target_price: 59.99,
          direction: 'above',
          callback_url: 'https://example.com/webhook2',
          active: false,
          created_at: '2026-04-25T00:00:00Z',
          triggered_at: '2026-04-26T12:00:00Z',
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = createClient('bw_live_test');
    const alerts = await client.products.getAlerts({ product_id: 123 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.buywhere.ai/v1/products/123/alerts');
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].id, 'alert_abc');
    assert.equal(alerts[0].target_price, 49.99);
    assert.equal(alerts[0].direction, 'below');
    assert.equal(alerts[1].active, false);
    assert.equal(alerts[1].triggered_at, '2026-04-26T12:00:00Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
