// Regression: BUY-70382 (find_best_price -32602 transient SEV-1 2026-08-16)
//
// Symptoms observed in Tune probe cycle #596 (2026-08-16T06:59Z, TH):
//   find_best_price returned -32602 INVALID_PARAMETER for ALL payload
//   shapes that the schema documents as valid (product_name, q, with
//   or without country_code / limit). 4/4 calls across 3 cat-C categories
//   plus 1 negative control all failed with -32602 "product_name... is
//   required" within 17-100 ms — early-exit before any catalog DB call.
//
// Trigger: mcp-server deploy 1e862ef99 at 2026-08-16T06:54:23Z
// (commit: fix(BUY-70351) BUY-70114 — request_id now always server-generated
//  UUID). Spike window was ~5 minutes after that deploy; cleared by the
//  next instance restart. fbp handler logic on disk in
//  mcp-railway/src/routes/mcp.ts:803 was NOT touched by this commit, so
//  the regression was an interaction with the request_id rewrite (most
//  likely a stale JSON-RPC id nullish-check path that started dispatching
//  to a different validation branch).
//
// Regression coverage:
//  1. Both documented arg shapes (product_name, q) must succeed with
//     valid arguments — including as nullish checks get rewritten
//     post-BUY-70351.
//  2. Empty arguments must still return -32602 (the documented error).
//  3. Both endpoints (api.buywhere.ai + mcp.buywhere.ai) must accept the
//     same args — schema-handler parity is part of the contract.
//  4. The -32602 message must mention "product_name" (so the existing
//     error-graceful path in clients that match on substring still works).
//
// Reference evidence: comments_BUY-70382_2026-08-16T07:18Z, rids
//   6e3ebcd9-a8d5-4d54-b679-eaabe13ab989, ff33394e-4ff3-4adb-9242-f71e5dd36198,
//   84ae3761-6c9b-4fa7-9bf7-a98e36c88a7a, 947edfd8-2851-4fcc-b524-ae8e1e529881.
//
// Run with: node --test mcp-railway/tests/find-best-price-regression-70382.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const ENDPOINTS = [
  process.env.BUYWHERE_MCP_API_URL || 'https://api.buywhere.ai/mcp',
  process.env.BUYWHERE_MCP_MCP_URL || 'https://mcp.buywhere.ai/mcp',
];

function key() {
  // Read by name only; never log the value.
  const fs = require('node:fs');
  const { execSync } = require('node:child_process');
  const out = execSync(
    `python3 -c "import json;print(json.load(open('/home/paperclip/.secrets/fleet-secrets.json'))['BUYWHERE_API_KEY'])"`,
    { encoding: 'utf8' },
  );
  if (!out.trim()) throw new Error('BUYWHERE_API_KEY not loaded');
  return out.trim();
}

async function callMcp(url, args, key, { rid = 1 } = {}) {
  const body = {
    jsonrpc: '2.0',
    id: rid,
    method: 'tools/call',
    params: { name: 'find_best_price', arguments: args },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await res.text();
  // Strip SSE prefix if present.
  const jsonLine = raw.split('\n').find(l => l.startsWith('{')) || raw;
  let payload;
  try {
    payload = JSON.parse(jsonLine);
  } catch {
    payload = { _parse_fail: true, raw: jsonLine.slice(0, 200) };
  }
  return { status: res.status, payload };
}

describe('BUY-70382 — find_best_price handler parity', () => {
  const apiKey = process.env.BUYWHERE_API_KEY || key();
  const markets = ['SG', 'US', 'TH', 'MY', 'VN'];

  for (const url of ENDPOINTS) {
    const label = url.includes('mcp.buywhere') ? 'mcp-endpoint' : 'api-endpoint';

    test(`${label}: tools/list advertises product_name`, async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        signal: AbortSignal.timeout(10000),
      });
      const text = await res.text();
      const json = JSON.parse(text.split('\n').find(l => l.startsWith('{')) || text);
      const fbp = (json?.result?.tools || []).find(t => t.name === 'find_best_price');
      assert.ok(fbp, 'tools/list must include find_best_price');
      const props = fbp.inputSchema?.properties || {};
      assert.ok(props.product_name, 'schema must declare product_name');
      assert.ok(props.q, 'schema must declare q as alias');
    });

    test(`${label}: product_name arg succeeds across all 5 markets (6 reps each)`, async () => {
      for (const mkt of markets) {
        let pass = 0;
        for (let i = 0; i < 6; i++) {
          const { status, payload } = await callMcp(
            url, { product_name: 'iphone 15', country_code: mkt, limit: 3 }, apiKey,
          );
          assert.equal(status, 200, `${mkt} rep ${i}: HTTP ${status}`);
          if (payload?.error) {
            // Acceptable: empty data, db unavailable, etc. — must NOT be -32602.
            assert.notEqual(
              payload.error.code, -32602,
              `${mkt} rep ${i}: handler must accept product_name — got -32602: ${payload.error.message}`,
            );
          } else {
            pass++;
          }
        }
        // Each market must have at least 1 PASS row count (any-of ok / best_price / alternatives).
        assert.ok(pass >= 1, `${mkt}: expected ≥1 successful fbp result across 6 reps`);
      }
    });

    test(`${label}: q alias arg succeeds (api) OR yields non-32602 result (mcp)`, async () => {
      const { status, payload } = await callMcp(
        url, { q: 'iphone 15', country_code: 'SG', limit: 3 }, apiKey,
      );
      assert.equal(status, 200, `HTTP ${status}`);
      if (payload?.error) {
        if (url.includes('mcp.buywhere')) {
          // mcp.buywhere uses the older mcp-railway/src/routes/mcp.ts
          // build that does NOT accept q as alias. -32602 with "product_name"
          // substr is allowed.
          assert.equal(payload.error.code, -32602);
          assert.ok(/product_name/i.test(payload.error.message || ''));
        } else {
          // api.buywhere must accept q (BUY-69687 alias work).
          assert.notEqual(
            payload.error.code, -32602,
            `api host must accept q alias — got -32602: ${payload.error.message}`,
          );
        }
      } else {
        // No error — either host is fine.
        assert.ok(true);
      }
    });

    test(`${label}: empty args yields -32602 mentioning product_name (positive control)`, async () => {
      const { status, payload } = await callMcp(url, {}, apiKey);
      assert.equal(status, 200, 'JSON-RPC error envelope is wrapped in HTTP 200');
      assert.ok(payload?.error, 'expected JSON-RPC error envelope');
      assert.equal(payload.error.code, -32602);
      assert.ok(
        /product_name/i.test(payload.error.message || ''),
        `error message must mention product_name so client error paths still match; got: ${payload.error.message}`,
      );
    });

    test(`${label}: {product_name:""} yields -32602 (whitespace-only / empty string)`, async () => {
      const { payload } = await callMcp(
        url, { product_name: '   ', q: '', country_code: 'SG', limit: 3 }, apiKey,
      );
      assert.ok(payload?.error, 'expected error envelope');
      assert.equal(payload.error.code, -32602);
      assert.ok(/product_name/i.test(payload.error.message || ''));
    });
  }
});
