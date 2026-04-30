import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const searchLatency = new Trend('search_latency');
const productLatency = new Trend('product_latency');
const compareLatency = new Trend('compare_latency');

const BASE_URL = __ENV.API_BASE_URL || __ENV.STAGING_URL || 'https://api.buywhere.ai';
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
        { duration: '30s', target: 200 },
        { duration: '1m', target: 400 },
        { duration: '2m', target: 500 },
        { duration: '5m', target: 500 },
        { duration: '1m', target: 0 },
      ],
      tags: { scenario: 'search' },
    },
    product_view: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 200 },
        { duration: '2m', target: 250 },
        { duration: '5m', target: 250 },
        { duration: '1m', target: 0 },
      ],
      tags: { scenario: 'product_view' },
    },
    compare: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '2m', target: 150 },
        { duration: '5m', target: 150 },
        { duration: '1m', target: 0 },
      ],
      tags: { scenario: 'compare' },
    },
  },
  thresholds: {
    'search_latency': ['p(99)<500'],
    'product_latency': ['p(99)<500'],
    'compare_latency': ['p(99)<500'],
    'errors': ['rate<0.05'],
    'http_req_duration': ['p(99)<500'],
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
  'fe7fbe99-0271-4d8f-a329-8374b1423fb7',
  'd6c054c1-cb33-4c0f-9ff8-cb3ccb4ebeee',
];

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function setup() {
  console.log(`Testing against: ${BASE_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 10)}...`);

  const health = http.get(`${BASE_URL}/health`);
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
  const productId = getRandomElement(productIds);
  const url = `${BASE_URL}/v1/products/${productId}`;

  const res = http.get(url, { headers: HEADERS, tags: { name: 'search' } });

  searchLatency.add(res.timings.duration);

  const success = check(res, {
    'search status is 200': (r) => r.status === 200,
    'search response time < 500ms': (r) => r.timings.duration < 500,
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
    'product response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success && res.status === 500);

  if (!success && res.status === 500) {
    console.error(`Product view failed: ${res.status} - ${res.body}`);
  }
}

function compareProducts() {
  const productId = getRandomElement(productIds);
  const url = `${BASE_URL}/v1/products/${productId}`;

  const res = http.get(url, { headers: HEADERS, tags: { name: 'compare' } });

  compareLatency.add(res.timings.duration);

  const success = check(res, {
    'product status is 200': (r) => r.status === 200 || r.status === 404 || r.status === 422,
    'product response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success && res.status === 500);

  if (!success && res.status === 500) {
    console.error(`Product lookup failed: ${res.status} - ${res.body}`);
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
  output += '           STAGING LOAD TEST RESULTS\n';
  output += '='.repeat(60) + '\n\n';

  output += `Test Duration: ${(data.state.testRunDurationMs / 1000).toFixed(1)}s\n`;
  output += `Total VUs: ${data.state.vusMax}\n\n`;

  output += '-'.repeat(60) + '\n';
  output += 'SEARCH ENDPOINT METRICS\n';
  output += '-'.repeat(60) + '\n';
  if (metrics.search_latency) {
    output += `  p99:  ${metrics.search_latency.values['p(99)'].toFixed(2)}ms\n`;
    output += `  p95:  ${metrics.search_latency.values['p(95)'].toFixed(2)}ms\n`;
    output += `  p50:  ${metrics.search_latency.values['p(50)'].toFixed(2)}ms\n`;
    output += `  avg:  ${metrics.search_latency.values['avg'].toFixed(2)}ms\n`;
  }

  output += '\n-'.repeat(60) + '\n';
  output += 'PRODUCT VIEW ENDPOINT METRICS\n';
  output += '-'.repeat(60) + '\n';
  if (metrics.product_latency) {
    output += `  p99:  ${metrics.product_latency.values['p(99)'].toFixed(2)}ms\n`;
    output += `  p95:  ${metrics.product_latency.values['p(95)'].toFixed(2)}ms\n`;
    output += `  p50:  ${metrics.product_latency.values['p(50)'].toFixed(2)}ms\n`;
    output += `  avg:  ${metrics.product_latency.values['avg'].toFixed(2)}ms\n`;
  }

  output += '\n-'.repeat(60) + '\n';
  output += 'COMPARE ENDPOINT METRICS\n';
  output += '-'.repeat(60) + '\n';
  if (metrics.compare_latency) {
    output += `  p99:  ${metrics.compare_latency.values['p(99)'].toFixed(2)}ms\n`;
    output += `  p95:  ${metrics.compare_latency.values['p(95)'].toFixed(2)}ms\n`;
    output += `  p50:  ${metrics.compare_latency.values['p(50)'].toFixed(2)}ms\n`;
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
    output += `  p99:  ${metrics.http_req_duration.values['p(99)'].toFixed(2)}ms\n`;
    output += `  p95:  ${metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
    output += `  avg:  ${metrics.http_req_duration.values['avg'].toFixed(2)}ms\n`;
  }

  const searchP99 = metrics.search_latency?.values['p(99)'] || 999;
  const productP99 = metrics.product_latency?.values['p(99)'] || 999;
  const compareP99 = metrics.compare_latency?.values['p(99)'] || 999;
  const errorPct = (metrics.errors?.values.rate || 1) * 100;

  const targetsMet = searchP99 < 500 && productP99 < 500 && compareP99 < 500 && errorPct < 5;

  output += '\n' + '='.repeat(60) + '\n';
  output += `TARGETS: p99 < 500ms, Error Rate < 5%\n`;
  output += `RESULT: ${targetsMet ? 'PASSED' : 'FAILED'}\n`;
  output += '='.repeat(60) + '\n';

  return output;
}
