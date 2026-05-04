import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

const API_BASE_URL = __ENV.K6_API_BASE_URL || 'http://localhost:8000';
const API_KEY = __ENV.K6_API_KEY || '';
const TARGET_VUS = 1000;
const DURATION = '5m';

const errorRate = new Rate('errors');
const latencyTrend = new Trend('latency_ms');

const authHeaders = API_KEY
  ? { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
  : {};

export let options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '30s', target: TARGET_VUS },
    { duration: DURATION, target: TARGET_VUS },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'latency_ms': ['p(95)<200', 'p(99)<300'],
    'errors': ['rate<0.01'],
    'http_req_failed': ['rate<0.01'],
  },
};

export default function () {
  const base = API_BASE_URL.replace(/\/$/, '');
  const v1Headers = { ...authHeaders, 'User-Agent': 'k6-load-test/1.0' };

  const searchRes = http.get(`${base}/products/search?q=headphones&country=SG&limit=20`, { headers: v1Headers, tags: { endpoint: '/products/search' } });
  errorRate.add(searchRes.status >= 400, { endpoint: '/products/search' });
  latencyTrend.add(searchRes.timings.duration);

  const productRes = http.get(`${base}/products/laptop-singapore`, { headers: v1Headers, tags: { endpoint: '/products/:slug' } });
  errorRate.add(productRes.status >= 400, { endpoint: '/products/:slug' });
  latencyTrend.add(productRes.timings.duration);

  const compareRes = http.get(`${base}/products/compare?ids=SG001,SG002,SG003`, { headers: v1Headers, tags: { endpoint: '/products/compare' } });
  errorRate.add(compareRes.status >= 400, { endpoint: '/products/compare' });
  latencyTrend.add(compareRes.timings.duration);

  const healthRes = http.get(`${base}/health`, { tags: { endpoint: '/health' } });
  errorRate.add(healthRes.status >= 400, { endpoint: '/health' });
  latencyTrend.add(healthRes.timings.duration);
}
