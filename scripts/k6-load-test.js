// scripts/k6-load-test.js
// k6 load test for BuyWhere API latency validation.
// Usage:
//   k6 run scripts/k6-load-test.js
//   K6_API_BASE_URL=https://staging... k6 run scripts/k6-load-test.js
//   K6_API_KEY=your_key K6_API_BASE_URL=https://api.buywhere.ai k6 run scripts/k6-load-test.js

import http from 'k6/http';
import { Rate, Trend, Counter } from 'k6/metrics';
import { check } from 'k6';

const API_BASE_URL = __ENV.K6_API_BASE_URL || 'http://localhost:8000';
const API_KEY = __ENV.K6_API_KEY || '';
const TARGET_VUS = parseInt(__ENV.K6_TARGET_VUS || '1000', 10);
const DURATION = __ENV.K6_DURATION || '5m';
const THRESHOLD_P95_MS = parseInt(__ENV.K6_THRESHOLD_P95_MS || '200', 10);
const THRESHOLD_P99_MS = parseInt(__ENV.K6_THRESHOLD_P99_MS || '300', 10);

const errorRate = new Rate('errors');
const latencyTrend = new Trend('latency_ms');
const apiLatencyTrend = new Trend('api_latency_ms');

const authHeaders = API_KEY
  ? { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
  : {};

function measureLatency(url, headers) {
  const start = Date.now();
  const res = http.get(url, { headers });
  const latency = Date.now() - start;
  latencyTrend.add(latency);
  return { res, latency };
}

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      tags: { type: 'smoke' },
    },
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: TARGET_VUS },
        { duration: DURATION, target: TARGET_VUS },
        { duration: '30s', target: 0 },
      ],
      tags: { type: 'load' },
    },
  },
  thresholds: {
    'latency_ms': ['p(95)<' + THRESHOLD_P95_MS, 'p(99)<' + THRESHOLD_P99_MS],
    'errors': ['rate<0.01'],
    'http_req_failed': ['rate<0.01'],
  },
};

export default function () {
  const base = API_BASE_URL.replace(/\/$/, '');
  const v1Headers = { ...authHeaders, 'User-Agent': 'k6-load-test/1.0' };

  // Scenario 1: Product search
  const searchRes = http.get(`${base}/v1/products/search?q=headphones&country=US&limit=20`, { headers: v1Headers, tags: { endpoint: '/v1/products/search' } });
  const searchOk = searchRes.status >= 200 && searchRes.status < 400;
  errorRate.add(!searchOk, { endpoint: '/v1/products/search' });
  measureLatency(`${base}/v1/products/search?q=headphones&country=US&limit=20`, v1Headers);

  // Scenario 2: Product page view (pick a known product ID)
  const productId = 'prod_SG_001';
  const productRes = http.get(`${base}/v1/products/${productId}`, { headers: v1Headers, tags: { endpoint: '/v1/products/:id' } });
  const productOk = productRes.status >= 200 && productRes.status < 400;
  errorRate.add(!productOk, { endpoint: '/v1/products/:id' });
  measureLatency(`${base}/v1/products/${productId}`, v1Headers);

  // Scenario 3: Price comparison
  const compareRes = http.get(`${base}/v1/products/compare?ids=prod_SG_001,prod_SG_002,prod_SG_003&country=US`, { headers: v1Headers, tags: { endpoint: '/v1/products/compare' } });
  const compareOk = compareRes.status >= 200 && compareRes.status < 400;
  errorRate.add(!compareOk, { endpoint: '/v1/products/compare' });
  measureLatency(`${base}/v1/products/compare?ids=prod_SG_001,prod_SG_002,prod_SG_003&country=US`, v1Headers);

  // Health checks - public endpoints
  const healthRes = http.get(`${base}/health`, { tags: { endpoint: '/health' } });
  const healthOk = healthRes.status >= 200 && healthRes.status < 400;
  errorRate.add(!healthOk, { endpoint: '/health' });

  const metricsRes = http.get(`${base}/demo/metrics`, { tags: { endpoint: '/demo/metrics' } });
  const metricsOk = metricsRes.status >= 200 && metricsRes.status < 400;
  errorRate.add(!metricsOk, { endpoint: '/demo/metrics' });

  const v1HealthRes = http.get(`${base}/v1/health`, { headers: v1Headers, tags: { endpoint: '/v1/health' } });
  const v1HealthOk = v1HealthRes.status >= 200 && v1HealthRes.status < 400;
  errorRate.add(!v1HealthOk, { endpoint: '/v1/health' });

  if (v1HealthRes.status === 401 && !API_KEY) {
    console.log('WARNING: /v1/health returned 401 — set K6_API_KEY env var to test authenticated endpoints');
  }

  if (__ENV.K6_VERBOSE === 'true') {
    console.log(`VU ${__VU} iter ${__ITER}: search=${searchRes.status} product=${productRes.status} compare=${compareRes.status} health=${healthRes.status}`);
  }
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'k6-summary.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data, opts) {
  const indent = opts.indent || '';
  const lines = [];
  lines.push('');
  lines.push('=== k6 Load Test Summary ===');
  lines.push(`Target: ${API_BASE_URL}`);
  lines.push(`VU count: ${TARGET_VUS}, Duration: ${DURATION}`);
  lines.push(`P95 threshold: ${THRESHOLD_P95_MS}ms, P99 threshold: ${THRESHOLD_P99_MS}ms`);
  lines.push('');

  const httpMetrics = data.metrics.http_req_duration;
  if (httpMetrics) {
    lines.push('HTTP Request Duration (ms):');
    lines.push(`  avg:     ${httpMetrics.valuesavg?.toFixed(2) || 'N/A'}`);
    lines.push(`  p(50):   ${httpMetrics.values['p(50)']?.toFixed(2) || 'N/A'}`);
    lines.push(`  p(95):   ${httpMetrics.values['p(95)']?.toFixed(2) || 'N/A'}`);
    lines.push(`  p(99):   ${httpMetrics.values['p(99)']?.toFixed(2) || 'N/A'}`);
    lines.push(`  max:     ${httpMetrics.valuesmax?.toFixed(2) || 'N/A'}`);
  }

  const latency = data.metrics.latency_ms;
  if (latency) {
    lines.push('');
    lines.push('API Latency (ms):');
    lines.push(`  avg:     ${latency.valuesavg?.toFixed(2) || 'N/A'}`);
    lines.push(`  p(50):   ${latency.values['p(50)']?.toFixed(2) || 'N/A'}`);
    lines.push(`  p(95):   ${latency.values['p(95)']?.toFixed(2) || 'N/A'}`);
    lines.push(`  p(99):   ${latency.values['p(99)']?.toFixed(2) || 'N/A'}`);
    lines.push(`  max:     ${latency.valuesmax?.toFixed(2) || 'N/A'}`);
  }

  const errors = data.metrics.errors;
  if (errors) {
    lines.push('');
    lines.push(`Error rate: ${(errors.valuesrate * 100).toFixed(2)}%`);
  }

  const passed = data.passed_thresholds ? 'PASSED' : 'FAILED';
  lines.push('');
  lines.push(`Result: ${passed}`);
  lines.push('');
  return lines.join('\n');
}