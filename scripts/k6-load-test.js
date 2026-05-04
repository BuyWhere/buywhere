import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import { check } from 'k6';

const API_BASE_URL = __ENV.K6_API_BASE_URL || 'http://localhost:8000';
const API_KEY = __ENV.K6_API_KEY || '';
const TARGET_VUS = parseInt(__ENV.K6_TARGET_VUS || '1000', 10);
const DURATION = __ENV.K6_DURATION || '5m';
const THRESHOLD_P95_MS = parseInt(__ENV.K6_THRESHOLD_P95_MS || '200', 10);
const THRESHOLD_P99_MS = parseInt(__ENV.K6_THRESHOLD_P99_MS || '300', 10);

const errorRate = new Rate('errors');
const latencyTrend = new Trend('latency_ms');

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

export let options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '30s', target: TARGET_VUS },
    { duration: DURATION, target: TARGET_VUS },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'latency_ms': ['p(95)<' + THRESHOLD_P95_MS, 'p(99)<' + THRESHOLD_P99_MS],
    'errors': ['rate<0.01'],
    'http_req_failed': ['rate<0.01'],
  },
};

export default function () {
  const base = API_BASE_URL.replace(/\/$/, '');
  const v1Headers = { ...authHeaders, 'User-Agent': 'k6-load-test/1.0' };

  const searchRes = http.get(`${base}/products/search?q=headphones&country=SG&limit=20`, { headers: v1Headers, tags: { endpoint: '/products/search' } });
  errorRate.add(searchRes.status >= 400, { endpoint: '/products/search' });
  measureLatency(`${base}/products/search?q=headphones&country=SG&limit=20`, v1Headers);

  const productRes = http.get(`${base}/products/laptop-singapore`, { headers: v1Headers, tags: { endpoint: '/products/:slug' } });
  errorRate.add(productRes.status >= 400, { endpoint: '/products/:slug' });
  measureLatency(`${base}/products/laptop-singapore`, v1Headers);

  const compareRes = http.get(`${base}/products/compare?ids=SG001,SG002,SG003`, { headers: v1Headers, tags: { endpoint: '/products/compare' } });
  errorRate.add(compareRes.status >= 400, { endpoint: '/products/compare' });
  measureLatency(`${base}/products/compare?ids=SG001,SG002,SG003`, v1Headers);

  const healthRes = http.get(`${base}/health`, { tags: { endpoint: '/health' } });
  errorRate.add(healthRes.status >= 400, { endpoint: '/health' });
}
