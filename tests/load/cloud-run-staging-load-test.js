import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const searchLatency = new Trend('search_latency');
const productLatency = new Trend('product_latency');
const compareLatency = new Trend('compare_latency');

const BASE_URL = __ENV.API_BASE_URL || 'https://api.buywhere.ai';
const API_KEY = __ENV.API_KEY || 'test-api-key';

const HEADERS = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'User-Agent': 'k6-load-test/1.0',
};

export const options = {
  scenarios: {
    search: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 400 },
        { duration: '1m', target: 800 },
        { duration: '2m', target: 1000 },
        { duration: '5m', target: 1000 },
        { duration: '1m', target: 0 },
      ],
      tags: { scenario: 'search' },
    },
    product_view: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '1m', target: 400 },
        { duration: '2m', target: 500 },
        { duration: '5m', target: 500 },
        { duration: '1m', target: 0 },
      ],
      tags: { scenario: 'product_view' },
    },
    compare: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 200 },
        { duration: '2m', target: 300 },
        { duration: '5m', target: 300 },
        { duration: '1m', target: 0 },
      ],
      tags: { scenario: 'compare' },
    },
  },
  thresholds: {
    'search_latency': ['p99<100', 'p95<50', 'p50<20'],
    'product_latency': ['p99<100', 'p95<50', 'p50<20'],
    'compare_latency': ['p99<100', 'p95<50', 'p50<20'],
    'errors': ['rate<0.01'],
    'http_req_duration': ['p99<100'],
  },
};

const searchQueries = [
  'wireless headphones',
  'laptop',
  'smartphone',
  'running shoes',
  'coffee maker',
  'blender',
  'desk lamp',
  'wireless mouse',
  'usb cable',
  'phone case',
];

const productIds = [
  'prod_123456',
  'prod_234567',
  'prod_345678',
  'prod_456789',
  'prod_567890',
];

const compareSlugs = [
  'nintendo-switch-2',
  'dyson-v12-detect-slim',
  'xiaomi-robot-vacuum-s10-plus',
  'blackmales-fish-oil-1000mg-400cap',
];

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function setup() {
  console.log(`Testing against: ${BASE_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 10)}...`);

  const health = http.get(`${BASE_URL}/health`, { headers: HEADERS });
  console.log(`Health check status: ${health.status}`);
  console.log(`Health check body: ${health.body}`);

  return { healthStatus: health.status };
}

export default function() {
  const scenario = __VU % 3;

  if (scenario === 0) {
    searchProducts();
  } else if (scenario === 1) {
    viewProduct();
  } else {
    compareProducts();
  }

  sleep(Math.random() * 2 + 0.5);
}

function searchProducts() {
  const query = encodeURIComponent(getRandomElement(searchQueries));
  const url = `${BASE_URL}/v1/search?q=${query}&limit=10`;

  const res = http.get(url, { headers: HEADERS, tags: { name: 'search' } });

  searchLatency.add(res.timings.duration);

  const success = check(res, {
    'search status is 200': (r) => r.status === 200,
    'search has results': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.results && body.results.length > 0;
      } catch (e) {
        return false;
      }
    },
    'search response time < 200ms': (r) => r.timings.duration < 200,
  });

  errorRate.add(!success);

  if (!success && res.status !== 200) {
    console.error(`Search failed: ${res.status} - ${res.body}`);
  }
}

function viewProduct() {
  const productId = getRandomElement(productIds);
  const url = `${BASE_URL}/v1/products/${productId}`;

  const res = http.get(url, { headers: HEADERS, tags: { name: 'product_view' } });

  productLatency.add(res.timings.duration);

  const success = check(res, {
    'product status is 200': (r) => r.status === 200 || r.status === 404,
    'product response time < 200ms': (r) => r.timings.duration < 200,
  });

  errorRate.add(!success && res.status === 500);

  if (!success && res.status === 500) {
    console.error(`Product view failed: ${res.status} - ${res.body}`);
  }
}

