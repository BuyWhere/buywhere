#!/usr/bin/env node
/**
 * MCP production regression guard.
 *
 * Runs a minimal JSON-RPC smoke test against the production endpoint
 * (default https://mcp.buywhere.ai) using a BUYWHERE_MCP_API_KEY.
 *
 * Validates:
 * - healthz is 200
 * - tools/list returns expected tools
 * - get_deals returns non-empty results for a known region
 *
 * Exits 0 on success, 1 on failure. Designed to run after a Railway deploy.
 */
import { parse as parseUrl } from 'url';
import https from 'https';
import http from 'http';

const MCP_ENDPOINT = (process.env.MCP_ENDPOINT || 'https://mcp.buywhere.ai').replace(/\/$/, '');
const MCP_API_KEY = process.env.BUYWHERE_MCP_API_KEY;

if (!MCP_API_KEY) {
  console.error('BUYWHERE_MCP_API_KEY is required');
  process.exit(1);
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = parseUrl(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({ ...parsed, ...opts }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(15000, () => req.destroy(new Error(`Request timed out: ${url}`)));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function jsonRpc(method, params, id) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const res = await request(`${MCP_ENDPOINT}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${MCP_API_KEY}`,
      'Content-Length': Buffer.byteLength(payload),
    },
    body: payload,
  });

  let parsed = null;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error(`${method} returned non-JSON HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${method} returned HTTP ${res.status}: ${JSON.stringify(parsed).slice(0, 500)}`);
  }

  return parsed;
}

async function main() {
  let failed = false;

  // Health check
  const health = await request(`${MCP_ENDPOINT}/healthz`);
  console.log(`healthz status=${health.status}`);
  if (health.status !== 200) {
    console.error('Health check failed');
    failed = true;
  }

  // tools/list via JSON-RPC
  try {
    const listMsg = await jsonRpc('tools/list', {}, 1);
    if (!listMsg || listMsg.error) {
      console.error('tools/list failed:', listMsg?.error || listMsg);
      failed = true;
    } else {
      const toolNames = (listMsg.result?.tools || []).map(t => t.name);
      console.log(`tools/list ok: ${toolNames.length} tools`);
      for (const name of ['get_deals', 'list_categories']) {
        if (!toolNames.includes(name)) {
          console.error(`Missing expected tool: ${name}`);
          failed = true;
        }
      }
    }
  } catch (err) {
    console.error('tools/list error:', err.message);
    failed = true;
  }

  // get_deals smoke test via JSON-RPC
  try {
    const dealsMsg = await jsonRpc('tools/call', {
      name: 'get_deals',
      arguments: { query: 'laptop', region: 'sg', limit: 5 },
    }, 2);

    if (!dealsMsg || dealsMsg.error) {
      console.error('get_deals failed:', dealsMsg?.error || dealsMsg);
      failed = true;
    } else {
      const text = dealsMsg.result?.content?.[0]?.text || '{}';
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = {}; }
      const total = parsed?.meta?.total ?? parsed?.total;
      const products = parsed?.data || parsed?.products || [];
      console.log(`get_deals ok: total=${total}, products=${products.length}`);
      if (products.length === 0) {
        console.error('get_deals returned zero products');
        failed = true;
      }
    }
  } catch (err) {
    console.error('get_deals error:', err.message);
    failed = true;
  }

  if (failed) {
    console.error('Regression guard FAILED');
    process.exit(1);
  }
  console.log('Regression guard PASSED');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
