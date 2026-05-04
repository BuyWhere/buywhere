import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

const API_BASE_URL = __ENV.K6_API_BASE_URL || 'http://localhost:8000';
const API_KEY = __ENV.K6_API_KEY || '';

const errorRate = new Rate('errors');
const latencyTrend = new Trend('latency_ms');

const authHeaders = API_KEY
  ? { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
  : {};

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '30s', target: 1000 },
    { duration: '5m', target: 1000 },
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
  const headers = { ...authHeaders, 'User-Agent': 'k6-load-test/1.0' };

  const r1 = http.get(`${base}/health`, { headers, tags: { endpoint: '/health' } });
  latencyTrend.add(r1.timings.duration);
  errorRate.add(r1.status >= 400);

  const r2 = http.get(`${base}/products/search?q=headphones&country=SG&limit=10`, { headers, tags: { endpoint: '/products/search' } });
  latencyTrend.add(r2.timings.duration);
  errorRate.add(r2.status >= 400);
}
