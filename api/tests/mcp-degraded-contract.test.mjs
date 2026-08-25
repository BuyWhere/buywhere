// BUY-74597: synthetic timeout test for the MCP degraded-mode contract.
// Asserts that deriveEmptiness + buildSearchResponse produce the canonical
// envelope for every scoped tool path (timeout, partial_timeout, auth_failure,
// circuit_open, upstream_exception) without any unqualified empty result.
//
// Runs against the compiled api/dist/ tree, matching the project's existing
// test convention (see api/tests/response.test.mjs).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildSearchResponse, deriveEmptiness } = require('../dist/lib/response');

const BASE_SIGNALS = {
  regionHasAnyData: true,
  categoryHasAnyData: true,
  apiError: false,
  rateLimited: false,
  regionSupported: true,
  categoryRequested: false,
  requestedCategory: null,
  requestedCountry: 'SG',
  rateLimitRemaining: null,
  deliverToPresent: false,
  unfilteredHasAnyData: null,
  queryAmbiguous: null,
};

function expectDegradedEnvelope(result, expectedKind) {
  // Wire-level envelope invariants — what an agent can rely on.
  assert.equal(result.meta.degraded, true, 'meta.degraded must be true on timeout/degraded path');
  assert.equal(result.meta.status, 'degraded', 'meta.status must be "degraded"');
  assert.equal(result.meta.confidence, 'low', 'meta.confidence must be "low"');
  assert.ok(['timeout', 'partial_timeout', 'auth_failure', 'api_error'].includes(result.meta.emptiness_reason),
    `meta.emptiness_reason must classify the degraded cause, got ${result.meta.emptiness_reason}`);
  assert.equal(result.meta.degraded_kind, expectedKind, `meta.degraded_kind must equal ${expectedKind}`);
  assert.ok(result.meta.diagnostic, 'meta.diagnostic must be present');
  assert.equal(result.meta.diagnostic.engine_status, 'degraded',
    'meta.diagnostic.engine_status must be "degraded" (or "error" for auth_failure)');
  assert.ok(['catalog_search', 'offer_aggregation', 'merchant_join'].includes(result.meta.diagnostic.timed_out_stage),
    'meta.diagnostic.timed_out_stage must name the failed stage');
  // data MUST be empty for a degraded response — no unqualified empty arrays without
  // the diagnostic triplet would be a contract violation.
  assert.equal(result.data.length, 0, 'degraded responses MUST NOT silently ship data');
  assert.equal(result.results.length, 0);
  assert.equal(result.products.length, 0);
  assert.equal(result.items.length, 0);
}

describe('BUY-74597: MCP degraded-mode contract', () => {
  it('deriveEmptiness classifies statement_timeout as timeout with low confidence', () => {
    const out = deriveEmptiness({
      ...BASE_SIGNALS,
      degradedKind: 'timeout',
      timedOutStage: 'catalog_search',
    });
    assert.equal(out.emptiness_reason, 'timeout');
    assert.equal(out.confidence, 'low');
    assert.equal(out.degraded_kind, 'timeout');
    assert.equal(out.diagnostic.engine_status, 'degraded');
    assert.equal(out.diagnostic.timed_out_stage, 'catalog_search');
    assert.equal(out.diagnostic.deliver_to_present, false);
  });

  it('deriveEmptiness classifies partial_timeout distinctly from timeout', () => {
    const out = deriveEmptiness({
      ...BASE_SIGNALS,
      degradedKind: 'partial_timeout',
      timedOutStage: 'offer_aggregation',
    });
    assert.equal(out.emptiness_reason, 'partial_timeout');
    assert.equal(out.degraded_kind, 'partial_timeout');
    assert.equal(out.diagnostic.timed_out_stage, 'offer_aggregation');
  });

  it('deriveEmptiness classifies auth_failure with engine_status=error', () => {
    const out = deriveEmptiness({
      ...BASE_SIGNALS,
      degradedKind: 'auth_failure',
    });
    assert.equal(out.emptiness_reason, 'auth_failure');
    assert.equal(out.confidence, 'low');
    assert.equal(out.degraded_kind, 'auth_failure');
    assert.equal(out.diagnostic.engine_status, 'error');
  });

  it('deriveEmptiness classifies circuit_open as upstream_exception with degraded engine_status', () => {
    const out = deriveEmptiness({
      ...BASE_SIGNALS,
      degradedKind: 'circuit_open',
      timedOutStage: 'catalog_search',
    });
    assert.equal(out.emptiness_reason, 'api_error');
    assert.equal(out.degraded_kind, 'circuit_open');
    assert.equal(out.diagnostic.engine_status, 'degraded');
  });

  it('buildSearchResponse assembles the canonical degraded envelope for search_products timeout', () => {
    const result = buildSearchResponse(
      [],
      0,
      20,
      0,
      123,
      false,
      true, // degraded
      undefined,
      'SG',
      deriveEmptiness({
        ...BASE_SIGNALS,
        degradedKind: 'timeout',
        timedOutStage: 'catalog_search',
      }),
    );
    expectDegradedEnvelope(result, 'timeout');
    assert.equal(result.meta.total, 0);
    assert.equal(result.meta.cached, false);
  });

  it('buildSearchResponse carries partial_timeout on get_deals offer_aggregation timeout', () => {
    const result = buildSearchResponse(
      [],
      0,
      20,
      0,
      4567,
      false,
      true,
      undefined,
      'US',
      deriveEmptiness({
        ...BASE_SIGNALS,
        requestedCountry: 'US',
        deliverToPresent: true,
        degradedKind: 'partial_timeout',
        timedOutStage: 'offer_aggregation',
      }),
    );
    expectDegradedEnvelope(result, 'partial_timeout');
    assert.equal(result.meta.diagnostic.deliver_to_present, true);
    assert.equal(result.meta.diagnostic.timed_out_stage, 'offer_aggregation');
  });

  it('buildSearchResponse never ships an unqualified empty result when the cause is upstream_exception', () => {
    // This guards the spec §4 invariant: no tool may return unqualified empty
    // when the cause is timeout / auth failure / upstream exception / circuit breaker.
    const result = buildSearchResponse(
      [],
      0,
      20,
      0,
      789,
      false,
      true,
      undefined,
      'SG',
      deriveEmptiness({
        ...BASE_SIGNALS,
        degradedKind: 'upstream_exception',
        timedOutStage: 'catalog_search',
      }),
    );
    expectDegradedEnvelope(result, 'upstream_exception');
    assert.ok(result.meta.emptiness_reason, 'emptiness_reason MUST be set on degraded path');
  });

  it('buildSearchResponse preserves deliver_to_present flag through the diagnostic triplet', () => {
    const result = buildSearchResponse(
      [],
      0,
      20,
      0,
      1,
      false,
      true,
      undefined,
      'SG',
      deriveEmptiness({
        ...BASE_SIGNALS,
        deliverToPresent: true,
        degradedKind: 'timeout',
        timedOutStage: 'catalog_search',
      }),
    );
    assert.equal(result.meta.diagnostic.deliver_to_present, true);
    assert.equal(result.meta.emptiness_reason, 'timeout');
  });
});