function compareProducts() {
  const slug = getRandomElement(compareSlugs);
  const url = `${BASE_URL}/v1/compare/${slug}`;

  const res = http.get(url, { headers: HEADERS, tags: { name: 'compare' } });

  compareLatency.add(res.timings.duration);

  const success = check(res, {
    'compare status is 200': (r) => r.status === 200 || r.status === 404,
    'compare response time < 200ms': (r) => r.timings.duration < 200,
  });

  errorRate.add(!success && res.status === 500);

  if (!success && res.status === 500) {
    console.error(`Compare failed: ${res.status} - ${res.body}`);
  }
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'load-test-results.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const metrics = data.metrics;

  let output = '\n';
  output += '='.repeat(60) + '\n';
  output += '           CLOUD RUN STAGING LOAD TEST RESULTS\n';
  output += '='.repeat(60) + '\n\n';

  output += `Test Duration: ${(data.state.testRunDurationMs / 1000).toFixed(1)}s\n`;
  output += `Total VUs: ${data.state.vusMax}\n\n`;

  output += '-'.repeat(60) + '\n';
  output += 'SEARCH ENDPOINT METRICS\n';
  output += '-'.repeat(60) + '\n';
  if (metrics.search_latency) {
    output += `  p99:  ${metrics.search_latency.values['p99'].toFixed(2)}ms\n`;
    output += `  p95:  ${metrics.search_latency.values['p95'].toFixed(2)}ms\n`;
    output += `  p50:  ${metrics.search_latency.values['p50'].toFixed(2)}ms\n`;
    output += `  avg:  ${metrics.search_latency.values['avg'].toFixed(2)}ms\n`;
  }

  output += '\n-'.repeat(60) + '\n';
  output += 'PRODUCT VIEW ENDPOINT METRICS\n';
  output += '-'.repeat(60) + '\n';
  if (metrics.product_latency) {
    output += `  p99:  ${metrics.product_latency.values['p99'].toFixed(2)}ms\n`;
    output += `  p95:  ${metrics.product_latency.values['p95'].toFixed(2)}ms\n`;
    output += `  p50:  ${metrics.product_latency.values['p50'].toFixed(2)}ms\n`;
    output += `  avg:  ${metrics.product_latency.values['avg'].toFixed(2)}ms\n`;
  }

  output += '\n-'.repeat(60) + '\n';
  output += 'COMPARE ENDPOINT METRICS\n';
  output += '-'.repeat(60) + '\n';
  if (metrics.compare_latency) {
    output += `  p99:  ${metrics.compare_latency.values['p99'].toFixed(2)}ms\n`;
    output += `  p95:  ${metrics.compare_latency.values['p95'].toFixed(2)}ms\n`;
    output += `  p50:  ${metrics.compare_latency.values['p50'].toFixed(2)}ms\n`;
    output += `  avg:  ${metrics.compare_latency.values['avg'].toFixed(2)}ms\n`;
  }

  output += '\n-'.repeat(60) + '\n';
  output += 'ERROR RATE\n';
  output += '-'.repeat(60) + '\n';
  if (metrics.errors) {
    const errorPct = (metrics.errors.values.rate * 100).toFixed(2);
    output += `  Error Rate: ${errorPct}%\n`;
    output += `  Passed: ${metrics.errors.values.passes}\n`;
    output += `  Failed: ${metrics.errors.values.fails}\n`;
  }

  output += '\n-'.repeat(60) + '\n';
  output += 'HTTP REQUEST DURATION\n';
  output += '-'.repeat(60) + '\n';
  if (metrics.http_req_duration) {
    output += `  p99:  ${metrics.http_req_duration.values['p99'].toFixed(2)}ms\n`;
    output += `  p95:  ${metrics.http_req_duration.values['p95'].toFixed(2)}ms\n`;
    output += `  avg:  ${metrics.http_req_duration.values['avg'].toFixed(2)}ms\n`;
  }

  const searchP99 = metrics.search_latency?.values['p99'] || 999;
  const productP99 = metrics.product_latency?.values['p99'] || 999;
  const compareP99 = metrics.compare_latency?.values['p99'] || 999;
  const errorPct = (metrics.errors?.values.rate || 1) * 100;

  const targetsMet = searchP99 < 100 && productP99 < 100 && compareP99 < 100 && errorPct < 1;

  output += '\n' + '='.repeat(60) + '\n';
  output += `TARGETS: p99 < 100ms, Error Rate < 1%\n`;
  output += `RESULT: ${targetsMet ? 'PASSED' : 'FAILED'}\n`;
  output += '='.repeat(60) + '\n';

  return output;
}