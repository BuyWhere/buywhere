#!/usr/bin/env node
/**
 * BUY-65019 — sustained 1-hour replay harness.
 *
 * Streams ~1,943 /v1 traffic hits over 60 minutes (~1.35 RPS) at the
 * production endpoint `api.buywhere.ai`, alternating the same query mix
 * used by the BUY-26143 harness (search 50%, product 30%, MCP-ish
 * lightweight endpoint 20%). Captures per-minute latency buckets,
 * status counts, replica health snapshot, and writes a JSON+MD report
 * to OUTPUT_DIR for posting back to BUY-54678.
 *
 * Acceptance gates (parent BUY-54678):
 *   - search p95 < 200 ms over the full hour
 *   - disk free > 20 GB (Railway → n/a from this workspace)
 *   - zero lock waits on idx_products_search_vector (psql probe)
 *   - error rate < 1 % over the hour
 */

import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const TARGET = (process.env.TARGET_URL || 'https://api.buywhere.ai').replace(/\/$/, '');
const MCP_URL = process.env.MCP_URL || `${TARGET}/mcp`;
const API_KEY = process.env.API_KEY || process.env.BUYWHERE_API_KEY || '';
const DURATION_SEC = parseInt(process.env.DURATION_SEC || '3600', 10);
const TARGET_RPS = parseFloat(process.env.TARGET_RPS || '1.35');
const OUTPUT_DIR = process.env.OUTPUT_DIR || './load-results/replay-1h';

if (!API_KEY) {
  console.error('FATAL: API_KEY / BUYWHERE_API_KEY required for this profile');
  process.exit(2);
}

const HEADERS = {
  'X-API-Key': API_KEY,
  'Authorization': `Bearer ${API_KEY}`,
  'Accept': 'application/json',
  'User-Agent': 'bw-replay-1h/1.0',
};

// Query pool — mirrors BUY-26143 harness.
const SEARCH_QUERIES = [
  'iphone 15', 'samsung galaxy s24', 'nike air max', 'sony headphones',
  'laptop', 'coffee maker', 'running shoes', 'gaming mouse', 'airpods pro',
  'standing desk', 'mechanical keyboard', 'protein powder', 'yoga mat',
  'instant pot', 'monitor 4k', 'kindle', 'playstation 5', 'lego',
  'iphone 14', 'logitech mx master',
];

// Seeded product IDs (discovered live in warmup) — fallback IDs below are
// placeholder so the harness still produces traffic on a cold start.
const FALLBACK_IDS = ['220928', '220929', '220930', '220931', '220932', '220933'];
let PRODUCT_ID_POOL = [];
let QUERY_POOL = SEARCH_QUERIES.slice();

const MIX = { search: 0.50, product: 0.30, deals: 0.20 };

function randInt(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[randInt(arr.length)]; }
function pickWeighted(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(weights)) {
    if ((r -= w) <= 0) return k;
  }
  return Object.keys(weights)[0];
}

async function warmupCatalog() {
  for (const q of SEARCH_QUERIES.slice(0, 12)) {
    try {
      const url = `${TARGET}/v1/products/search?q=${encodeURIComponent(q)}&limit=10&country_code=SG`;
      const res = await fetch(url, { headers: { 'X-API-Key': API_KEY, 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const body = await res.json();
      const items = body.results || body.products || body.data || [];
      for (const it of items) {
        if (it.id && !PRODUCT_ID_POOL.includes(it.id)) PRODUCT_ID_POOL.push(it.id);
      }
    } catch (_) { /* ignore */ }
  }
  if (PRODUCT_ID_POOL.length === 0) PRODUCT_ID_POOL = FALLBACK_IDS.slice();
  console.log(`warmup: seeded ${PRODUCT_ID_POOL.length} product IDs`);
}

async function scenarioSearch() {
  const q = pick(QUERY_POOL);
  const url = `${TARGET}/v1/products/search?q=${encodeURIComponent(q)}&limit=20&country_code=SG`;
  const t0 = performance.now();
  let status = 0, error, cacheHit = false;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    status = res.status;
    cacheHit = res.headers.get('x-cache') === 'HIT';
  } catch (e) { error = e.message; }
  return { scenario: 'search', latencyMs: performance.now() - t0, status, error, cacheHit };
}

async function scenarioProduct() {
  const id = PRODUCT_ID_POOL.length ? pick(PRODUCT_ID_POOL) : pick(FALLBACK_IDS);
  const url = `${TARGET}/v1/products/${encodeURIComponent(id)}`;
  const t0 = performance.now();
  let status = 0, error, cacheHit = false;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    status = res.status;
    cacheHit = res.headers.get('x-cache') === 'HIT';
  } catch (e) { error = e.message; }
  return { scenario: 'product', latencyMs: performance.now() - t0, status, error, cacheHit };
}

async function scenarioDeals() {
  const url = `${TARGET}/v1/products/deals?min_discount=10&country_code=SG&limit=10`;
  const t0 = performance.now();
  let status = 0, error, cacheHit = false;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    status = res.status;
    cacheHit = res.headers.get('x-cache') === 'HIT';
  } catch (e) { error = e.message; }
  return { scenario: 'deals', latencyMs: performance.now() - t0, status, error, cacheHit };
}

