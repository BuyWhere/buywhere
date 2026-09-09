#!/usr/bin/env node
/**
 * OpenAI Function Calling Latency Validation — BUY-7715
 *
 * Fires CONCURRENCY concurrent requests to each endpoint, measures p50/p95/p99,
 * and gates against the SLA_P99_MS threshold.
 *
 * Tests the actual deployed backend endpoints (REST API + MCP) which power all
 * adapter layers including OpenAI function calling.
 *
 * Usage:
 *   API_KEY=bw_xxx node tests/load/openai-function-calling-latency.mjs
 *
 * Environment variables:
 *   API_KEY       - Required. API key for authenticated endpoints.
 *   TARGET_URL    - Base URL (default: https://api.buywhere.ai)
 *   CONCURRENCY   - Concurrent requests per endpoint (default: 100)
 *   SLA_P99_MS    - P99 threshold in ms (default: 2000)
 *   COLD_START    - Set "true" to skip warmup (default: false)
 */
const TARGET = process.env.TARGET_URL || 'https://api.buywhere.ai';
const API_KEY = process.env.API_KEY || '';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '100', 10);
const SLA = parseInt(process.env.SLA_P99_MS || '2000', 10);
const COLD_START = process.env.COLD_START === 'true';
const PRODUCT_ID = process.env.PRODUCT_ID || '220928';

if (!API_KEY) {
  console.error('ERROR: API_KEY env var is required');
  process.exit(1);
}

const endpoints = [
  {
    label: 'search_products',
    url: () => `${TARGET}/v1/products/search?q=laptop&limit=20&country_code=SG`,
    opts: () => ({ headers: { Authorization: `Bearer ${API_KEY}` } }),
  },
  {
    label: 'get_product',
    url: () => `${TARGET}/v1/products/${PRODUCT_ID}`,
    opts: () => ({ headers: { Authorization: `Bearer ${API_KEY}` } }),
  },
  {
    label: 'get_price',
    url: () => `${TARGET}/v1/products/${PRODUCT_ID}/prices?days=30`,
    opts: () => ({ headers: { Authorization: `Bearer ${API_KEY}` } }),
  },
  {
    label: 'check_availability',
    url: () => `${TARGET}/v1/products/${PRODUCT_ID}`,
    opts: () => ({ headers: { Authorization: `Bearer ${API_KEY}` } }),
  },
  {
    label: 'list_merchants',
    url: () => `${TARGET}/v1/merchants`,
    opts: () => ({ headers: { Authorization: `Bearer ${API_KEY}` } }),
  },
];

function p(arr, pct) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function warmUp(ep) {
  for (let i = 0; i < 3; i++) {
    try {
      await fetch(ep.url(), ep.opts());
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 100));
  }
}

async function measure(ep) {
  if (!COLD_START) await warmUp(ep);

  const latencies = [];
  const errors = [];

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const t0 = performance.now();
      try {
        const res = await fetch(ep.url(), {
          ...ep.opts(),
          signal: AbortSignal.timeout(15000),
        });
        const elapsed = performance.now() - t0;
        if (res.ok) {
          latencies.push(elapsed);
          return;
        }
        const body = await res.text().catch(() => '');
        errors.push({ status: res.status, body: body.slice(0, 100) });
        return;
      } catch (err) {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 200));
          continue;
        }
        errors.push({ error: err.message });
      }
    }
  });

  await Promise.all(workers);

  return {
    endpoint: ep.label,
    samples: latencies.length,
    errors: errors.length,
    errorRate: latencies.length + errors.length > 0
      ? (errors.length / (latencies.length + errors.length) * 100).toFixed(1)
      : '0.0',
    avg_ms: latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0,
    min_ms: latencies.length > 0 ? Math.round(Math.min(...latencies)) : 0,
    max_ms: latencies.length > 0 ? Math.round(Math.max(...latencies)) : 0,
    p50_ms: Math.round(p(latencies, 50)),
    p95_ms: Math.round(p(latencies, 95)),
    p99_ms: Math.round(p(latencies, 99)),
    pass: p(latencies, 99) < SLA,
    details: errors.slice(0, 3),
  };
}

function printResults(results) {
  const header = '| Endpoint | Samples | Errors | p50 | p95 | p99 | Pass |';
  const sep    = '|----------|---------|--------|-----|-----|-----|------|';
  const rows = results.map(r =>
    `| ${r.endpoint} | ${r.samples} | ${r.errors} (${r.errorRate}%) | ${r.p50_ms}ms | ${r.p95_ms}ms | ${r.p99_ms}ms | ${r.pass ? '✅ PASS' : '❌ FAIL'} |`
  );

  console.log(`\n## OpenAI Function Calling Latency Results`);
  console.log(`\nTarget: ${TARGET}`);
  console.log(`Concurrency: ${CONCURRENCY} per endpoint`);
  console.log(`SLA: p99 < ${SLA}ms`);
  console.log(`Cold start: ${COLD_START}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`\n${header}`);
  console.log(sep);
  rows.forEach(r => console.log(r));

  console.log(`\n**Notes:**`);
  console.log(`- "get_price" tested via /v1/products/:id/prices (price history endpoint)`);
  console.log(`- "check_availability" tested via /v1/products/:id (availability is a field in product response)`);
  console.log(`- "list_merchants" tested via /v1/merchants`);

  const allPass = results.every(r => r.pass);
  console.log(`\n**Overall: ${allPass ? '✅ ALL PASS' : '❌ SOME FAILED'}**\n`);

  if (!allPass) {
    console.log('Failed endpoint details:');
    for (const r of results) {
      if (!r.pass) {
        console.log(`  - ${r.endpoint}: p99=${r.p99_ms}ms > ${SLA}ms`);
        if (r.details.length > 0) {
          for (const d of r.details) console.log(`    ${JSON.stringify(d)}`);
        }
      }
    }
  }
  return allPass;
}

async function main() {
  console.log('OpenAI Function Calling Latency Validation — BUY-7715');
  console.log('='.repeat(55));
  console.log(`Target: ${TARGET}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Cold start: ${COLD_START}`);
  console.log(`SLA: p99 < ${SLA}ms`);
  console.log('');

  const results = [];
  for (const ep of endpoints) {
    process.stdout.write(`Testing ${ep.label}... `);
    const r = await measure(ep);
    results.push(r);
    console.log(`${r.pass ? 'PASS' : 'FAIL'} — p99=${r.p99_ms}ms errors=${r.errors}/${r.samples + r.errors}`);
  }

  const allPass = printResults(results);
  if (!allPass) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
