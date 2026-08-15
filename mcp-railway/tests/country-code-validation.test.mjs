// BUY-69625: Regression tests for country_code validation and request_id.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';

const MCP_URL = process.env.MCP_URL || 'https://mcp.buywhere.ai';
const MCP_API_KEY = process.env.BUYWHERE_MCP_API_KEY;

const suite = MCP_API_KEY ? describe : describe.skip;

function rpc(toolName, args, id = 'test-' + Date.now()) {
  return new Promise((resolve, reject) => {
    const url = new URL(MCP_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MCP_API_KEY}`,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }));
    req.end();
  });
}

suite('BUY-69625: country_code validation', () => {
  it('returns 400 MARKET_UNSUPPORTED for invalid country_code ZZ on search_products', async () => {
    const { status, body } = await rpc('search_products', { q: 'blender', country_code: 'ZZ' });
    assert.equal(status, 400);
    assert.equal(body.error.code, -32602);
    assert.equal(body.error.data.envelope.error.code, 'MARKET_UNSUPPORTED');
    assert.ok(body.error.message.includes('ZZ'));
    assert.ok(body.error.message.includes('search_products'));
  });

  it('returns 400 for invalid country alias "zz" via tools/call', async () => {
    const { status, body } = await rpc('search_products', { q: 'blender', country: 'zz' });
    assert.equal(status, 400);
    assert.equal(body.error.data.envelope.error.code, 'MARKET_UNSUPPORTED');
  });

  it('returns 400 for invalid country_code on find_best_price', async () => {
    const { status, body } = await rpc('find_best_price', { product_name: 'blender', country_code: 'ZZ' });
    assert.equal(status, 400);
    assert.equal(body.error.data.envelope.error.code, 'MARKET_UNSUPPORTED');
  });

  it('returns 400 for invalid country_code on get_deals', async () => {
    const { status, body } = await rpc('get_deals', { country_code: 'ZZ' });
    assert.equal(status, 400);
    assert.equal(body.error.data.envelope.error.code, 'MARKET_UNSUPPORTED');
  });

  it('returns 400 for invalid country_code on list_categories', async () => {
    const { status, body } = await rpc('list_categories', { country_code: 'XX' });
    assert.equal(status, 400);
    assert.equal(body.error.data.envelope.error.code, 'MARKET_UNSUPPORTED');
  });

  it('includes request_id when id is a string', async () => {
    const { body } = await rpc('search_products', { country_code: 'ZZ' });
    assert.equal(body.request_id, body.id);
    assert.equal(typeof body.request_id, 'string');
  });

  // BUY-70000: request_id is always a non-empty string (UUID when id is null/numeric,
  // passthrough when id is a non-empty string).
  it('request_id is a string (UUID) when id is numeric', async () => {
    const { body } = await rpc('search_products', { country_code: 'ZZ' }, 42);
    assert.equal(body.request_id, '42');
    assert.equal(typeof body.request_id, 'string');
  });

  it('request_id is a string (UUID) when id is null', async () => {
    const { body } = await rpc('search_products', { country_code: 'ZZ' }, null);
    // null id -> random UUID
    assert(body.request_id);
    assert.equal(typeof body.request_id, 'string');
    assert.match(body.request_id, /^[0-9a-f-]{36}$/);
  });

  it('response includes top-level timestamp on success', async () => {
    const { body } = await rpc('list_categories', {});
    assert(body.timestamp);
    assert.equal(typeof body.timestamp, 'string');
    assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('response includes top-level timestamp on error', async () => {
    const { body } = await rpc('search_products', { country_code: 'ZZ' });
    assert(body.timestamp);
    assert.equal(typeof body.timestamp, 'string');
  });

  it('does not validate country_code on tools without it (get_product)', async () => {
    const { status, body } = await rpc('get_product', { id: 'nonexistent-id' });
    if (body.error) {
      assert.notEqual(body.error.data?.envelope?.error?.code, 'MARKET_UNSUPPORTED');
    }
  });
});
