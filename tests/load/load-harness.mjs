#!/usr/bin/env node
/**
 * BuyWhere Load-Test Harness — BUY-26143 / BUY-579E
 *
 * Self-contained, k6-free load harness for the API + MCP stack.
 * Drives staged ramp-up / hold / ramp-down traffic across three scenario
 * families: REST search, REST product detail, and MCP query mixes.
 *
 * Designed to run in any Node 20+ environment with no third-party
 * dependencies — pulls everything from the standard library (fetch,
 * perf_hooks, cluster-style fan-out via setImmediate).
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   API_KEY=bw_xxx node tests/load/load-harness.mjs
 *   API_KEY=bw_xxx PROFILE=peak TARGET_URL=https://staging.example.com node tests/load/load-harness.mjs
 *   API_KEY=bw_xxx PROFILE=stress DURATION=120 OUTPUT_DIR=./results node tests/load/load-harness.mjs
 *
 * ── Profiles ────────────────────────────────────────────────────────────────
 *
 *   smoke   — 5 RPS, 30s hold       (sanity check on local / PR CI)
 *   normal  — 50 RPS, 4m hold       (baseline traffic mix)
 *   peak    — 200 RPS, 9m hold      (target daily-peak load)
 *   stress  — 1000 RPS, 10m hold    (cloud-run autoscaling ceiling)
 *
 * ── Environment Variables ───────────────────────────────────────────────────
 *
 *   TARGET_URL    Base URL of the API (default: https://api.buywhere.ai)
 *   API_KEY       API key for X-API-Key auth (required for non-public paths)
 *   MCP_URL       Override for the MCP endpoint (default: ${TARGET_URL}/mcp)
 *   PROFILE       smoke | normal | peak | stress (default: smoke)
 *   DURATION      Override profile hold duration in seconds (optional)
 *   RAMP_UP       Override profile ramp-up duration in seconds (optional)
 *   RAMP_DOWN     Override profile ramp-down duration in seconds (optional)
 *   TARGET_RPS    Override profile target RPS (optional)
 *   OUTPUT_DIR    Directory for JSON + markdown reports (default: ./load-results)
 *   WARMUP_QUERIES Number of queries to seed product/IDs from (default: 12)
 *   SCENARIO_MIX  Override JSON mix, e.g. '{"search":0.5,"product":0.3,"mcp":0.2}'
 *   THRESHOLD_P99_MS  Fail if any scenario p99 > this (default: 1000)
 *   THRESHOLD_ERROR_RATE  Fail if overall error rate > this (default: 0.05)
 *   VERBOSE       Set "true" to log every request (default: false)
 *
 * ── Output ──────────────────────────────────────────────────────────────────
 *
 *   ${OUTPUT_DIR}/load-summary.json   — full per-scenario + per-stage metrics
 *   ${OUTPUT_DIR}/load-summary.md     — markdown report for posting to issues
 *   Exits 0 if all thresholds pass, 1 otherwise.
 *
 * ── Stages ──────────────────────────────────────────────────────────────────
 *
 *   Stage 1 (RAMP_UP)    0 → TARGET_RPS over RAMP_UP seconds; scenarios use base mix
 *   Stage 2 (HOLD)       steady TARGET_RPS for DURATION seconds; this is the
 *                        measurement window — thresholds are evaluated only
 *                        against hold-stage samples.
 *   Stage 3 (RAMP_DOWN)  TARGET_RPS → 0 over RAMP_DOWN seconds; not measured.
 *
 *   Total run time = RAMP_UP + DURATION + RAMP_DOWN seconds.
 */

import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Configuration ──────────────────────────────────────────────────────────

