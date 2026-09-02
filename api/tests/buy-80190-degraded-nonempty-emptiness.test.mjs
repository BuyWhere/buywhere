// BUY-80190: P2.6 (BUY-71539 residual). REST /v1/products/search degraded
// non-empty responses MUST carry meta.emptiness_reason + meta.degraded=true,
// so agents can distinguish degraded data from clean FTS hits. The wire
// shape comes from buildSearchResponse in api/src/lib/response.ts.
//
// Spec §2.1 said "non-empty responses MUST NOT carry emptiness_reason" — that
// language is now amended to "clean non-empty responses MUST NOT carry it";
// degraded (timeout / partial-fail / REST fallback / circuit_open) responses
// carry the triplet regardless of result count.
//
// Three guarantees under test:
//   1. buildSearchResponse emits the emptiness triplet on a non-empty
//      degraded response (degraded=true, products.length>0, emptiness passed).
//   2. buildSearchResponse omits the triplet on a non-empty clean response
//      (degraded=false, products.length>0, no emission regression).
//   3. The REST /v1/products/search `sendFallbackProducts` helper stamps
//      meta.degraded=true and an api_error emptiness when the fallback path
//      returns non-empty rows from a 57014 primary FTS timeout.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildSearchResponse } = require('../dist/lib/response');

const sampleProduct = {
  id: '1',
  title: 'Test Product',
  name: 'Test Product',
  price: { amount: 100, currency: 'USD' },
  merchant: 'amazon',
  url: 'https://example.com/p/1',
  image_url: null,
  region: 'us',
  country_code: 'US',
  category_path: null,
  updated_at: null,
  merchant_id: null,
  merchant_name: null,
  merchant_slug: null,
  scraped_via: null,
  source: 'amazon_us',
  has_affiliate_tracking: false,
  is_affiliate: false,
};

const fallbackEmptiness = {
  emptiness_reason: 'api_error',
  confidence: 'low',
  diagnostic: {
    engine_status: 'degraded',
    indexed_for_region: true,
    category_recognized: true,
    rate_limit_remaining: null,
    deliver_to_present: true,
    timed_out_stage: 'catalog_search',
  },
  degraded_kind: 'timeout',
};

describe('BUY-80190: P2.6 emptiness_reason on degraded non-empty responses', () => {
  it('buildSearchResponse emits the emptiness triplet on non-empty degraded (timeout)', () => {
    const products = [sampleProduct, { ...sampleProduct, id: '2' }];
    const result = buildSearchResponse(
      products,
      products.length,
      20,
      0,
      42,
      false,
      true, // degraded
      false,
      'US',
      fallbackEmptiness,
    );
    assert.equal(result.meta.degraded, true, 'meta.degraded must be true');
    assert.equal(result.meta.status, 'degraded', 'meta.status must be "degraded"');
    assert.equal(result.meta.emptiness_reason, 'api_error',
      'meta.emptiness_reason must be api_error on degraded');
    assert.equal(result.meta.confidence, 'low', 'meta.confidence must be low');
    assert.equal(result.meta.degraded_kind, 'timeout', 'meta.degraded_kind must be timeout');
    assert.ok(result.meta.diagnostic, 'meta.diagnostic must be present');
    assert.equal(result.meta.diagnostic.engine_status, 'degraded');
    assert.equal(result.meta.diagnostic.timed_out_stage, 'catalog_search');
    assert.equal(result.data.length, 2, 'non-empty degraded MUST still surface data');
  });

  it('buildSearchResponse omits the triplet on non-empty clean (degraded=false)', () => {
    const products = [sampleProduct, { ...sampleProduct, id: '2' }];
    const result = buildSearchResponse(
      products,
      products.length,
      20,
      0,
      42,
      false,
      false, // not degraded
      false,
      'US',
      fallbackEmptiness, // passed but ignored when clean+non-empty
    );
    assert.equal(result.meta.degraded, false, 'meta.degraded must be false');
    assert.equal(result.meta.emptiness_reason, undefined,
      'clean non-empty MUST NOT carry meta.emptiness_reason per spec §2.1 (BUY-80190 amendment)');
    assert.equal(result.meta.confidence, undefined,
      'clean non-empty MUST NOT carry meta.confidence');
    assert.equal(result.meta.degraded_kind, undefined,
      'clean non-empty MUST NOT carry meta.degraded_kind');
    assert.equal(result.data.length, 2, 'clean non-empty MUST surface all data');
  });

  it('buildSearchResponse still emits the triplet on empty degraded (parity with BUY-74597)', () => {
    const result = buildSearchResponse(
      [],
      0,
      20,
      0,
      42,
      false,
      true, // degraded
      false,
      'US',
      fallbackEmptiness,
    );
    assert.equal(result.meta.degraded, true);
    assert.equal(result.meta.emptiness_reason, 'api_error',
      'empty degraded envelope preserved (BUY-74597 contract)');
    assert.equal(result.data.length, 0);
  });

  it('buildSearchResponse still emits the triplet on empty clean (no_match contract)', () => {
    const noMatchEmptiness = {
      emptiness_reason: 'no_match',
      confidence: 'high',
      diagnostic: {
        engine_status: 'ok',
        indexed_for_region: true,
        category_recognized: true,
        rate_limit_remaining: null,
        deliver_to_present: true,
      },
    };
    const result = buildSearchResponse(
      [],
      0,
      20,
      0,
      42,
      false,
      false,
      false,
      'US',
      noMatchEmptiness,
    );
    assert.equal(result.meta.emptiness_reason, 'no_match',
      'empty clean MUST carry no_match (P2.6 base contract)');
    assert.equal(result.data.length, 0);
  });
});

