#!/usr/bin/env node
/**
 * BUY-75413 (P2.3) — Agent-Discovery HTTP Headers regression guard.
 *
 * Probes the production api.buywhere.ai and buywhere.ai hosts and asserts
 * the five X-Agent-* headers are present per the P2.3 scope table.
 *
 * Scope (Reed's 8-criterion gate):
 *   1. X-Agent-Protocol: buywhere/v1 on 100% of buywhere.ai/*
 *   2. X-Agent-Protocol: buywhere/v1 on 100% of api.buywhere.ai/*
 *   3. X-Agent-Card URL returns 200 OK with valid Agent Card
 *   4. X-LLMs-Txt URL returns 200 OK with text/plain
 *   5. X-Agent-Index present on 200 OK catalog responses
 *   6. X-Agent-Auth present on 401/403
 *   7. CORS Access-Control-Expose-Headers includes all 5
 *   8. 100% of 225-cell sweep emits header set per scope table (Cart's job)
 *
 * This guard covers criteria 1, 2, 5, 6, 7 with curl-shaped probes. Criteria
 * 3 + 4 are static URL probes (the URLs the header values point at).
 * Criterion 8 belongs to Cart's 23:55Z sweep.
 *
 * Exits 0 on success, 1 on any failure. Designed to run after a Railway deploy.
 */
import https from 'node:https';
import http from 'node:http';

const API_HOST = process.env.BUYWHERE_API_HOST || 'api.buywhere.ai';
const SITE_HOST = process.env.BUYWHERE_SITE_HOST || 'buywhere.ai';
const API_KEY = process.env.BUYWHERE_API_KEY; // for criterion 5 (catalog 200)

const REQUIRED_ALWAYS_ON = ['x-agent-protocol', 'x-agent-card', 'x-llms-txt'];
const REQUIRED_INDEX_ON_200 = ['x-agent-index'];
const REQUIRED_AUTH_ON_4XX = ['x-agent-auth'];
const EXPECTED_PROTOCOL_VALUE = 'buywhere/v1';
const EXPECTED_CARD_URL = `https://${API_HOST}/.well-known/agent.json`;
const EXPECTED_LLMS_URL = `https://${API_HOST}/llms.txt`;
const EXPECTED_AUTH_VALUE = 'Bearer; register=https://buywhere.ai/keys';

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(15000, () => req.destroy(new Error(`Request timed out: ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

let failed = false;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
    failed = true;
  }
}

async function probeAlwaysOn(host, path, origin) {
  console.log(`\n[probe] GET https://${host}${path}`);
  const headers = {};
  if (origin) headers['Origin'] = origin;
  const res = await request(`https://${host}${path}`, { headers });
  console.log(`  status=${res.status}`);
  for (const name of REQUIRED_ALWAYS_ON) {
    const v = res.headers[name];
    check(`[${host}${path}] ${name} present`, v !== undefined, `got ${JSON.stringify(v)}`);
    if (name === 'x-agent-protocol' && v !== EXPECTED_PROTOCOL_VALUE) {
      check(`[${host}${path}] ${name} == "${EXPECTED_PROTOCOL_VALUE}"`, false, `got "${v}"`);
    }
    if (name === 'x-agent-card' && v !== EXPECTED_CARD_URL) {
      check(`[${host}${path}] ${name} == "${EXPECTED_CARD_URL}"`, false, `got "${v}"`);
    }
    if (name === 'x-llms-txt' && v !== EXPECTED_LLMS_URL) {
      check(`[${host}${path}] ${name} == "${EXPECTED_LLMS_URL}"`, false, `got "${v}"`);
    }
  }
  return res;
}

async function main() {
  // Criterion 2: api.buywhere.ai/* — /health (unauthenticated, fast)
  const apiHealth = await probeAlwaysOn(API_HOST, '/health', `https://${SITE_HOST}`);

  // Criterion 1: buywhere.ai/* — apex home page
  await probeAlwaysOn(SITE_HOST, '/', null);
  // And a deep path
  await probeAlwaysOn(SITE_HOST, '/search', null);

  // Criterion 6: X-Agent-Auth on 401 (no API key on /v1/products/search)
  console.log(`\n[probe] GET https://${API_HOST}/v1/products/search?q=laptop&country_code=us  (no key, expect 401)`);
  const authFail = await request(`https://${API_HOST}/v1/products/search?q=laptop&country_code=us`, {
    headers: { 'Origin': `https://${SITE_HOST}` },
  });
  console.log(`  status=${authFail.status}`);
  check(`[api/401] status == 401`, authFail.status === 401, `got ${authFail.status}`);
  const authHeader = authFail.headers['x-agent-auth'];
  check(`[api/401] X-Agent-Auth present`, authHeader !== undefined, `got ${JSON.stringify(authHeader)}`);
  check(
    `[api/401] X-Agent-Auth == "${EXPECTED_AUTH_VALUE}"`,
    authHeader === EXPECTED_AUTH_VALUE,
    `got "${authHeader}"`,
  );

  // Criterion 5: X-Agent-Index on 200 OK catalog responses
  if (!API_KEY) {
    console.warn(`\n[probe] SKIP catalog 200 check — set BUYWHERE_API_KEY to enable`);
  } else {
    console.log(`\n[probe] GET https://${API_HOST}/v1/products/search?q=laptop&country_code=us  (with key, expect 200)`);
    const ok = await request(`https://${API_HOST}/v1/products/search?q=laptop&country_code=us&limit=1`, {
      headers: {
        'Origin': `https://${SITE_HOST}`,
        'Authorization': `Bearer ${API_KEY}`,
      },
    });
    console.log(`  status=${ok.status}`);
    check(`[api/200] status == 200`, ok.status === 200, `got ${ok.status}`);
    const indexHeader = ok.headers['x-agent-index'];
    check(`[api/200] X-Agent-Index present`, indexHeader !== undefined, `got ${JSON.stringify(indexHeader)}`);
    check(
      `[api/200] X-Agent-Index URL contains q + country_code`,
      typeof indexHeader === 'string' && indexHeader.includes('q=laptop') && indexHeader.includes('country_code=us'),
      `got "${indexHeader}"`,
    );

    // Criterion 7: CORS exposes all 5
    const expose = ok.headers['access-control-expose-headers'] || '';
    const names = expose.split(',').map((s) => s.trim().toLowerCase());
    const expected = ['x-agent-protocol', 'x-agent-card', 'x-llms-txt', 'x-agent-index', 'x-agent-auth'];
    for (const n of expected) {
      check(`[api/200] Access-Control-Expose-Headers contains ${n}`, names.includes(n), `expose="${expose}"`);
    }
  }

  // Criterion 3 + 4: the URLs the X-Agent-Card and X-LLMs-Txt point at
  console.log(`\n[probe] GET ${EXPECTED_CARD_URL}  (criterion 3)`);
  const card = await request(EXPECTED_CARD_URL);
  check(`[agent.json] status == 200`, card.status === 200, `got ${card.status}`);

  console.log(`\n[probe] GET ${EXPECTED_LLMS_URL}  (criterion 4)`);
  const llms = await request(EXPECTED_LLMS_URL);
  check(`[llms.txt] status == 200`, llms.status === 200, `got ${llms.status}`);
  const ct = (llms.headers['content-type'] || '').toLowerCase();
  check(`[llms.txt] content-type starts with text/`, ct.startsWith('text/'), `got "${ct}"`);

  console.log('\n=== summary ===');
  if (failed) {
    console.error(`FAILED: ${failures.length} check(s) failed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('All P2.3 header probes passed.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});