const SCENARIOS = { search: scenarioSearch, product: scenarioProduct, deals: scenarioDeals };

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function probeHealth() {
  try {
    const res = await fetch(`${TARGET}/v1/catalog/stats/health`, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, body: await res.json() };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  await warmupCatalog();

  const totalRequests = Math.round(DURATION_SEC * TARGET_RPS);
  const intervalMs = Math.max(50, Math.floor(1000 / TARGET_RPS));
  const startedAt = new Date().toISOString();

  console.log(`=== BUY-65019 replay-1h ===`);
  console.log(`Target:        ${TARGET}`);
  console.log(`Duration:      ${DURATION_SEC}s`);
  console.log(`Target RPS:    ${TARGET_RPS} (~${totalRequests} requests)`);
  console.log(`Mix:           search=${(MIX.search*100).toFixed(0)}%  product=${(MIX.product*100).toFixed(0)}%  deals=${(MIX.deals*100).toFixed(0)}%`);
  console.log(`Output:        ${OUTPUT_DIR}`);
  console.log(`Started:       ${startedAt}`);

  const results = [];
  const minuteBuckets = new Map(); // minute → { count, latencies, errors }
  const scenarioLatencies = { search: [], product: [], deals: [] };
  const cacheHits = { search: 0, product: 0, deals: 0 };
  const cacheMisses = { search: 0, product: 0, deals: 0 };
  const statusCounts = {};
  let errors = 0, successes = 0;
  let healthSnapshot = null;
  const startMs = Date.now();

  for (let i = 0; i < totalRequests; i++) {
    const elapsed = Date.now() - startMs;
    if (elapsed >= DURATION_SEC * 1000) break;

    const scenarioName = pickWeighted(MIX);
    const result = await SCENARIOS[scenarioName]();
    results.push(result);
    scenarioLatencies[result.scenario].push(result.latencyMs);
    if (result.cacheHit) {
      cacheHits[result.scenario]++;
    } else {
      cacheMisses[result.scenario]++;
    }
    statusCounts[result.status] = (statusCounts[result.status] || 0) + 1;
    if (result.status >= 400 || result.status === 0) errors++; else successes++;

    const minute = Math.floor(elapsed / 60000);
    const bucket = minuteBuckets.get(minute) || { count: 0, latencies: [], errors: 0 };
    bucket.count++;
    bucket.latencies.push(result.latencyMs);
    if (result.status >= 400 || result.status === 0) bucket.errors++;
    minuteBuckets.set(minute, bucket);

    if ((i + 1) % 60 === 0) {
      healthSnapshot = await probeHealth();
      const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
      const totalHits = cacheHits.search + cacheHits.product + cacheHits.deals;
const totalCached = totalHits + cacheMisses.search + cacheMisses.product + cacheMisses.deals;
console.log(`  [t=${elapsedSec}s] dispatched=${i + 1}  err=${errors}  searchP95=${pct(scenarioLatencies.search, 95).toFixed(1)}ms  cacheHitRatio=${totalCached > 0 ? ((totalHits/totalCached)*100).toFixed(1) : '0.0'}%`);
    }

    // Pace to TARGET_RPS — wait until the expected wall-clock slot.
    const expected = (i + 1) * intervalMs;
    const now = Date.now() - startMs;
    const wait = expected - now;
    if (wait > 0) await sleep(wait);
  }

  const endedAt = new Date().toISOString();
  const finalHealth = await probeHealth();
  const overallErr = (errors / Math.max(1, results.length));
  const searchP95 = pct(scenarioLatencies.search, 95);
  const searchP99 = pct(scenarioLatencies.search, 99);
  const totalCacheHits = cacheHits.search + cacheHits.product + cacheHits.deals;
  const totalCacheMisses = cacheMisses.search + cacheMisses.product + cacheMisses.deals;
  const totalCacheTracked = totalCacheHits + totalCacheMisses;
  const overallCacheHitRatio = totalCacheTracked > 0 ? totalCacheHits / totalCacheTracked : 0;

  const buckets = [];
  for (const [k, v] of [...minuteBuckets.entries()].sort((a, b) => a[0] - b[0])) {
    buckets.push({
      minute: k,
      count: v.count,
      errors: v.errors,
      errorRate: +(v.errors / Math.max(1, v.count)).toFixed(4),
      p50: +pct(v.latencies, 50).toFixed(2),
      p95: +pct(v.latencies, 95).toFixed(2),
      p99: +pct(v.latencies, 99).toFixed(2),
      max: +Math.max(...v.latencies).toFixed(2),
    });
  }

  const report = {
    meta: {
      issue: 'BUY-65019',
      parent: 'BUY-54678',
      target: TARGET,
      profile: 'replay-1h',
      durationSec: DURATION_SEC,
      targetRps: TARGET_RPS,
      requestedRequests: totalRequests,
      mix: MIX,
      productIdsSeeded: PRODUCT_ID_POOL.length,
      startedAt,
      endedAt,
    },
    summary: {
      dispatched: results.length,
      successes,
      errors,
      errorRate: +overallErr.toFixed(4),
      searchP50: +pct(scenarioLatencies.search, 50).toFixed(2),
      searchP95: +searchP95.toFixed(2),
      searchP99: +searchP99.toFixed(2),
      productP50: +pct(scenarioLatencies.product, 50).toFixed(2),
      productP95: +pct(scenarioLatencies.product, 95).toFixed(2),
      productP99: +pct(scenarioLatencies.product, 99).toFixed(2),
      dealsP50: +pct(scenarioLatencies.deals, 50).toFixed(2),
      dealsP95: +pct(scenarioLatencies.deals, 95).toFixed(2),
      dealsP99: +pct(scenarioLatencies.deals, 99).toFixed(2),
      cacheHitRatio: +overallCacheHitRatio.toFixed(4),
      cacheHits: totalCacheHits,
      cacheMisses: totalCacheMisses,
      cacheHitsByScenario: { ...cacheHits },
      cacheMissesByScenario: { ...cacheMisses },
    },
    statusCounts,
    finalHealthSnapshot: finalHealth,
    intermediateHealthSamples: healthSnapshot ? [healthSnapshot] : [],
    minuteBuckets: buckets,
    thresholds: {
      searchP95Ms: 200,
      errorRate: 0.01,
      cacheHitRatioMin: 0.70,
      passed: searchP95 < 200 && overallErr < 0.01 && overallCacheHitRatio >= 0.70,
    },
  };

  const jsonPath = join(OUTPUT_DIR, 'replay-summary.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written: ${jsonPath}`);
  console.log(`Summary: dispatched=${report.summary.dispatched} errors=${report.summary.errors} (${(report.summary.errorRate*100).toFixed(2)}%)`);
  console.log(`Search: p50=${report.summary.searchP50}ms p95=${report.summary.searchP95}ms p99=${report.summary.searchP99}ms`);
  console.log(`Cache: hitRatio=${(report.summary.cacheHitRatio*100).toFixed(1)}% hits=${report.summary.cacheHits} misses=${report.summary.cacheMisses}`);
console.log(`Threshold PASSED: ${report.thresholds.passed}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});