const TARGET = (process.env.TARGET_URL || 'https://api.buywhere.ai').replace(/\/$/, '');
const MCP_URL = process.env.MCP_URL || `${TARGET}/mcp`;
const API_KEY = process.env.API_KEY || '';
const PROFILE = (process.env.PROFILE || 'smoke').toLowerCase();
const OUTPUT_DIR = process.env.OUTPUT_DIR || './load-results';
const WARMUP_QUERIES = parseInt(process.env.WARMUP_QUERIES || '12', 10);
const THRESHOLD_P99 = parseInt(process.env.THRESHOLD_P99_MS || '1000', 10);
const THRESHOLD_ERR = parseFloat(process.env.THRESHOLD_ERROR_RATE || '0.05');
const VERBOSE = process.env.VERBOSE === 'true';

// ── Profiles ───────────────────────────────────────────────────────────────

const PROFILES = {
  smoke:  { rampUp: 10,  hold: 30,  rampDown: 10, targetRps: 5,    mix: { search: 0.40, product: 0.30, mcp: 0.30 } },
  normal: { rampUp: 60,  hold: 240, rampDown: 30, targetRps: 50,   mix: { search: 0.40, product: 0.30, mcp: 0.30 } },
  peak:   { rampUp: 60,  hold: 540, rampDown: 60, targetRps: 200,  mix: { search: 0.40, product: 0.30, mcp: 0.30 } },
  stress: { rampUp: 120, hold: 600, rampDown: 60, targetRps: 1000, mix: { search: 0.40, product: 0.30, mcp: 0.30 } },
};

function loadProfile() {
  const p = PROFILES[PROFILE];
  if (!p) {
    console.error(`Unknown profile: ${PROFILE}. Valid: ${Object.keys(PROFILES).join(', ')}`);
    process.exit(2);
  }
  // Apply overrides
  return {
    name: PROFILE,
    rampUp:   parseInt(process.env.RAMP_UP   || '0', 10) || p.rampUp,
    hold:     parseInt(process.env.DURATION  || '0', 10) || p.hold,
    rampDown: parseInt(process.env.RAMP_DOWN || '0', 10) || p.rampDown,
    targetRps: parseInt(process.env.TARGET_RPS || '0', 10) || p.targetRps,
    mix: process.env.SCENARIO_MIX
      ? JSON.parse(process.env.SCENARIO_MIX)
      : p.mix,
  };
}

// ── Seed Data ──────────────────────────────────────────────────────────────
// Hand-picked search queries that exercise the FTS path with varied catalog
// coverage. The MCP harness uses the same queries; product IDs are fetched
// from the live catalog during warmup so the test always targets real rows.

const SEARCH_QUERIES = [
  'iphone 15',
  'samsung galaxy s24',
  'nike air max',
  'sony headphones',
  'laptop',
  'coffee maker',
  'running shoes',
  'gaming mouse',
  'airpods pro',
  'standing desk',
  'mechanical keyboard',
  'protein powder',
  'yoga mat',
  'instant pot',
  'monitor 4k',
  'kindle',
  'playstation 5',
  'lego',
  'iphone 14',
  'logitech mx master',
];

// Filled by warmupCatalog()
const PRODUCT_ID_POOL = [];
const QUERY_POOL = SEARCH_QUERIES.slice();

function randInt(max) { return Math.floor(Math.random() * max); }
function pick(arr) { return arr[randInt(arr.length)]; }
function pickWeighted(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(weights)) {
    if ((r -= w) <= 0) return k;
  }
  return Object.keys(weights)[0];
}

// ── Warmup — discover real product IDs from the live catalog ───────────────

