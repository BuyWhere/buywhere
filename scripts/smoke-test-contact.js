#!/usr/bin/env node
/**
 * BuyWhere Contact Smoke Test (BUY-18218)
 *
 * Verifies:
 *  1. Contact page loads (HTTP 200 + keyword present)
 *  2. No cdn-cgi email-protection links in contact page HTML
 *  3. Contact API accepts valid submission and returns success
 *  4. Contact API rejects incomplete submission with 400
 *
 * Usage: node scripts/smoke-test-contact.js
 *   FRONTEND_URL — frontend base URL (default: https://buywhere.ai)
 *   API_URL      — API base URL (default: https://api.buywhere.ai)
 */

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://buywhere.ai').replace(/\/$/, '');
// Contact API lives on the frontend Next.js app, not the separate API service
const API_URL = (process.env.API_URL || FRONTEND_URL).replace(/\/$/, '');

function nowIso() {
  return new Date().toISOString();
}

async function fetchText(url, options = {}) {
  const start = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...options });
  const text = await res.text().catch(() => '');
  return { status: res.status, latencyMs: Date.now() - start, text, url: res.url };
}

async function fetchJson(url, options = {}) {
  const start = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...options });
  const body = await res.json().catch(() => null);
  return { status: res.status, latencyMs: Date.now() - start, body };
}

function pass(label, msg) {
  console.log(`  ✓ ${label}${msg ? ': ' + msg : ''}`);
}
function fail(label, msg) {
  console.log(`  ✗ ${label}${msg ? ': ' + msg : ''}`);
}

async function testContactPageLoads() {
  console.log('1. Contact page load');
  const { status, latencyMs, text } = await fetchText(`${FRONTEND_URL}/contact`);
  let ok = true;

  if (status === 200) {
    pass('HTTP status', `${status} (${latencyMs}ms)`);
  } else {
    fail('HTTP status', `${status} (expected 200)`);
    ok = false;
  }

  if (text.includes('BuyWhere')) {
    pass('Keyword "BuyWhere" present');
  } else {
    fail('Keyword "BuyWhere" missing from page');
    ok = false;
  }

  return { name: 'contact_page_loads', passed: ok, latencyMs };
}

async function testNoEmailProtectionLinks() {
  console.log('2. No Cloudflare email-protection links');
  const { status, text } = await fetchText(`${FRONTEND_URL}/contact`);
  let ok = true;

  if (status !== 200) {
    fail('Cannot check — page returned', String(status));
    return { name: 'no_email_protection', passed: false };
  }

  const hasCdnCgi = text.includes('/cdn-cgi/l/email-protection');
  if (hasCdnCgi) {
    fail('cdn-cgi email-protection links found in HTML', 'Cloudflare email obfuscation active');
    ok = false;
  } else {
    pass('No cdn-cgi email-protection links');
  }

  return { name: 'no_email_protection', passed: ok };
}

async function testContactFormSubmissionSuccess() {
  console.log('3. Contact API — valid submission');
  const payload = {
    companyName: 'Smoke Test Co',
    contactName: 'Smoke Tester',
    email: `smoke+${Date.now()}@example.com`,
    website: '',
    message: 'Automated smoke test submission — please ignore.',
    source: 'smoke-test',
  };

  const { status, latencyMs, body } = await fetchJson(`${API_URL}/api/v1/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let ok = true;

  if (status === 200) {
    pass('HTTP status', `${status} (${latencyMs}ms)`);
  } else {
    fail('HTTP status', `${status} (expected 200), body: ${JSON.stringify(body)}`);
    ok = false;
  }

  if (body?.success === true) {
    pass('Response body has success=true');
  } else {
    fail('Response body missing success=true', JSON.stringify(body));
    ok = false;
  }

  if (body?.message) {
    pass('Response body has message', body.message);
  } else {
    fail('Response body missing message');
    ok = false;
  }

  return { name: 'contact_api_success', passed: ok, latencyMs };
}

async function testContactFormSubmissionValidation() {
  console.log('4. Contact API — incomplete submission rejected (400)');
  const { status, latencyMs, body } = await fetchJson(`${API_URL}/api/v1/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'incomplete@example.com' }),
  });

  let ok = true;

  if (status === 400) {
    pass('HTTP status', `${status} — correctly rejected (${latencyMs}ms)`);
  } else {
    fail('HTTP status', `${status} (expected 400)`);
    ok = false;
  }

  if (body?.error) {
    pass('Error message present', body.error);
  } else {
    fail('No error message in response');
    ok = false;
  }

  return { name: 'contact_api_validation', passed: ok, latencyMs };
}

async function run() {
  const startedAt = nowIso();
  console.log('='.repeat(52));
  console.log('BuyWhere Contact Smoke Test (BUY-18218)');
  console.log(`Frontend: ${FRONTEND_URL}`);
  console.log(`API:      ${API_URL} (contact endpoint on frontend)`);
  console.log(`Started:  ${startedAt}`);
  console.log('='.repeat(52));
  console.log();

  const results = [];

  results.push(await testContactPageLoads());
  console.log();
  results.push(await testNoEmailProtectionLinks());
  console.log();
  results.push(await testContactFormSubmissionSuccess());
  console.log();
  results.push(await testContactFormSubmissionValidation());
  console.log();

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const latencies = results.map(r => r.latencyMs).filter(Boolean);
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;

  console.log('-'.repeat(52));
  console.log('SUMMARY');
  console.log('-'.repeat(52));
  console.log(`Passed:       ${passed}/${results.length}`);
  console.log(`Failed:       ${failed}/${results.length}`);
  console.log(`Avg Latency:  ${avgLatency}ms`);
  console.log(`Completed:    ${nowIso()}`);

  if (failed > 0) {
    const failedNames = results.filter(r => !r.passed).map(r => r.name).join(', ');
    console.log(`\n✗ FAILED (${failedNames})`);
    process.exit(1);
  } else {
    console.log('\n✓ ALL CONTACT SMOKE TESTS PASSED');
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Smoke test error:', err.message);
  process.exit(1);
});
