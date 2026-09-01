// BUY-69998: compact smoke covering SG/VN/US search country routing.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';

const MCP_URL = process.env.MCP_URL || 'https://api.buywhere.ai/mcp';
const MCP_API_KEY = process.env.BUYWHERE_API_KEY || process.env.BUYWHERE_MCP_API_KEY;
const suite = MCP_API_KEY ? describe : describe.skip;

function rpc(toolName, args) {
  return new Promise((resolve, reject) => {
    const url = new URL(MCP_URL);
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 'buy-69998-' + Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MCP_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), ms: Date.now() - t0 }); }
        catch (e) { reject(e); }
      });
    });
    const t0 = Date.now();
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseResults(body) {
  const content = body?.result?.content?.[0]?.text || JSON.stringify(body?.result || {});
  let parsed;
  try { parsed = JSON.parse(content); } catch { parsed = body?.result || {}; }
  return parsed.results || parsed.data || [];
}

suite('BUY-69998 search country routing smoke', () => {
  const cases = [
    { q: 'sunglasses', country_code: 'SG' },
    { q: 'electronics', deliver_to: 'VN' },
    { q: 'sneakers', country_code: 'US' },
  ];

  for (const args of cases) {
    const market = String(args.deliver_to || args.country_code).toUpperCase();
    it(`search_products ${market} stays in-market and finishes under 2s`, async () => {
      const { status, body, ms } = await rpc('search_products', { ...args, limit: 5 });
      assert.equal(status, 200, JSON.stringify(body).slice(0, 400));
      assert.ok(!body.error, JSON.stringify(body.error || {}).slice(0, 400));
      assert.ok(ms < 2000, `took ${ms}ms`);
      const results = parseResults(body);
      for (const row of results) {
        const cc = String(row.country_code || '').toUpperCase();
        const region = String(row.region || '').toLowerCase();
        assert.equal(cc, market, `leaked ${cc} for ${market} id=${row.id}`);
        if (region) assert.equal(region, market.toLowerCase(), `region ${region} disagrees with ${market}`);
      }
    });
  }
});