// Source-level assertions for the REST /v1/products/search fallback path.
// `sendFallbackProducts` is the function that emits non-empty responses after
// a primary FTS statement_timeout (57014). BUY-80190 requires it to stamp
// meta.degraded=true + meta.emptiness_reason='api_error' so agents can detect
// degraded data regardless of result count.

import fs from 'node:fs';
import path from 'path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const productsTs = path.resolve(__dirname, '..', 'src', 'routes', 'products.ts');
const responseTs = path.resolve(__dirname, '..', 'src', 'lib', 'response.ts');
const productsSource = fs.readFileSync(productsTs, 'utf8');
const responseSource = fs.readFileSync(responseTs, 'utf8');

describe('BUY-80190: source guard for REST fallback non-empty degraded envelope', () => {
  it('buildSearchResponse in response.ts emits triplet on (isEmpty || degraded)', () => {
    assert.ok(
      /const emitEmptiness = \(isEmpty \|\| degraded\) && !!emptiness;/.test(responseSource),
      'buildSearchResponse must emit emptiness_reason when response is empty OR degraded',
    );
    assert.ok(
      /\.\.\.\(emitEmptiness && emptiness && \{/.test(responseSource),
      'spread must gate on emitEmptiness, not isEmpty alone',
    );
  });

  it('sendFallbackProducts stamps meta.degraded=true (true arg in 7th slot)', () => {
    const sendStart = productsSource.indexOf('const sendFallbackProducts = async (');
    // find the matching closing `};` — the function is async () => { ... }; so look for
    // the closing `};` after the function body. Use balanced bracket counting.
    let depth = 0;
    let end = sendStart;
    let inStr = false;
    for (let i = sendStart; i < productsSource.length; i++) {
      const ch = productsSource[i];
      if (ch === '"' || ch === "'" || ch === '`') inStr = !inStr;
      else if (!inStr) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { end = i + 1; break; }
        }
      }
    }
    const sendFn = productsSource.slice(sendStart, end);
    assert.ok(
      /buildSearchResponse\(\s*fallbackProducts/.test(sendFn),
      'sendFallbackProducts must call buildSearchResponse',
    );
    assert.ok(
      /buildSearchResponse\([\s\S]*?fallbackProducts[\s\S]*?,\s*true\s*,/.test(sendFn),
      'sendFallbackProducts must pass degraded=true (the 7th positional arg)',
    );
    assert.ok(
      /buildSearchResponse\([\s\S]*?fallbackProducts[\s\S]*?,\s*true\s*,\s*hasMore[\s\S]*?fallbackEmptiness/.test(sendFn),
      'sendFallbackProducts must pass the fallbackEmptiness object as the 10th positional arg',
    );
  });

  it('REST /v1/products/search fallback path documents BUY-80190', () => {
    assert.ok(
      /BUY-80190/.test(productsSource),
      'products.ts must reference BUY-80190 in the fallback path',
    );
  });

  it('cache version bumped so stale entries cannot poison (v19 → v20)', () => {
    assert.ok(
      /tier-child-fts-v20-b80190/.test(productsSource),
      'cache version must include b80190 to invalidate pre-fix Redis entries',
    );
  });
});
