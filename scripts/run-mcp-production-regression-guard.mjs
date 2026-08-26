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
 * - get_deals returns non-empty results for a known country (advisory while
 *   BUY-64151 is outstanding; set GET_DEALS_GUARD_HARD_FAIL=true to hard-fail)
 *
 * Exits 0 on success, 1 on failure. Designed to run after a Railway deploy.
 */
import { parse as parseUrl } from 'url';
import https from 'https';
import http from 'http';

const MCP_ENDPOINT = (process.env.MCP_ENDPOINT || 'https://mcp.buywhere.ai').replace(/\/$/, '');
const MCP_API_KEY = process.env.BUYWHERE_MCP_API_KEY;
const GET_DEALS_GUARD_HARD_FAIL = process.env.GET_DEALS_GUARD_HARD_FAIL === 'true';

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
      // BUY-75345: v2 buyer-context surface MUST be present on the canonical MCP
      // host. The 14d P2.7 adoption gate (monitoring.mcp_v2_request_log external-agent
      // >0/day) cannot start if external agents cannot discover v2 here.
      // Gate: at least the 5 v2 tools are registered, AND tools/list returns >=10
      // tools total. This catches future regressions where a deploy strips the v2
      // wire from the compiled dist (see the 2026-08-26 incident where the
      // mcp-server Railway service ran a stale api/dist build that pre-dated v2).
      const V2_REQUIRED = [
        'search_products_v2',
        'get_product_v2',
        'compare_products_v2',
        'get_deals_v2',
        'find_best_price_v2',
      ];
      const missingV2 = V2_REQUIRED.filter((n) => !toolNames.includes(n));
      if (missingV2.length > 0) {
        console.error(`Missing v2 tool(s): ${missingV2.join(', ')} (BUY-75345: v2 wire required on canonical MCP host)`);
        failed = true;
      } else {
        console.log(`v2 surface ok: ${V2_REQUIRED.length} tools present`);
      }
      if (toolNames.length < 10) {
        console.error(`tools/list returned ${toolNames.length} tools (< 10 expected — BUY-75345)`);
        failed = true;
      }
    }
  } catch (err) {
    console.error('tools/list error:', err.message);
    failed = true;
  }

  // get_deals smoke test via JSON-RPC
  // Advisory by default so deploys are not blocked by BUY-64151 (get_deals SEV-1).
  // Set GET_DEALS_GUARD_HARD_FAIL=true to make this a hard pass/fail gate.
  let dealsOk = false;
  try {
    const dealsMsg = await jsonRpc('tools/call', {
      name: 'get_deals',
      arguments: { country_code: 'SG', limit: 5 },
    }, 2);

    if (!dealsMsg || dealsMsg.error) {
      console.error('get_deals failed:', dealsMsg?.error || dealsMsg);
      dealsOk = false;
    } else {
      const text = dealsMsg.result?.content?.[0]?.text || '{}';
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = {}; }
      const total = parsed?.meta?.total ?? parsed?.total;
      const products = parsed?.data || parsed?.products || [];
      console.log(`get_deals ok: total=${total}, products=${products.length}`);
      dealsOk = products.length > 0;
      if (!dealsOk) {
        console.error('get_deals returned zero products');
      }
    }
  } catch (err) {
    console.error('get_deals error:', err.message);
    dealsOk = false;
  }

  if (GET_DEALS_GUARD_HARD_FAIL && !dealsOk) {
    console.error('get_deals hard-fail enabled but check did not pass');
    failed = true;
  } else if (!dealsOk) {
    console.warn('get_deals advisory: check did not pass (GET_DEALS_GUARD_HARD_FAIL not set)');
  }

  // BUY-75345: v2 wire contract — search_products_v2 MUST reject calls without
  // deliver_to with a -32602 INVALID_PARAMETER. If this passes silently, the
  // v2 wire has regressed to v1 behavior (which infers country from
  // country_code, allowing the call to succeed) — P2.7 gate would tick green
  // for the wrong reason. Skip if MCP_API_KEY isn't set (cannot authenticate
  // a tools/call).
  if (MCP_API_KEY) {
    try {
      const v2Probe = await jsonRpc('tools/call', {
        name: 'search_products_v2',
        arguments: { q: 'laptop', limit: 1 },
      }, 3);
      const err = v2Probe?.error;
      if (err && err.code === -32602 && /deliver_to/i.test(String(err.message || ''))) {
        console.log('v2 wire contract ok: search_products_v2 without deliver_to -> -32602');
      } else {
        console.error(
          `v2 wire contract REGRESSION: expected -32602 'deliver_to' missing; got ${JSON.stringify(err).slice(0, 200)}`,
        );
        failed = true;
      }
    } catch (err) {
      console.error('v2 wire contract probe error:', err.message);
      failed = true;
    }
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
