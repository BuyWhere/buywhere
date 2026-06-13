// BUY-45691: unit + static guard tests for the API query-cost gate.
//
// The gate itself (estimateQueryCost / assertQueryWithinCost) is pure given a
// fake executor, so we test it without a live DB. We also static-assert that the
// heavy read paths are wired to the consistency caps and the gate.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const apiSrcRoot = path.resolve(__dirname, '..', 'src');
const require = createRequire(import.meta.url);

// Import the compiled module, matching the repo convention (response.test.mjs et
// al. import from ../dist). Run `npm run build` before this suite.
const {
  estimateQueryCost,
  assertQueryWithinCost,
  QueryTooExpensiveError,
  handleQueryTooExpensive,
  getQueryCostLimit,
  getQueryCostGateMode,
  DEFAULT_QUERY_COST_LIMIT,
} = require('../dist/lib/queryCostGate');

// A fake node-postgres executor that returns a planner cost for EXPLAIN and
// records the calls it received.
function fakeExecutor(totalCost, { planRows = 1, throwOnExplain = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^EXPLAIN/i.test(sql)) {
        if (throwOnExplain) throw new Error('boom');
        return { rows: [{ 'QUERY PLAN': [{ Plan: { 'Total Cost': totalCost, 'Plan Rows': planRows } }] }] };
      }
      return { rows: [] };
    },
  };
}

describe('queryCostGate.estimateQueryCost', () => {
  it('extracts Total Cost and Plan Rows from EXPLAIN (FORMAT JSON)', async () => {
    const ex = fakeExecutor(1234.5, { planRows: 42 });
    const est = await estimateQueryCost(ex, 'SELECT 1', []);
    assert.equal(est.totalCost, 1234.5);
    assert.equal(est.planRows, 42);
    assert.match(ex.calls[0].sql, /^EXPLAIN \(FORMAT JSON\) SELECT 1$/);
  });

  it('passes params through to EXPLAIN', async () => {
    const ex = fakeExecutor(10);
    await estimateQueryCost(ex, 'SELECT $1::int', [7]);
    assert.deepEqual(ex.calls[0].params, [7]);
  });

  it('fails open (cost 0) when EXPLAIN throws', async () => {
    const ex = fakeExecutor(0, { throwOnExplain: true });
    const est = await estimateQueryCost(ex, 'SELECT 1');
    assert.equal(est.totalCost, 0);
  });

  it('fails open when the plan cannot be parsed', async () => {
    const ex = { async query() { return { rows: [{}] }; } };
    const est = await estimateQueryCost(ex, 'SELECT 1');
    assert.equal(est.totalCost, 0);
  });
});

describe('queryCostGate.assertQueryWithinCost', () => {
  it('returns the estimate when under the limit', async () => {
    const ex = fakeExecutor(500);
    const est = await assertQueryWithinCost(ex, 'SELECT 1', [], { costLimit: 1000, mode: 'enforce' });
    assert.equal(est.totalCost, 500);
  });

  it('throws QueryTooExpensiveError when over the limit in enforce mode', async () => {
    const ex = fakeExecutor(5000);
    await assert.rejects(
      () => assertQueryWithinCost(ex, 'SELECT 1', [], { costLimit: 1000, mode: 'enforce' }),
      (err) => {
        assert.ok(err instanceof QueryTooExpensiveError);
        assert.equal(err.estimatedCost, 5000);
        assert.equal(err.costLimit, 1000);
        return true;
      },
    );
  });

  it('does NOT throw in observe mode even when over the limit', async () => {
    const ex = fakeExecutor(5000);
    const est = await assertQueryWithinCost(ex, 'SELECT 1', [], { costLimit: 1000, mode: 'observe' });
    assert.equal(est.totalCost, 5000); // allowed through, returned for logging
  });
});

describe('queryCostGate config defaults', () => {
  it('defaults to observe mode unless QUERY_COST_GATE_MODE=enforce', () => {
    const prev = process.env.QUERY_COST_GATE_MODE;
    delete process.env.QUERY_COST_GATE_MODE;
    assert.equal(getQueryCostGateMode(), 'observe');
    process.env.QUERY_COST_GATE_MODE = 'enforce';
    assert.equal(getQueryCostGateMode(), 'enforce');
    process.env.QUERY_COST_GATE_MODE = 'garbage';
    assert.equal(getQueryCostGateMode(), 'observe');
    if (prev === undefined) delete process.env.QUERY_COST_GATE_MODE;
    else process.env.QUERY_COST_GATE_MODE = prev;
  });

  it('falls back to DEFAULT_QUERY_COST_LIMIT for missing/invalid QUERY_COST_LIMIT', () => {
    const prev = process.env.QUERY_COST_LIMIT;
    delete process.env.QUERY_COST_LIMIT;
    assert.equal(getQueryCostLimit(), DEFAULT_QUERY_COST_LIMIT);
    process.env.QUERY_COST_LIMIT = 'not-a-number';
    assert.equal(getQueryCostLimit(), DEFAULT_QUERY_COST_LIMIT);
    process.env.QUERY_COST_LIMIT = '250000';
    assert.equal(getQueryCostLimit(), 250000);
    if (prev === undefined) delete process.env.QUERY_COST_LIMIT;
    else process.env.QUERY_COST_LIMIT = prev;
  });
});

describe('queryCostGate.handleQueryTooExpensive', () => {
  it('responds 422 with a structured query_too_expensive body', () => {
    let status, body;
    const res = {
      headersSent: false,
      status(code) { status = code; return { json(b) { body = b; return b; } }; },
    };
    const handled = handleQueryTooExpensive(new QueryTooExpensiveError(9000, 1000), res);
    assert.equal(handled, true);
    assert.equal(status, 422);
    assert.equal(body.error, 'query_too_expensive');
    assert.equal(body.estimated_cost, 9000);
    assert.equal(body.cost_limit, 1000);
  });

  it('returns false (does not handle) for unrelated errors', () => {
    const res = { headersSent: false, status() { throw new Error('should not be called'); } };
    assert.equal(handleQueryTooExpensive(new Error('other'), res), false);
  });
});

// ─── Static wiring guards — cheap regression net so the heavy read paths keep
//     their consistency caps and the gate without needing a live DB. ──────────
describe('heavy read path wiring (static)', () => {
  const products = fs.readFileSync(path.resolve(apiSrcRoot, 'routes', 'products.ts'), 'utf8');
  const catalog = fs.readFileSync(path.resolve(apiSrcRoot, 'routes', 'catalog.ts'), 'utf8');

  it('deals route runs the cost gate before executing the data query', () => {
    assert.match(products, /assertQueryWithinCost\(dealsClient, dealDataSql/);
    assert.match(products, /handleQueryTooExpensive\(err, res\)/);
  });

  it('deals route forces single-process execution (parallel cap)', () => {
    const dealsBlock = products.slice(products.indexOf("'/deals'"));
    assert.match(dealsBlock, /SET LOCAL max_parallel_workers_per_gather = 0/);
    assert.match(dealsBlock, /SET LOCAL work_mem/);
  });

  it('catalog exact-count path carries the same caps', () => {
    assert.match(catalog, /SET LOCAL max_parallel_workers_per_gather = 0/);
    assert.match(catalog, /SET LOCAL work_mem = '4MB'/);
  });
});
