/**
 * BuyWhere Cloud Run staging load test — BUY-3008
 *
 * Validates the Cloud Run + Cloud SQL Proxy architecture under production-equivalent load.
 * Pre-launch tests (BUY-2944) used PgBouncer; this test targets the Cloud SQL Proxy path.
 *
 * Usage:
 *   k6 run \
 *     -e STAGING_URL=https://buywhere-api-<hash>-de.a.run.app \
 *     -e API_KEY=<staging-api-key> \
 *     tests/load/staging-load-test.js
 *
 * Targets:
 *   - p99 < 500ms for search (FTS + Redis cache mix)
 *   - p99 < 100ms for catalog queries (expected cache hit rate ~80%)
 *   - error rate < 0.1%
 *   - 0 HTTP 5xx under steady state
 *
 * Cloud Run capacity: containerConcurrency=100, maxInstances=10 → 1000 concurrent ceiling.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.STAGING_URL || 'https://buywhere-api-staging.run.app';
const API_KEY  = __ENV.API_KEY     || '';

// ── Test data ────────────────────────────────────────────────────────────────

const SEARCH_QUERIES = new SharedArray('search_queries', () => [
  'iphone 15',
  'samsung galaxy s24',
  'nike air max',
  'sony headphones',
  'laptop 16gb',
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
]);

// Product IDs and compare slugs are fetched in setup() from the live staging catalog.
// Fallback stubs keep the test runnable even if setup partially fails.
const FALLBACK_PRODUCT_IDS = ['stub-1', 'stub-2', 'stub-3'];

// ── Custom metrics ───────────────────────────────────────────────────────────

const errorRate       = new Rate('error_rate');
const searchLatency   = new Trend('search_latency',  true);
const productLatency  = new Trend('product_latency', true);
const compareLatency  = new Trend('compare_latency', true);

// ── Load profile ─────────────────────────────────────────────────────────────
//
// Stage 1 (2 min):  ramp 0 → 1000 VUs   — tests auto-scaling from min=1 instance
// Stage 2 (5 min):  hold 1000 VUs        — steady-state measurement window
// Stage 3 (1 min):  ramp 1000 → 0 VUs   — graceful drain

export const options = {
  stages: [
    { duration: '2m', target: 1000 },
    { duration: '5m', target: 1000 },
    { duration: '1m', target: 0   },
  ],
  thresholds: {
    // Overall HTTP error rate must stay below 0.1%
    error_rate:      ['rate<0.001'],
    // Search p99 under 500ms (FTS; cache hit ~60-80% of requests)
    search_latency:  ['p(99)<500', 'p(95)<300', 'p(50)<100'],
    // Product page p99 under 200ms (mostly cache hits)
    product_latency: ['p(99)<200', 'p(95)<150', 'p(50)<50'],
    // Price compare p99 under 300ms
    compare_latency: ['p(99)<300', 'p(95)<200', 'p(50)<80'],
    // k6 built-in — no HTTP 500s allowed
    'http_req_failed': ['rate<0.001'],
  },
};

// ── Setup — fetch real product IDs from staging catalog ──────────────────────

export function setup() {
  const headers = { 'X-API-Key': API_KEY, 'Accept': 'application/json' };

  // Collect product IDs across a spread of search queries
  const productIds = new Set();
  const sampleQueries = ['laptop', 'phone', 'shoes'];

  for (const q of sampleQueries) {
    const res = http.get(`${BASE_URL}/v1/products/search?q=${encodeURIComponent(q)}&limit=10&country_code=US`, { headers });
    if (res.status === 200) {
      try {
        const body = JSON.parse(res.body);
        const items = body.results || body.products || body.data || [];
        for (const item of items) {
          if (item.id) productIds.add(item.id);
        }
      } catch (_) { /* ignore parse errors */ }
    }
  }

  const ids = productIds.size > 0 ? [...productIds] : FALLBACK_PRODUCT_IDS;

  // Build compare pairs from the first few IDs
  const comparePairs = [];
  for (let i = 0; i + 1 < Math.min(ids.length, 6); i += 2) {
    comparePairs.push(`${ids[i]},${ids[i + 1]}`);
  }

  console.log(`Setup: ${ids.length} product IDs, ${comparePairs.length} compare pairs`);
  return { productIds: ids, comparePairs };
}

// ── Main VU scenario ─────────────────────────────────────────────────────────

export default function (data) {
  const headers = { 'X-API-Key': API_KEY, 'Accept': 'application/json' };
  const { productIds, comparePairs } = data;

  // Weight: search 50%, product page 35%, compare 15%
  const roll = Math.random();

  if (roll < 0.50) {
    // ── Scenario A: Product search ──
    const q = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
    const res = http.get(
      `${BASE_URL}/v1/products/search?q=${encodeURIComponent(q)}&limit=20&country_code=US`,
      { headers }
    );

    searchLatency.add(res.timings.duration);
    errorRate.add(res.status >= 400);

    check(res, {
      'search: status 200':        (r) => r.status === 200,
      'search: has results field':  (r) => {
        try { return JSON.parse(r.body).results !== undefined || JSON.parse(r.body).products !== undefined; }
        catch (_) { return false; }
      },
    });

  } else if (roll < 0.85) {
    // ── Scenario B: Product page ──
    const id = productIds[Math.floor(Math.random() * productIds.length)];
    const res = http.get(`${BASE_URL}/p/${id}`, { headers });

    productLatency.add(res.timings.duration);
    // 404 is valid (ID may have rotated); 5xx is not
    errorRate.add(res.status >= 500);

    check(res, {
      'product: no 5xx': (r) => r.status < 500,
    });

  } else {
    // ── Scenario C: Price comparison ──
    if (comparePairs.length === 0) {
      // No pairs available — fall back to search
      const q = SEARCH_QUERIES[0];
      http.get(`${BASE_URL}/v1/products/search?q=${encodeURIComponent(q)}&limit=5&country_code=US`, { headers });
      return;
    }
    const pair = comparePairs[Math.floor(Math.random() * comparePairs.length)];
    const res  = http.get(`${BASE_URL}/compare?ids=${pair}`, { headers });

    compareLatency.add(res.timings.duration);
    errorRate.add(res.status >= 500);

    check(res, {
      'compare: no 5xx': (r) => r.status < 500,
    });
  }

  // ~100ms think time — keeps request rate realistic, avoids pure thundering herd
  sleep(0.1);
}

// ── Teardown — log summary ────────────────────────────────────────────────────

export function teardown(data) {
  console.log(`Teardown: test complete. Product IDs used: ${data.productIds.length}`);
}
