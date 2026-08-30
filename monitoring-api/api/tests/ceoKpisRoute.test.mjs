// BUY-75445: route-level smoke tests for GET /api/monitoring/ceo_kpis.
// BUY-77109: extended to cover the three P6.1 acceptance-gate columns.
// Run with: node --test api/tests/ceoKpisRoute.test.mjs
//
// These tests stub the pg pool so the route can be exercised without a
// live database. The shape assertions confirm the BUY-75445 fields appear
// in the response and that the `window` query param is honoured.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { registerRoutes } = require('../src/monitoring/routes');

/**
 * Build a minimal Express-shaped app stub. We only need get() + the
 * handler invocation, since the route is read-only.
 */
function buildAppStub() {
  const handlers = [];
  const capture = (method) => (path, ...fns) => {
    const handler = fns.find((f) => typeof f === 'function');
    handlers.push({ method, path, handler });
  };
  const app = {
    get: capture('GET'),
    post: capture('POST'),
    put: capture('PUT'),
    delete: capture('DELETE'),
  };
  return { app, handlers };
}

/**
 * Build a minimal express req/res pair for the handler. The route only
 * reads req.query.window and calls res.json / res.status().json.
 */
function buildReqRes({ query = {} } = {}) {
  const req = { query };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

describe('ceo_kpis route — BUY-75445 external-agent counter', () => {
  it('exposes all six mcp_v2_external_agent_calls_* fields', async () => {
    // Stubbed pool returns the same shape the view emits. Using string-encoded
    // bigints mirrors how pg parses COUNT() — coerce on the consumer side.
    const pool = {
      query: async () => ({
        rows: [{
          report_date: '2026-08-26',
          zero_result_rate: '0',
          near_miss_rate: '0.00000000000000000000',
          near_miss_7day_mean_under_threshold: true,
          near_miss_latest_sweep_under_threshold: true,
          p1_3_nm_status: 'healthy',
          computed_at: new Date('2026-08-26T08:00:00Z'),
          silently_empty_rate_24h: '0.000000',
          deliver_to_pass_rate_24h: '1.000000',
          mcp_v2_external_agent_calls_24h: '42',
          mcp_v2_external_agent_calls_7d: '301',
          mcp_v2_external_agent_calls_30d: '1284',
          mcp_v2_external_agent_calls_with_deliver_to_24h: '38',
          mcp_v2_external_agent_calls_with_deliver_to_7d: '275',
          mcp_v2_external_agent_calls_with_deliver_to_30d: '1170',
          affiliate_click_intent_page_total_24h: '127',
          intent_page_r_link_density_avg_24h: '6.4000000000000000',
          affiliate_redirect_success_rate_24h: '0.987654',
        }],
      }),
    };

    const { app, handlers } = buildAppStub();
    registerRoutes(app, pool);

    const route = handlers.find((h) => h.path === '/api/monitoring/ceo_kpis');
    assert.ok(route, 'route /api/monitoring/ceo_kpis must be registered');

    const { req, res } = buildReqRes({ query: { window: '24h' } });
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.window, '24h');
    const k = res.body.kpis;

    assert.equal(k.mcp_v2_external_agent_calls_24h, '42');
    assert.equal(k.mcp_v2_external_agent_calls_7d, '301');
    assert.equal(k.mcp_v2_external_agent_calls_30d, '1284');
    assert.equal(k.mcp_v2_external_agent_calls_with_deliver_to_24h, '38');
    assert.equal(k.mcp_v2_external_agent_calls_with_deliver_to_7d, '275');
    assert.equal(k.mcp_v2_external_agent_calls_with_deliver_to_30d, '1170');

    // BUY-77109 P6.1 acceptance-gate fields
    assert.equal(k.affiliate_click_intent_page_total_24h, '127');
    assert.equal(k.intent_page_r_link_density_avg_24h, '6.4000000000000000');
    assert.equal(k.affiliate_redirect_success_rate_24h, '0.987654');

    // Pre-existing fields preserved verbatim.
    assert.equal(k.silently_empty_rate_24h, '0.000000');
    assert.equal(k.deliver_to_pass_rate_24h, '1.000000');
    assert.equal(typeof k.near_miss_rate, 'string');
  });

  it('returns 0 (not null) for windows with no external-agent rows', async () => {
    const pool = {
      query: async () => ({
        rows: [{
          report_date: '2026-08-26',
          zero_result_rate: '0',
          near_miss_rate: '0.00000000000000000000',
          near_miss_7day_mean_under_threshold: true,
          near_miss_latest_sweep_under_threshold: true,
          p1_3_nm_status: 'healthy',
          computed_at: new Date(),
          silently_empty_rate_24h: null,
          deliver_to_pass_rate_24h: null,
          mcp_v2_external_agent_calls_24h: '0',
          mcp_v2_external_agent_calls_7d: '0',
          mcp_v2_external_agent_calls_30d: '0',
          mcp_v2_external_agent_calls_with_deliver_to_24h: '0',
          mcp_v2_external_agent_calls_with_deliver_to_7d: '0',
          mcp_v2_external_agent_calls_with_deliver_to_30d: '0',
          affiliate_click_intent_page_total_24h: '0',
          intent_page_r_link_density_avg_24h: '0',
          affiliate_redirect_success_rate_24h: null,
        }],
      }),
    };
    const { app, handlers } = buildAppStub();
    registerRoutes(app, pool);
    const route = handlers.find((h) => h.path === '/api/monitoring/ceo_kpis');
    const { req, res } = buildReqRes({ query: { window: '7d' } });
    await route.handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.window, '7d');
    // The view casts to bigint; pg returns 0 as a string. The route does not
    // coerce — consumers (Reed's monitor) handle both forms. Just confirm the
    // fields are present and equal to the string '0'.
    assert.equal(res.body.kpis.mcp_v2_external_agent_calls_24h, '0');
    assert.equal(res.body.kpis.mcp_v2_external_agent_calls_with_deliver_to_30d, '0');
  });

  it('defaults window to 24h when invalid/missing', async () => {
    let capturedSql = '';
    const pool = {
      query: async (sql) => {
        capturedSql = sql;
        return { rows: [{
          report_date: '2026-08-26',
          zero_result_rate: '0',
          near_miss_rate: '0',
          near_miss_7day_mean_under_threshold: true,
          near_miss_latest_sweep_under_threshold: true,
          p1_3_nm_status: 'healthy',
          computed_at: new Date(),
          silently_empty_rate_24h: null,
          deliver_to_pass_rate_24h: null,
          mcp_v2_external_agent_calls_24h: '0',
          mcp_v2_external_agent_calls_7d: '0',
          mcp_v2_external_agent_calls_30d: '0',
          mcp_v2_external_agent_calls_with_deliver_to_24h: '0',
          mcp_v2_external_agent_calls_with_deliver_to_7d: '0',
          mcp_v2_external_agent_calls_with_deliver_to_30d: '0',
          affiliate_click_intent_page_total_24h: '0',
          intent_page_r_link_density_avg_24h: '0',
          affiliate_redirect_success_rate_24h: null,
        }] };
      },
    };

    const { app, handlers } = buildAppStub();
    registerRoutes(app, pool);
    const route = handlers.find((h) => h.path === '/api/monitoring/ceo_kpis');
    const { req, res } = buildReqRes({ query: { window: 'invalid' } });
    await route.handler(req, res);
    assert.equal(res.body.window, '24h');

    // The SQL should still request all six BUY-75445 fields + the three
    // BUY-77109 fields regardless of the window param (the view itself
    // filters by window length).
    for (const col of [
      'mcp_v2_external_agent_calls_24h',
      'mcp_v2_external_agent_calls_7d',
      'mcp_v2_external_agent_calls_30d',
      'mcp_v2_external_agent_calls_with_deliver_to_24h',
      'mcp_v2_external_agent_calls_with_deliver_to_7d',
      'mcp_v2_external_agent_calls_with_deliver_to_30d',
      'affiliate_click_intent_page_total_24h',
      'intent_page_r_link_density_avg_24h',
      'affiliate_redirect_success_rate_24h',
    ]) {
      assert.ok(capturedSql.includes(col), `SQL missing column ${col}`);
    }
  });

  it('returns 500 on DB error', async () => {
    const pool = {
      query: async () => { throw new Error('relation "monitoring.v_ceo_kpis" does not exist'); },
    };
    const { app, handlers } = buildAppStub();
    registerRoutes(app, pool);
    const route = handlers.find((h) => h.path === '/api/monitoring/ceo_kpis');
    const { req, res } = buildReqRes({ query: { window: '24h' } });
    await route.handler(req, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'INTERNAL_ERROR');
  });
});