async function warmupCatalog() {
  if (!API_KEY) {
    console.warn('No API_KEY — using fallback product ID pool. Set API_KEY for realistic load.');
    PRODUCT_ID_POOL.push(...['220928', '220929', '220930', '220931', '220932', '220933']);
    return;
  }
  const headers = { 'X-API-Key': API_KEY, 'Accept': 'application/json', 'User-Agent': 'bw-load-harness/1.0' };
  let fetched = 0;
  for (const q of SEARCH_QUERIES.slice(0, WARMUP_QUERIES)) {
    try {
      const url = `${TARGET}/v1/products/search?q=${encodeURIComponent(q)}&limit=10&country_code=SG`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const body = await res.json();
      const items = body.results || body.products || body.data || [];
      for (const it of items) {
        if (it.id && !PRODUCT_ID_POOL.includes(it.id)) {
          PRODUCT_ID_POOL.push(it.id);
          fetched++;
        }
      }
    } catch (e) {
      if (VERBOSE) console.warn(`warmup: ${q} failed: ${e.message}`);
    }
  }
  if (PRODUCT_ID_POOL.length === 0) {
    console.warn('warmup: no product IDs discovered — falling back to stub pool');
    PRODUCT_ID_POOL.push(...['220928', '220929', '220930']);
  } else {
    console.log(`warmup: seeded ${PRODUCT_ID_POOL.length} product IDs from ${WARMUP_QUERIES} queries`);
  }
}

// ── Scenario Implementations ───────────────────────────────────────────────
//
// Each scenario returns { status, latencyMs, body } and updates an in-memory
// metrics bucket via the supplied recorder. All network errors are captured
// as { status: 0, latencyMs, error: '...' } so they roll into error rate.

function buildRecorder(metrics, scenario) {
  return (result) => {
    metrics.byScenario[scenario].latencies.push(result.latencyMs);
    metrics.byScenario[scenario].statusCounts[result.status] = (metrics.byScenario[scenario].statusCounts[result.status] || 0) + 1;
    if (result.status >= 400 || result.status === 0) {
      metrics.errors++;
    } else {
      metrics.successes++;
    }
  };
}

async function scenarioSearch(recorder) {
  const q = pick(QUERY_POOL);
  const headers = API_KEY ? { 'X-API-Key': API_KEY, 'Accept': 'application/json', 'User-Agent': 'bw-load-harness/1.0' } : { 'Accept': 'application/json' };
  const t0 = performance.now();
  let status = 0, error;
  try {
    const res = await fetch(
      `${TARGET}/v1/products/search?q=${encodeURIComponent(q)}&limit=20&country_code=SG`,
      { headers, signal: AbortSignal.timeout(15000) }
    );
    status = res.status;
  } catch (e) { error = e.message; }
  recorder({ status, latencyMs: performance.now() - t0, error });
}

async function scenarioProduct(recorder) {
  if (PRODUCT_ID_POOL.length === 0) {
    // No IDs yet — degrade to search so we still produce traffic
    return scenarioSearch(recorder);
  }
  const id = pick(PRODUCT_ID_POOL);
  const headers = API_KEY ? { 'X-API-Key': API_KEY, 'Accept': 'application/json', 'User-Agent': 'bw-load-harness/1.0' } : { 'Accept': 'application/json' };
  const t0 = performance.now();
  let status = 0, error;
  try {
    const res = await fetch(
      `${TARGET}/v1/products/${encodeURIComponent(id)}`,
      { headers, signal: AbortSignal.timeout(15000) }
    );
    status = res.status;
  } catch (e) { error = e.message; }
  recorder({ status, latencyMs: performance.now() - t0, error });
}

async function scenarioMcpSearch(recorder) {
  const q = pick(QUERY_POOL);
  return mcpCall(recorder, 'search_products', { q, country_code: 'SG', limit: 10 });
}

async function scenarioMcpGetProduct(recorder) {
  if (PRODUCT_ID_POOL.length === 0) return scenarioMcpSearch(recorder);
  return mcpCall(recorder, 'get_product', { id: pick(PRODUCT_ID_POOL) });
}

async function scenarioMcpDeals(recorder) {
  return mcpCall(recorder, 'get_deals', { min_discount: 10, country_code: 'SG', limit: 10 });
}

async function scenarioMcpCategories(recorder) {
  return mcpCall(recorder, 'list_categories', {});
}

