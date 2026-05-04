import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

const API_BASE_URL = __ENV.K6_API_BASE_URL || 'http://localhost:8000';
const API_KEY = __ENV.K6_API_KEY || '';

const errorRate = new Rate('errors');
const latencyTrend = new Trend('latency_ms');

const authHeaders = API_KEY
  ? { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
  : {};

export let options = {
  stages: [
    { duration: '10s', target: 5 },
    { duration: '20s', target: 100 },
    { duration: '3m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'latency_ms': ['p(95)<300', 'p(99)<500'],
    'errors': ['rate<0.05'],
    'http_req_failed': ['rate<0.05'],
  },
};

export default function () {
  const base = API_BASE_URL.replace(/\/$/, '');
  const v1Headers = { ...authHeaders, 'User-Agent': 'k6-load-test/1.0' };

  http.get(`${base}/health`, { tags: { endpoint: '/health' } });
}
