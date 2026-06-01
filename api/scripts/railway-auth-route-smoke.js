#!/usr/bin/env node
/**
 * Railway Auth Route Smoke Test
 * Tests authenticated endpoints that were hanging in production.
 *
 * Usage: node scripts/railway-auth-route-smoke.js
 *
 * Expected behavior (before fix):
 *   POST /v1/auth/register -> 201 (~8s)
 *   GET  /v1/catalog/stats -> 200 (~2.3s)
 *   GET  /v1/products/search?q=laptop&limit=1 -> client abort at 15s
 *   GET  /v1/products/deals?limit=1 -> client abort at 15s
 *   GET  /v1/categories -> client abort at 15s
 */

const http = require('http');
const https = require('https');

const API_BASE = process.env.API_BASE_URL || 'https://api.buywhere.ai';
const TEST_TIMEOUT = 20000;

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;

    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: TEST_TIMEOUT,
    };

    const req = client.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk.toString(); });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body.slice(0, 1000),
          timedOut: false,
        });
      });
    });

    req.on('error', (err) => {
      if (err.message.includes('timeout') || err.message.includes('Timeout')) {
        resolve({ status: 0, timedOut: true, error: 'Request timeout' });
      } else {
        resolve({ status: 0, error: err.message });
      }
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, timedOut: true, error: 'Request timeout' });
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function register() {
  const email = `smoke-test-${Date.now()}@test.local`;
  const body = JSON.stringify({
    email,
    password: 'TestPassword123!',
    name: 'Smoke Test',
    signup_channel: 'smoke_test',
  });

  const start = Date.now();
  const result = await request(`${API_BASE}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return { ...result, elapsed: Date.now() - start };
}

async function getStats() {
  const start = Date.now();
  const result = await request(`${API_BASE}/v1/catalog/stats`);
  return { ...result, elapsed: Date.now() - start };
}

async function searchProducts(apiKey) {
  const start = Date.now();
  const result = await request(`${API_BASE}/v1/products/search?q=laptop&limit=1`, {
    headers: { 'X-API-Key': apiKey },
  });
  return { ...result, elapsed: Date.now() - start };
}

async function getDeals(apiKey) {
  const start = Date.now();
  const result = await request(`${API_BASE}/v1/products/deals?limit=1`, {
    headers: { 'X-API-Key': apiKey },
  });
  return { ...result, elapsed: Date.now() - start };
}

async function getCategories(apiKey) {
  const start = Date.now();
  const result = await request(`${API_BASE}/v1/categories`, {
    headers: { 'X-API-Key': apiKey },
  });
  return { ...result, elapsed: Date.now() - start };
}

async function main() {
  console.log('=== Railway Auth Route Smoke Test ===\n');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Timeout: ${TEST_TIMEOUT}ms\n`);

  const results = {};

  console.log('Testing unauthenticated endpoints...');

  console.log('\n1. POST /v1/auth/register');
  results.register = await register();
  console.log(`   Status: ${results.register.status}`);
  console.log(`   Elapsed: ${results.register.elapsed}ms`);
  if (results.register.timedOut) console.log('   TIMEOUT');
  if (results.register.status === 201) {
    try {
      const data = JSON.parse(results.register.body);
      console.log(`   API Key: ${data.key ? 'received' : 'missing'}`);
    } catch {}
  }

  console.log('\n2. GET /v1/catalog/stats');
  results.stats = await getStats();
  console.log(`   Status: ${results.stats.status}`);
  console.log(`   Elapsed: ${results.stats.elapsed}ms`);
  if (results.stats.timedOut) console.log('   TIMEOUT');

  let apiKey = process.env.TEST_API_KEY;
  if (!apiKey && results.register.status === 201) {
    try {
      const registerData = JSON.parse(results.register.body);
      apiKey = registerData.key || registerData.api_key || registerData.token || '';
      if (apiKey) {
        console.log('\nUsing API key returned from /v1/auth/register');
      }
    } catch (_) {
      // Ignore invalid response payloads and continue with fallback behavior.
    }
  }

  if (!apiKey) {
    console.log('\nWARNING: TEST_API_KEY not set, skipping authenticated endpoint tests');
    console.log('Set TEST_API_KEY environment variable to test authenticated routes');
    return;
  }

  console.log('\nTesting authenticated endpoints (with API key)...');

  console.log('\n3. GET /v1/products/search?q=laptop&limit=1');
  results.search = await searchProducts(apiKey);
  console.log(`   Status: ${results.search.status}`);
  console.log(`   Elapsed: ${results.search.elapsed}ms`);
  if (results.search.timedOut) console.log('   TIMEOUT - THIS IS THE BUG');

  console.log('\n4. GET /v1/products/deals?limit=1');
  results.deals = await getDeals(apiKey);
  console.log(`   Status: ${results.deals.status}`);
  console.log(`   Elapsed: ${results.deals.elapsed}ms`);
  if (results.deals.timedOut) console.log('   TIMEOUT - THIS IS THE BUG');

  console.log('\n5. GET /v1/categories');
  results.categories = await getCategories(apiKey);
  console.log(`   Status: ${results.categories.status}`);
  console.log(`   Elapsed: ${results.categories.elapsed}ms`);
  if (results.categories.timedOut) console.log('   TIMEOUT - THIS IS THE BUG');

  console.log('\n=== Summary ===');
  const hanging = [results.search, results.deals, results.categories].filter(r => r.timedOut);
  if (hanging.length > 0) {
    console.log(`FAIL: ${hanging.length} authenticated endpoints hanging`);
    process.exit(1);
  } else {
    console.log('PASS: All endpoints responding');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