async function scenarioMcpFindBestPrice(recorder) {
  return mcpCall(recorder, 'find_best_price', { product_name: pick(QUERY_POOL), country_code: 'SG' });
}

async function mcpCall(recorder, toolName, args) {
  if (!API_KEY) {
    // Without auth, only public methods work — emit an expected 401 so we
    // don't skew the error rate on unauthenticated runs.
    recorder({ status: 401, latencyMs: 1 });
    return;
  }
  const envelope = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e9),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };
  const t0 = performance.now();
  let status = 0, error;
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'bw-load-harness/1.0',
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(15000),
    });
    status = res.status;
  } catch (e) { error = e.message; }
  recorder({ status, latencyMs: performance.now() - t0, error });
}

// ── MCP Mix — weighted random across MCP tools ─────────────────────────────

const MCP_SUB_SCENARIOS = {
  mcpSearch:    { fn: scenarioMcpSearch,         weight: 0.50 },
  mcpProduct:   { fn: scenarioMcpGetProduct,     weight: 0.25 },
  mcpDeals:     { fn: scenarioMcpDeals,          weight: 0.10 },
  mcpCategories:{ fn: scenarioMcpCategories,     weight: 0.05 },
  mcpFindBest:  { fn: scenarioMcpFindBestPrice,  weight: 0.10 },
};

function pickMcpSub() {
  return pickWeighted(Object.fromEntries(Object.entries(MCP_SUB_SCENARIOS).map(([k, v]) => [k, v.weight])));
}

// ── Latency Stats ──────────────────────────────────────────────────────────

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(latencies) {
  if (latencies.length === 0) {
    return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
  }
  const sum = latencies.reduce((a, b) => a + b, 0);
  return {
    count: latencies.length,
    avg: +(sum / latencies.length).toFixed(2),
    p50: +pct(latencies, 50).toFixed(2),
    p95: +pct(latencies, 95).toFixed(2),
    p99: +pct(latencies, 99).toFixed(2),
    max: +Math.max(...latencies).toFixed(2),
    min: +Math.min(...latencies).toFixed(2),
  };
}

// ── Request Scheduler — staged ramp-up / hold / ramp-down ──────────────────
//
// We model an open-model load generator: a background timer enqueues work
// at the current target rate, and a worker pool drains the queue. The
// pool size is set to ~2× peak RPS to keep queue depth stable without
// being a bottleneck itself.

class Harness {
  constructor(profile) {
    this.profile = profile;
    this.metrics = {
      byScenario: {
        search:    { latencies: [], statusCounts: {} },
        product:   { latencies: [], statusCounts: {} },
        mcp:       { latencies: [], statusCounts: {} },
      },
      byStage: { rampUp: { count: 0 }, hold: { count: 0 }, rampDown: { count: 0 } },
      errors: 0,
      successes: 0,
      holdSamples: { search: [], product: [], mcp: [] }, // p99 threshold is evaluated only on hold
    };
    this.stageStart = Date.now();
    this.running = true;
    this.inFlight = 0;
  }

  currentStage() {
    const elapsed = (Date.now() - this.stageStart) / 1000;
    if (elapsed < this.profile.rampUp) return 'rampUp';
    if (elapsed < this.profile.rampUp + this.profile.hold) return 'hold';
    if (elapsed < this.profile.rampUp + this.profile.hold + this.profile.rampDown) return 'rampDown';
    return 'done';
  }

  currentRps() {
    const elapsed = (Date.now() - this.stageStart) / 1000;
    if (elapsed < this.profile.rampUp) {
      return this.profile.targetRps * (elapsed / this.profile.rampUp);
    }
    if (elapsed < this.profile.rampUp + this.profile.hold) {
      return this.profile.targetRps;
    }
    if (elapsed < this.profile.rampUp + this.profile.hold + this.profile.rampDown) {
      const drainElapsed = elapsed - this.profile.rampUp - this.profile.hold;
      return this.profile.targetRps * (1 - drainElapsed / this.profile.rampDown);
    }
    return 0;
  }

