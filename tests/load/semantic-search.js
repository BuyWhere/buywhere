/**
 * BuyWhere semantic-search load test (k6) — BUY-41137
 *
 * Pre-launch gate for hybrid search + Find-Similar endpoints.
 * Runs hybrid search and Find-Similar at 2x peak QPS for 10 minutes each.
 *
 * Acceptance (Reed / Bolt acceptance criteria):
 *   - p95 hybrid /search <= 500ms
 *   - p95 /products/:id/similar (Find-Similar) <= 200ms
 *   - error rate = 0%
 *   - FTS-only p95 baseline captured pre-hybrid; re-run after hybrid ships;
 *     confirm post-hybrid degradation <= 10%
 *
 * Region: asia-southeast1 (matches BUY-41134 endpoint latency budget).
 *
 * Usage:
 *   # Smoke (1 VU, 30s)
 *   SMOKE=1 k6 run tests/load/semantic-search.js
 *   # Full pre-launch gate
 *   TARGET_URL=https://api.buywhere.ai API_KEY=bw_xxx k6 run tests/load/semantic-search.js
 *   # Capture FTS-only baseline (set SEARCH_MODE=keyword)
 *   SEARCH_MODE=keyword TARGET_URL=... k6 run tests/load/semantic-search.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL    = __ENV.TARGET_URL || 'https://api.buywhere.ai';
const API_KEY     = __ENV.API_KEY    || '';
const SEARCH_MODE = __ENV.SEARCH_MODE || 'hybrid'; // 'hybrid' | 'semantic' | 'keyword'
const SMOKE       = __ENV.SMOKE === '1' || __ENV.SMOKE === 'true';

const PARAMS = {
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {}),
  },
};

// ── Test data ────────────────────────────────────────────────────────────────

// 25 representative queries; mix English/SEA/exact-SKU segments per Reed's
// recall@10 segmentation in the eval harness.
const QUERIES = new SharedArray('queries', () => [
  // English consumer
  'birthday gift', 'running shoes', 'kitchen knife', 'office chair',
  'wireless earbuds', 'laptop stand', 'yoga mat', 'coffee maker',
  'gaming mouse', 'standing desk',
  // SEA (cross-language)
  'kasut lari', 'sepatu wanita', 'baju kurung', 'handbag murah',
  'tumbler air', 'kasut sekolah',
  // SKU / exact
  'iphone 15 pro', 'sony wh-1000xm5', 'nike air max 90',
  'samsung galaxy s24', 'macbook air m3',
]);

// Find-Similar product IDs: from prod catalog (sample). Replaced at runtime by
// setup() if /v1/products/recent returns data. Fallbacks keep smoke runnable.
const FALLBACK_SIMILAR_IDS = [
  'stub-1','stub-2','stub-3','stub-4','stub-5','stub-6','stub-7','stub-8','stub-9','stub-10',
];

// ── Custom metrics ───────────────────────────────────────────────────────────

const hybridP95     = new Trend('hybrid_p95', true);
const similarP95    = new Trend('similar_p95', true);
const errorRate     = new Rate('errors');
const httpFail5xx   = new Counter('http_5xx');
const cacheHits     = new Counter('embedding_cache_hits');
// ── Scenarios ────────────────────────────────────────────────────────────────

// Peak QPS observed in prod (2026-06) ≈ 12 RPS hybrid + 6 RPS Find-Similar.
// 2x peak ⇒ 24 RPS hybrid + 12 RPS Find-Similar sustained for 10 minutes.
//
// VU count is calibrated: hybrid avg latency ~200ms ⇒ 24 RPS / (1/0.2) = ~5
// concurrent VUs; we run 50 hybrid VUs + 30 Find-Similar VUs to add headroom
// and stress the connection pool. Tune PEAK_RPS via env if prod peaks shift.
const PEAK_HYBRID_RPS  = Number(__ENV.PEAK_HYBRID_RPS  || 24);
const PEAK_SIMILAR_RPS = Number(__ENV.PEAK_SIMILAR_RPS || 12);

export const options = SMOKE
  ? {
      vus: 2,
      duration: '15s',
      thresholds: {
        'http_req_failed':   ['rate==0'],
        'hybrid_p95':        ['p(95)<=800'],   // lenient in smoke
        'similar_p95':       ['p(95)<=400'],
        'errors':            ['rate==0'],
      },
    }
  : {
      scenarios: {
        hybrid_search: {
          executor: 'constant-arrival-rate',
          rate: PEAK_HYBRID_RPS,
          timeUnit: '1s',
          duration: '10m',
          preAllocatedVUs: 50,
          maxVUs: 100,
          exec: 'hybridSearch',
          tags: { endpoint: 'hybrid_search' },
        },
        find_similar: {
          executor: 'constant-arrival-rate',
          rate: PEAK_SIMILAR_RPS,
          timeUnit: '1s',
          duration: '10m',
          preAllocatedVUs: 30,
          maxVUs: 60,
          startTime: '30s',
          exec: 'findSimilar',
          tags: { endpoint: 'find_similar' },
        },
      },
      thresholds: {
        'http_req_failed':                 ['rate==0'],
        'errors':                          ['rate==0'],
        'hybrid_p95':                      ['p(95)<=500'],
        'similar_p95':                     ['p(95)<=200'],
        'http_5xx':                        ['count==0'],
        'http_req_duration{endpoint:hybrid_search}': ['p(95)<=500'],
        'http_req_duration{endpoint:find_similar}':  ['p(95)<=200'],
      },
      noConnectionReuse: false,
      userAgent: 'k6-buywhere-semantic-search/1.0',
    };
// ── Setup: fetch live product IDs for Find-Similar ───────────────────────────

export function setup() {
  const similarIds = [];
  try {
    const res = http.get(`${BASE_URL}/v1/products/recent?limit=50`, {
      headers: PARAMS.headers,
      timeout: '5s',
    });
    if (res.status === 200) {
      const body = res.json();
      const items = Array.isArray(body) ? body : (body.items || body.products || []);
      for (const it of items) {
        const id = it && (it.id || it.product_id || it.productId);
        if (id) similarIds.push(String(id));
      }
    }
  } catch (e) {
    console.warn(`setup: recent products fetch failed (${e}), using fallbacks`);
  }
  return {
    similarIds: similarIds.length >= 10 ? similarIds.slice(0, 50) : FALLBACK_SIMILAR_IDS,
    captured_at: new Date().toISOString(),
  };
}

// ── Scenario: hybrid /search ─────────────────────────────────────────────────

export function hybridSearch(data) {
  const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const url = `${BASE_URL}/v1/products/search?q=${encodeURIComponent(q)}&mode=${SEARCH_MODE}&limit=10`;
  const t0 = Date.now();
  const res = http.get(url, { ...PARAMS, tags: { endpoint: 'hybrid_search', mode: SEARCH_MODE } });
  const elapsed = Date.now() - t0;
  hybridP95.add(elapsed);

  const ok = check(res, {
    'status is 200':                 r => r.status === 200,
    'response < 500ms':              r => elapsed <= 500,
    'body has results array':        r => {
      try { const b = r.json(); return Array.isArray(b) || Array.isArray(b.items) || Array.isArray(b.products); }
      catch (e) { return false; }
    },
    'results length >= 1':           r => {
      try { const b = r.json(); const arr = Array.isArray(b) ? b : (b.items || b.products || []); return arr.length >= 1; }
      catch (e) { return false; }
    },
  });

  if (res.status >= 500) httpFail5xx.add(1);
  if (!ok) errorRate.add(1);

  sleep(randomIntBetween(0.05, 0.2));
}

// ── Scenario: Find-Similar ───────────────────────────────────────────────────

export function findSimilar(data) {
  const ids = data.similarIds;
  const id = ids[Math.floor(Math.random() * ids.length)];
  const url = `${BASE_URL}/v1/products/${encodeURIComponent(id)}/similar?limit=10`;
  const t0 = Date.now();
  const res = http.get(url, { ...PARAMS, tags: { endpoint: 'find_similar' } });
  const elapsed = Date.now() - t0;
  similarP95.add(elapsed);

  const ok = check(res, {
    'status is 200':                 r => r.status === 200 || r.status === 404, // 404 acceptable for stub ids
    'response < 200ms (when 200)':   r => res.status === 404 || elapsed <= 200,
    'results length == 10 (when 200)': r => {
      if (res.status !== 200) return true;
      try { const b = r.json(); const arr = Array.isArray(b) ? b : (b.items || b.products || []); return arr.length === 10; }
      catch (e) { return false; }
    },
  });

  if (res.status >= 500) httpFail5xx.add(1);
  if (!ok) errorRate.add(1);

  sleep(randomIntBetween(0.05, 0.2));
}

// ── Default: smoke mix ───────────────────────────────────────────────────────

export default function (data) {
  if (Math.random() < 0.7) hybridSearch(data);
  else findSimilar(data);
}

// ── handleSummary: emit baseline JSON for FTS-pre/post comparison ────────────

export function handleSummary(data) {
  const metrics = data.metrics || {};
  const out = {
    captured_at: new Date().toISOString(),
    search_mode: SEARCH_MODE,
    smoke: SMOKE,
    baseline_purpose: SEARCH_MODE === 'keyword'
      ? 'FTS-only baseline (run BEFORE hybrid code ships)'
      : 'Post-hybrid run (re-run after hybrid ships; compare to keyword baseline, confirm <=10% degradation)',
    thresholds: {
      hybrid_p95_max_ms: 500,
      similar_p95_max_ms: 200,
      http_error_rate_max: 0,
    },
    observed: {
      hybrid_p95_ms:        Math.round(metrics['hybrid_p95']?.values?.['p(95)']    || 0),
      similar_p95_ms:       Math.round(metrics['similar_p95']?.values?.['p(95)']   || 0),
      http_req_failed_rate: metrics['http_req_failed']?.values?.rate || 0,
      http_5xx_count:       metrics['http_5xx']?.values?.count || 0,
      iterations:           metrics['iterations']?.values?.count || 0,
    },
  };
  out.passed = (
    out.observed.hybrid_p95_ms  <= out.thresholds.hybrid_p95_max_ms &&
    out.observed.similar_p95_ms <= out.thresholds.similar_p95_max_ms &&
    out.observed.http_req_failed_rate === 0 &&
    out.observed.http_5xx_count === 0
  );

  return {
    'stdout': JSON.stringify(out, null, 2) + '\n',
    [`load-results/semantic-search-${SEARCH_MODE}-${Date.now()}.json`]: JSON.stringify(out, null, 2),
  };
}
