// BUY-70144: Regression coverage for MCP catalog FTS planner regressions.
//
// Root cause: PostgreSQL chose sequential scans over the 400M-row products table
// for sparse-country keyword searches (notably VN), causing statement_timeout and
// generic JSON-RPC -32603 responses. find_best_price also fell through to its
// bounded ILIKE fallback after a too-tight primary timeout on broad US queries,
// returning 0 results for known-populated queries.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';

const MCP_URL = process.env.MCP_URL || 'https://mcp.buywhere.ai';
const MCP_API_KEY = process.env.BUYWHERE_MCP_API_KEY;

const suite = MCP_API_KEY ? describe : describe.skip;

function rpc(toolName, args, id = 'buy-70144-' + Date.now()) {
  return new Promise((resolve, reject) => {
    const url = new URL(MCP_URL);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MCP_API_KEY}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: toolName,
      params: args,
    }));
    req.end();
  });
}

function parseToolText(body) {
  return JSON.parse(body.result?.content?.[0]?.text || '{}');
}

suite('BUY-70144: MCP search/find_best_price regressions', () => {
  it('search_products does not return -32603 for SG nike shoes', async () => {
    const { body } = await rpc('search_products', { q: 'nike shoes', country_code: 'SG', limit: 3 }, 'buy-70144-search-sg');
    assert.notEqual(body.error?.code, -32603, `search_products SG returned -32603: ${JSON.stringify(body.error)}`);
    assert.ok(body.result?.content?.[0]?.text, `Expected tool text result, got: ${JSON.stringify(body).slice(0, 300)}`);
  });

  it('search_products does not return -32603 for sparse VN nike shoes', async () => {
    const { body } = await rpc('search_products', { q: 'nike shoes', country_code: 'VN', limit: 3 }, 'buy-70144-search-vn');
    assert.notEqual(body.error?.code, -32603, `search_products VN returned -32603: ${JSON.stringify(body.error)}`);
    assert.ok(body.result?.content?.[0]?.text, `Expected tool text result, got: ${JSON.stringify(body).slice(0, 300)}`);
  });

  it('find_best_price returns non-empty results for SG nike air max', async () => {
    const { body } = await rpc('find_best_price', { product_name: 'nike air max', country_code: 'SG' }, 'buy-70144-fbp-sg');
    assert.notEqual(body.error?.code, -32603, `find_best_price SG returned -32603: ${JSON.stringify(body.error)}`);
    const inner = parseToolText(body);
    assert.ok(inner.meta?.total > 0, `Expected SG nike air max results, got: ${JSON.stringify(inner).slice(0, 300)}`);
    assert.ok(inner.best_price, `Expected best_price, got: ${JSON.stringify(inner).slice(0, 300)}`);
    assert.ok(inner.meta?.response_time_ms < 8000, `SG FBP should respond <8s, got ${inner.meta?.response_time_ms}ms`);
  });

  it('find_best_price returns non-empty results for US nike air max', async () => {
    const { body } = await rpc('find_best_price', { product_name: 'nike air max', country_code: 'US' }, 'buy-70144-fbp-us');
    assert.notEqual(body.error?.code, -32603, `find_best_price US returned -32603: ${JSON.stringify(body.error)}`);
    const inner = parseToolText(body);
    assert.ok(inner.meta?.total > 0, `Expected US nike air max results, got: ${JSON.stringify(inner).slice(0, 300)}`);
    assert.ok(inner.best_price, `Expected best_price, got: ${JSON.stringify(inner).slice(0, 300)}`);
    assert.ok(inner.meta?.response_time_ms < 15000, `US FBP should respond <15s, got ${inner.meta?.response_time_ms}ms`);
  });

  it('BUY-70286: list_categories returns non-empty VN categories under 2s', async () => {
    const { body } = await rpc('list_categories', { country_code: 'VN' }, 'buy-70286-list-categories-vn');
    assert.notEqual(body.error?.code, -32603, `list_categories VN returned -32603: ${JSON.stringify(body.error)}`);
    const inner = parseToolText(body);
    assert.ok(Array.isArray(inner.data), `Expected categories data array, got: ${JSON.stringify(inner).slice(0, 300)}`);
    assert.ok(inner.data.length > 0, `Expected non-empty VN categories, got: ${JSON.stringify(inner).slice(0, 300)}`);
    assert.ok(inner.meta?.response_time_ms < 2000, `VN list_categories should respond <2s, got ${inner.meta?.response_time_ms}ms`);
  });

  it('search_products treats ISO region aliases as country filters and never reports positive total with empty results', async () => {
    const { body } = await rpc('search_products', { q: 'nike shoes', region: 'SG', limit: 3 }, 'buy-70218-search-region-sg');
    assert.notEqual(body.error?.code, -32603, `search_products region=SG returned -32603: ${JSON.stringify(body.error)}`);
    const inner = parseToolText(body);
    assert.ok(Array.isArray(inner.results), `Expected results array, got: ${JSON.stringify(inner).slice(0, 300)}`);
    if (inner.total > 0) {
      assert.ok(inner.results.length > 0, `total>0 must not have empty results: ${JSON.stringify(inner).slice(0, 300)}`);
    }
  });

  it('find_best_price treats ISO region aliases as country filters', async () => {
    const { body } = await rpc('find_best_price', { product_name: 'nike air max', region: 'SG', limit: 3 }, 'buy-70218-fbp-region-sg');
    assert.notEqual(body.error?.code, -32603, `find_best_price region=SG returned -32603: ${JSON.stringify(body.error)}`);
    const inner = parseToolText(body);
    assert.ok(inner.meta?.total > 0, `Expected region=SG nike air max results, got: ${JSON.stringify(inner).slice(0, 300)}`);
    assert.ok(inner.best_price, `Expected best_price for region=SG, got: ${JSON.stringify(inner).slice(0, 300)}`);
  });
});
