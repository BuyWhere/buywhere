// BUY-70064: Regression test for find_best_price fallback parameter ordering.
//
// Root cause: The ILIKE fallback query used params=[country, CANDIDATE_POOL, titlePattern]
// but the SQL referenced $2 for both LIMIT and ILIKE — making $2=CANDIDATE_POOL (integer)
// instead of titlePattern (string). PostgreSQL threw a type error → generic -32603.
//
// Fix: params must be ordered [country, titlePattern, CANDIDATE_POOL, minPrice?, category?]
// so $2=pattern, $3=pool, matching the SQL placeholders.
//
// This test verifies find_best_price doesn't return -32603 for sparse-category queries
// (those that trigger the ILIKE fallback because FTS finds no results).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';

const MCP_URL = process.env.MCP_URL || 'https://mcp.buywhere.ai';
const MCP_API_KEY = process.env.BUYWHERE_MCP_API_KEY;

// Only run if we have a real key (skip in CI without credentials)
const suite = MCP_API_KEY ? describe : describe.skip;

// Sparse queries that hit the ILIKE fallback: these return 0 FTS matches on SG/VN catalog
// because the product names are in Vietnamese/non-indexed or have no search_vector entries.
const SPARSE_QUERIES = [
  { product_name: 'điện thoại di động', country_code: 'VN' }, // Vietnamese "mobile phone"
  { product_name: 'laptop gaming cao cấp', country_code: 'VN' },
  { product_name: 'smartphone sam sung', country_code: 'VN' }, // misspelled
  { product_name: 'smartphone', country_code: 'VN' }, // sparse on VN
];

// All supported countries — none should return -32603
const COUNTRIES = ['SG', 'US', 'VN'];

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
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
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

suite('BUY-70064: find_best_price fallback path — no -32603 on sparse queries', () => {
  // Sparse queries that would hit the ILIKE fallback path
  for (const query of SPARSE_QUERIES) {
    it(`no -32603 for sparse query "${query.product_name}" in ${query.country_code}`, async () => {
      const { body } = await rpc('find_best_price', query, `fbp-sparse-${query.country_code}-${Date.now()}`);
      // -32603 means the fallback SQL exploded on bad parameters
      assert.notEqual(body.error?.code, -32603,
        `find_best_price returned -32603 for sparse query — fallback parameter bug may still exist: ${JSON.stringify(body.error)}`);
      // A valid response is either a result with products or an empty best_price
      if (!body.error) {
        const inner = JSON.parse(body.result?.content?.[0]?.text || '{}');
        assert.ok('best_price' in inner || 'meta' in inner,
          `Response should have best_price or meta, got: ${JSON.stringify(inner).slice(0, 200)}`);
      }
    });
  }

  // All countries should respond without -32603 for common device queries
  for (const country of COUNTRIES) {
    it(`no -32603 for "laptop" in ${country}`, async () => {
      const { body } = await rpc('find_best_price', { product_name: 'laptop', country_code: country }, `fbp-laptop-${country}`);
      assert.notEqual(body.error?.code, -32603,
        `find_best_price returned -32603 for laptop/${country}: ${JSON.stringify(body.error)}`);
    });

    it(`no -32603 for "smartphone" in ${country}`, async () => {
      const { body } = await rpc('find_best_price', { product_name: 'smartphone', country_code: country }, `fbp-smartphone-${country}`);
      assert.notEqual(body.error?.code, -32603,
        `find_best_price returned -32603 for smartphone/${country}: ${JSON.stringify(body.error)}`);
    });
  }

  it('no -32603 for SQL-like input', async () => {
    const { body } = await rpc('find_best_price', {
      product_name: "'; DROP TABLE products; --", country_code: 'SG'
    }, 'fbp-sql-like');
    assert.notEqual(body.error?.code, -32603,
      `find_best_price returned -32603 for SQL-like input: ${JSON.stringify(body.error)}`);
  });

  // Verify response structure when successful
  it('find_best_price returns valid structure with best_price field', async () => {
    const { body } = await rpc('find_best_price', { product_name: 'laptop', country_code: 'SG' }, 'fbp-struct');
    if (body.error) {
      // If it errors, it must NOT be -32603
      assert.notEqual(body.error.code, -32603, `Got -32603: ${JSON.stringify(body.error)}`);
      return;
    }
    const inner = JSON.parse(body.result.content[0].text);
    assert.ok('best_price' in inner, `Missing best_price field: ${JSON.stringify(inner).slice(0, 200)}`);
    assert.ok('alternatives' in inner, `Missing alternatives field: ${JSON.stringify(inner).slice(0, 200)}`);
    assert.ok('meta' in inner, `Missing meta field: ${JSON.stringify(inner).slice(0, 200)}`);
  });

  // Category filter should work without -32603
  it('no -32603 with category filter', async () => {
    const { body } = await rpc('find_best_price', {
      product_name: 'laptop', country_code: 'SG', category: 'electronics'
    }, 'fbp-cat');
    assert.notEqual(body.error?.code, -32603,
      `find_best_price with category returned -32603: ${JSON.stringify(body.error)}`);
  });

  // BUY-70112: SG Fashion broad terms previously hit PostgreSQL statement_timeout
  // because category ILIKE was applied in the unbounded primary Bitmap Heap Scan.
  it('no -32603 for SG Fashion dress category query', async () => {
    const { body } = await rpc('find_best_price', {
      product_name: 'dress', country_code: 'SG', category: 'Fashion'
    }, 'fbp-sg-fashion-dress');
    assert.notEqual(body.error?.code, -32603,
      `find_best_price SG Fashion dress returned -32603: ${JSON.stringify(body.error)}`);
  });
});