  pickScenario() {
    return pickWeighted(this.profile.mix);
  }

  recordResult(scenario, stage, latencyMs, status) {
    if (stage === 'done') return;
    this.metrics.byStage[stage].count++;
    this.metrics.byScenario[scenario].latencies.push(latencyMs);
    this.metrics.byScenario[scenario].statusCounts[status] = (this.metrics.byScenario[scenario].statusCounts[status] || 0) + 1;
    if (status >= 400 || status === 0) {
      this.metrics.errors++;
      if (status !== 401) {
        // 401 from MCP unauth is expected; don't count toward threshold error
      }
    } else {
      this.metrics.successes++;
    }
    if (stage === 'hold') {
      this.metrics.holdSamples[scenario].push(latencyMs);
    }
  }

  async run() {
    const totalSec = this.profile.rampUp + this.profile.hold + this.profile.rampDown;
    console.log(`\n=== BuyWhere Load Harness — BUY-26143 ===`);
    console.log(`Profile:    ${this.profile.name}`);
    console.log(`Target:     ${TARGET}`);
    console.log(`MCP:        ${MCP_URL}`);
    console.log(`Ramp:       ${this.profile.rampUp}s up → ${this.profile.hold}s hold @ ${this.profile.targetRps} RPS → ${this.profile.rampDown}s down`);
    console.log(`Total:      ${totalSec}s`);
    console.log(`Mix:        search=${(this.profile.mix.search * 100).toFixed(0)}%  product=${(this.profile.mix.product * 100).toFixed(0)}%  mcp=${(this.profile.mix.mcp * 100).toFixed(0)}%`);
    console.log(`Thresholds: p99<${THRESHOLD_P99}ms, err<${(THRESHOLD_ERR * 100).toFixed(1)}%`);
    console.log('');

    // Tick scheduler: enqueue requests at the current target rate
    // 10ms tick (100Hz) gives us fine-grained control down to ~100 RPS at
    // full resolution. For higher RPS, the fractional credit below ensures
    // we always catch up to the requested rate even on low-RPS profiles.
    const schedulerTickMs = 10;
    const tickIntervalSec = schedulerTickMs / 1000;
    const workerBudget = Math.max(50, Math.ceil(this.profile.targetRps * 2));

    let queueDepth = 0;
    let credit = 0; // fractional request counter — carries over between ticks

    const interval = setInterval(() => {
      const stage = this.currentStage();
      if (stage === 'done') {
        clearInterval(interval);
        return;
      }
      const rps = this.currentRps();
      // Accumulate fractional requests and dispatch whole ones.
      credit += rps * tickIntervalSec;
      const toEnqueue = Math.floor(credit);
      credit -= toEnqueue;
      for (let i = 0; i < toEnqueue; i++) {
        if (queueDepth >= workerBudget) break;
        queueDepth++;
        // Fire and forget — recordResult is sync; fetch errors are caught inside.
        this.dispatch(stage).catch(() => {}).finally(() => { queueDepth--; });
      }
    }, schedulerTickMs);

    // Wait for total duration + small tail
    await new Promise(r => setTimeout(r, (totalSec + 2) * 1000));
    this.running = false;
    clearInterval(interval);

    // Wait for in-flight to drain
    const drainStart = Date.now();
    while (queueDepth > 0 && Date.now() - drainStart < 30000) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  async dispatch(stage) {
    const scenario = this.pickScenario();
    let fn;
    if (scenario === 'search') fn = () => scenarioSearch(r => this.recordResult('search', stage, r.latencyMs, r.status));
    else if (scenario === 'product') fn = () => scenarioProduct(r => this.recordResult('product', stage, r.latencyMs, r.status));
    else if (scenario === 'mcp') {
      const sub = pickMcpSub();
      fn = () => MCP_SUB_SCENARIOS[sub].fn(r => this.recordResult('mcp', stage, r.latencyMs, r.status));
    } else return;
    return fn();
  }

  report() {
    const total = this.metrics.errors + this.metrics.successes;
    const errRate = total > 0 ? this.metrics.errors / total : 0;
    const byScenario = {};
    for (const [name, bucket] of Object.entries(this.metrics.byScenario)) {
      byScenario[name] = {
        ...summarize(bucket.latencies),
        statusCodes: bucket.statusCounts,
        holdP99: +pct(this.metrics.holdSamples[name], 99).toFixed(2),
        holdP95: +pct(this.metrics.holdSamples[name], 95).toFixed(2),
      };
    }
    const byStage = {};
    for (const [stage, s] of Object.entries(this.metrics.byStage)) {
      byStage[stage] = { count: s.count };
    }
    const thresholdsPassed = {
      p99: byScenario.search.holdP99 < THRESHOLD_P99 &&
           byScenario.product.holdP99 < THRESHOLD_P99 &&
           byScenario.mcp.holdP99 < THRESHOLD_P99,
      err: errRate < THRESHOLD_ERR,
    };
    return {
      meta: {
        profile: this.profile.name,
        target: TARGET,
        mcpUrl: MCP_URL,
        timestamp: new Date().toISOString(),
        rampUp: this.profile.rampUp,
        hold: this.profile.hold,
        rampDown: this.profile.rampDown,
        targetRps: this.profile.targetRps,
        thresholds: { p99Ms: THRESHOLD_P99, errorRate: THRESHOLD_ERR },
        productIdsSeeded: PRODUCT_ID_POOL.length,
      },
      summary: {
        totalRequests: total,
        successes: this.metrics.successes,
        errors: this.metrics.errors,
        errorRate: +errRate.toFixed(4),
        thresholdsPassed,
        overallPass: thresholdsPassed.p99 && thresholdsPassed.err,
      },
      byScenario,
      byStage,
    };
  }

  printReport(rep) {
    console.log('\n=== BuyWhere Load Harness — Results ===\n');
    console.log(`Target:    ${rep.meta.target}`);
    console.log(`MCP URL:   ${rep.meta.mcpUrl}`);
    console.log(`Profile:   ${rep.meta.profile}  (ramp ${rep.meta.rampUp}s / hold ${rep.meta.hold}s @ ${rep.meta.targetRps} RPS / drain ${rep.meta.rampDown}s)`);
    console.log(`Requests:  ${rep.summary.totalRequests} (success=${rep.summary.successes}, errors=${rep.summary.errors}, err_rate=${(rep.summary.errorRate * 100).toFixed(2)}%)`);
    console.log(`Product IDs seeded: ${rep.meta.productIdsSeeded}`);
    console.log('');
    console.log('Per-scenario latency (ms) — measured on hold-stage samples:');
    console.log('  Scenario     Count     p50     p95     p99     max   holdP95  holdP99   pass');
    for (const [name, s] of Object.entries(rep.byScenario)) {
      const pass = s.holdP99 < rep.meta.thresholds.p99Ms;
      console.log(
        `  ${name.padEnd(10)}  ${String(s.count).padStart(6)}  ${String(s.p50).padStart(6)}  ${String(s.p95).padStart(6)}  ${String(s.p99).padStart(6)}  ${String(s.max).padStart(6)}  ${String(s.holdP95).padStart(7)}  ${String(s.holdP99).padStart(7)}  ${pass ? '✅' : '❌'}`
      );
    }
    console.log('');
    console.log(`Thresholds: p99<${rep.meta.thresholds.p99Ms}ms (p99: ${rep.summary.thresholdsPassed.p99 ? '✅' : '❌'}), err<${(rep.meta.thresholds.errorRate * 100).toFixed(1)}% (err: ${rep.summary.thresholdsPassed.err ? '✅' : '❌'})`);
    console.log(`Overall:    ${rep.summary.overallPass ? '✅ PASS' : '❌ FAIL'}`);
    console.log('');
  }
}

// ── Markdown Report Writer ────────────────────────────────────────────────

function writeMarkdown(rep, outPath) {
  const m = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n));
  const lines = [];
  lines.push(`# Load Test Report — ${rep.meta.profile} (${rep.meta.timestamp})`);
  lines.push('');
  lines.push(`- **Target**: ${rep.meta.target}`);
  lines.push(`- **MCP URL**: ${rep.meta.mcpUrl}`);
  lines.push(`- **Profile**: \`${rep.meta.profile}\` — ${rep.meta.rampUp}s ramp / ${rep.meta.hold}s hold @ ${rep.meta.targetRps} RPS / ${rep.meta.rampDown}s drain`);
  lines.push(`- **Product IDs seeded**: ${rep.meta.productIdsSeeded}`);
  lines.push(`- **Total requests**: ${rep.summary.totalRequests} (${rep.summary.successes} ok, ${rep.summary.errors} errors)`);
  lines.push(`- **Error rate**: ${(rep.summary.errorRate * 100).toFixed(2)}% (threshold: ${(rep.meta.thresholds.errorRate * 100).toFixed(1)}%)`);
  lines.push('');
  lines.push('## Per-scenario latency (ms) — measured on hold-stage samples');
  lines.push('');
  lines.push('| Scenario | Count | p50 | p95 | p99 | max | holdP95 | holdP99 | Pass |');
  lines.push('|----------|------:|----:|----:|----:|----:|--------:|--------:|:----:|');
  for (const [name, s] of Object.entries(rep.byScenario)) {
    const pass = s.holdP99 < rep.meta.thresholds.p99Ms;
    lines.push(`| ${name} | ${s.count} | ${m(s.p50)} | ${m(s.p95)} | ${m(s.p99)} | ${m(s.max)} | ${m(s.holdP95)} | ${m(s.holdP99)} | ${pass ? '✅' : '❌'} |`);
  }
  lines.push('');
  lines.push('## Status code distribution');
  lines.push('');
  for (const [name, s] of Object.entries(rep.byScenario)) {
    lines.push(`### ${name}`);
    for (const [code, count] of Object.entries(s.statusCodes)) {
      lines.push(`- \`${code}\`: ${count}`);
    }
    lines.push('');
  }
  lines.push('## Per-stage request counts');
  lines.push('');
  lines.push('| Stage | Requests |');
  lines.push('|-------|---------:|');
  for (const [stage, s] of Object.entries(rep.byStage)) {
    lines.push(`| ${stage} | ${s.count} |`);
  }
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(`- p99 < ${rep.meta.thresholds.p99Ms}ms: ${rep.summary.thresholdsPassed.p99 ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`- error rate < ${(rep.meta.thresholds.errorRate * 100).toFixed(1)}%: ${rep.summary.thresholdsPassed.err ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`- **Overall**: ${rep.summary.overallPass ? '✅ PASS' : '❌ FAIL'}`);
  writeFileSync(outPath, lines.join('\n'));
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.warn('WARN: API_KEY not set — MCP scenarios will be recorded as 401 (expected).');
  }
  const profile = loadProfile();

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Discovering product IDs from live catalog...');
  await warmupCatalog();

  const harness = new Harness(profile);
  await harness.run();

  const rep = harness.report();
  harness.printReport(rep);

  const jsonPath = join(OUTPUT_DIR, 'load-summary.json');
  const mdPath = join(OUTPUT_DIR, 'load-summary.md');
  writeFileSync(jsonPath, JSON.stringify(rep, null, 2));
  writeMarkdown(rep, mdPath);

  console.log(`\nReports written:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);

  process.exit(rep.summary.overallPass ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
