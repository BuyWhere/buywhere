// BUY-45691: API query-cost gate.
//
// Durable guard, follow-up to BUY-45671 (search 504 hotfix). The hotfix removed
// the acute 504 by restoring GIN-index usage and disabling parallel workers on
// /v1/products/search. This module is the *generic* defence so that no single
// un-indexed / aggregate query can ever again drive p95 to the statement_timeout.
//
// Mechanism: before running a heavy aggregate / COUNT / sort query, run a
// planning-only `EXPLAIN (FORMAT JSON)` (no ANALYZE — it does not execute the
// query, it only asks the planner for a cost estimate) and read the top node's
// `Total Cost`. If the estimate exceeds the configured limit, short-circuit with
// a structured `query_too_expensive` error (HTTP 422) instead of letting the
// query run to the statement_timeout and burn a connection for 15s.
//
// Cost units are the planner's own abstract units (not milliseconds): the
// index-backed happy path plans in the hundreds-to-low-thousands, while a
// near-full scan + sort of a products_* partition is 10^5+ and the 82M-row
// parent scan that caused the 504 is 10^6+. The limit is env-tunable so Ops can
// calibrate it against prod EXPLAIN without a code change.
//
// Rollout safety: defaults to `observe` mode, which only *logs* would-be
// rejections (no behaviour change) so the threshold can be calibrated from real
// traffic before flipping `QUERY_COST_GATE_MODE=enforce` to start returning 422.

import type { Pool, PoolClient } from 'pg';

// Anything with a node-postgres-style `query` method (Pool or a checked-out
// PoolClient). Kept structural so callers can pass either.
export interface QueryExecutor {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export type QueryCostGateMode = 'observe' | 'enforce';

// Default planner-cost ceiling. Deliberately high so the first deploy cannot
// 422 legitimate prod traffic; Ops tightens it via QUERY_COST_LIMIT after
// calibrating against prod EXPLAIN (see BUY-45691 "Done when").
export const DEFAULT_QUERY_COST_LIMIT = 1_000_000;

export function getQueryCostLimit(): number {
  const raw = process.env.QUERY_COST_LIMIT;
  if (!raw) return DEFAULT_QUERY_COST_LIMIT;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_QUERY_COST_LIMIT;
}

export function getQueryCostGateMode(): QueryCostGateMode {
  return process.env.QUERY_COST_GATE_MODE === 'enforce' ? 'enforce' : 'observe';
}

export interface CostEstimate {
  totalCost: number;
  planRows: number;
}

export class QueryTooExpensiveError extends Error {
  readonly estimatedCost: number;
  readonly costLimit: number;
  constructor(estimatedCost: number, costLimit: number) {
    super(`query_too_expensive: estimated planner cost ${estimatedCost} exceeds limit ${costLimit}`);
    this.name = 'QueryTooExpensiveError';
    this.estimatedCost = estimatedCost;
    this.costLimit = costLimit;
  }
}

// Shape of the relevant slice of `EXPLAIN (FORMAT JSON)` output.
interface ExplainNode {
  'Total Cost'?: number;
  'Plan Rows'?: number;
}
interface ExplainRow {
  'QUERY PLAN'?: Array<{ Plan?: ExplainNode }>;
}

// Run a planning-only EXPLAIN and return the top node's total cost + row
// estimate. The same `params` you would pass to the real query must be passed
// here so the planner sees the same parameterised statement.
//
// Fails *open*: if EXPLAIN itself errors or the plan can't be parsed, returns a
// zero estimate rather than throwing — the gate must never be the reason a
// request fails when the underlying query would have been fine.
export async function estimateQueryCost(
  executor: QueryExecutor,
  sql: string,
  params: unknown[] = [],
): Promise<CostEstimate> {
  try {
    const res = await executor.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
    const row = res.rows?.[0] as ExplainRow | undefined;
    const plan = row?.['QUERY PLAN']?.[0]?.Plan;
    if (!plan) return { totalCost: 0, planRows: 0 };
    return {
      totalCost: Number(plan['Total Cost'] ?? 0),
      planRows: Number(plan['Plan Rows'] ?? 0),
    };
  } catch (err) {
    console.warn('[queryCostGate] EXPLAIN failed, allowing query through:', (err as Error).message);
    return { totalCost: 0, planRows: 0 };
  }
}

export interface AssertCostOptions {
  /** Label for logs, e.g. the route name. */
  label?: string;
  /** Override the env-derived cost limit (mainly for tests). */
  costLimit?: number;
  /** Override the env-derived mode (mainly for tests). */
  mode?: QueryCostGateMode;
}

// Estimate the query's planner cost and enforce the gate.
//
// - Returns the estimate when the query is within budget.
// - In `enforce` mode, throws QueryTooExpensiveError when over budget.
// - In `observe` mode (default), logs a warning and returns the estimate so the
//   caller proceeds unchanged — used to calibrate the threshold before enforcing.
export async function assertQueryWithinCost(
  executor: QueryExecutor,
  sql: string,
  params: unknown[] = [],
  options: AssertCostOptions = {},
): Promise<CostEstimate> {
  const costLimit = options.costLimit ?? getQueryCostLimit();
  const mode = options.mode ?? getQueryCostGateMode();
  const label = options.label ?? 'query';

  const estimate = await estimateQueryCost(executor, sql, params);

  if (estimate.totalCost > costLimit) {
    if (mode === 'enforce') {
      console.warn(
        `[queryCostGate] BLOCK ${label}: estimated cost ${estimate.totalCost} > limit ${costLimit} (enforce)`,
      );
      throw new QueryTooExpensiveError(estimate.totalCost, costLimit);
    }
    console.warn(
      `[queryCostGate] WOULD-BLOCK ${label}: estimated cost ${estimate.totalCost} > limit ${costLimit} (observe — allowing through)`,
    );
  }

  return estimate;
}

// Express helper: turn a QueryTooExpensiveError into the structured 422 response.
// Returns true if it handled the error (caller should stop), false otherwise.
export function handleQueryTooExpensive(
  err: unknown,
  res: { headersSent: boolean; status: (code: number) => { json: (body: unknown) => unknown } },
): boolean {
  if (!(err instanceof QueryTooExpensiveError)) return false;
  if (!res.headersSent) {
    res.status(422).json({
      error: 'query_too_expensive',
      message:
        'This query would scan more data than the API permits. Narrow your filters ' +
        '(e.g. add country_code / category, or a tighter price or discount range) and retry.',
      estimated_cost: err.estimatedCost,
      cost_limit: err.costLimit,
    });
  }
  return true;
}
