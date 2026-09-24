/**
 * v2KpiWriter.ts — BUY-75415 forward-direction INSERTs into the P2.6/P2.7 sinks.
 *
 * Why this file exists:
 *   BUY-75183 shipped the sinks (monitoring.mcp_empty_responses +
 *   monitoring.deliver_to_calls) and the v_ceo_kpis readback. The 14-day
 *   rolling acceptance clock for P2.6 (silently_empty_rate_24h) and P2.7
 *   (deliver_to_pass_rate_24h) cannot start until the API wire writes to
 *   those tables. This module is the wire-side INSERT path.
 *
 * Scope:
 *   - Every v2 tools/call that returns >=1 product  → 1 row in deliver_to_calls.
 *   - Every non-error v2 response with result_count=0 AND a non-null
 *     emptiness_reason on the response meta               → 1 row in mcp_empty_responses.
 *   - Internal probes (is_internal=true) are filtered BEFORE any write —
 *     the gate metric is external-agent rows only.
 *   - Fire-and-forget (mirrors shoppingJobFunnel): in-memory FIFO flushed
 *     every 2 seconds so the per-request path never blocks on Postgres.
 *
 * Out of scope:
 *   - v1 tools are not written to these sinks (deliver_to is not a v1 concern).
 *   - Backfill of historical rows is BUY-75183's responsibility (already done).
 *   - The mcp_v2_request_log wire is a sibling of this module and is not
 *     touched here (BUY-72550 / Atlas).
 *
 * Pool: writes go to the primary DB (db) — same as the rest of the
 * monitoring.* schema. The catalog replica is read-only and not used here.
 */

import type { Pool } from 'pg';
import { db } from '../config';

// v2 buyer-context tools. Mirrors V2_BUYER_TOOLS in api/src/routes/mcp.ts;
// kept as a separate constant so this module has no MCP-route dependency.
const V2_TOOLS = new Set([
  'search_products_v2',
  'get_product_v2',
  'compare_products_v2',
  'get_deals_v2',
  'find_best_price_v2',
]);

// Known internal/probe API key prefixes — same set as shoppingJobFunnel.ts.
// Probes and health checks use these prefixes; their rows MUST be excluded
// from the gate metric so internal-volume doesn't mask real adoption.
const INTERNAL_KEY_PREFIXES = ['rex-', 'monitor-', 'health-', 'atlas-', 'probe-', 'test-'];

const FLUSH_INTERVAL_MS = 2_000;
const MAX_BUFFER = 5_000;

interface DeliverToRow {
  kind: 'deliver_to';
  tool_name: string;
  deliver_to: string | null;
  deliver_to_inferred: boolean;
  gate_passed: boolean;
  empty: boolean;
  query_intent: string | null;
  result_count: number;
  bucket: 'external-agent' | 'internal';
  called_at: Date;
}

interface EmptyRow {
  kind: 'empty_response';
  tool_name: string;
  region: string | null;
  category: string | null;
  emptiness_reason: string | null;
  confidence: string | null;
  engine_status: string | null;
  indexed_for_region: boolean | null;
  category_recognized: boolean | null;
  rate_limit_remaining: number | null;
  bucket: 'external-agent' | 'internal';
  called_at: Date;
}

type KpiRow = DeliverToRow | EmptyRow;

const buffer: KpiRow[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushInFlight = false;
let started = false;

/**
 * Classify whether the API key is internal (probe/health/monitor/rex prefix).
 * Mirrors shoppingJobFunnel.classifyIsInternal. Re-derived locally so this
 * module doesn't depend on a non-exported helper.
 */
function classifyIsInternal(apiKey: string | null | undefined): boolean {
  if (!apiKey) return false;
  const lower = apiKey.toLowerCase();
  return INTERNAL_KEY_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Derive deliver_to from tool args. Mirrors the v2 inference rule used by
 * the MCP handler: deliver_to > country_code > country. Returns null if
 * none was supplied AND none could be inferred — empty-string would be
 * a false positive and would pollute the bucket column.
 */
function deriveDeliverTo(args: Record<string, unknown> | null | undefined): string | null {
  if (!args) return null;
  const dt = args.deliver_to;
  if (typeof dt === 'string' && dt.trim()) return dt.trim().toUpperCase();
  const cc = args.country_code;
  if (typeof cc === 'string' && cc.trim()) return cc.trim().toUpperCase();
  const c = args.country;
  if (typeof c === 'string' && c.trim()) return c.trim().toUpperCase();
  return null;
}

/**
 * Derive the query intent label for the row's query_intent column.
 * Picks the first non-empty key among the canonical buyer-intent args.
 * Truncated to 200 chars to keep the column narrow (TEXT, no index on the body).
 */
function deriveQueryIntent(args: Record<string, unknown> | null | undefined): string | null {
  if (!args) return null;
  const candidates = ['q', 'category', 'ids', 'product_name', 'query'];
  for (const key of candidates) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200);
    if (Array.isArray(v) && v.length > 0) return `[${v.length} items]`.slice(0, 200);
  }
  return null;
}

/**
 * Extract the response result_count from a v2 tool response.
 * Returns null when the response shape is unrecognised or the call errored.
 * Mirrors the same data/results/products/items convention used elsewhere in
 * the codebase (e.g. queryLog.extractResultCount).
 */
function extractResultCount(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.data)) return r.data.length;
  if (Array.isArray(r.results)) return r.results.length;
  if (Array.isArray(r.products)) return r.products.length;
  if (Array.isArray(r.items)) return r.items.length;
  // find_best_price_v2: best_price + alternatives
  if (r.best_price && typeof r.best_price === 'object') {
    const alts = Array.isArray(r.alternatives) ? r.alternatives.length : 0;
    return 1 + alts;
  }
  return null;
}

/**
 * Extract the response meta block from a v2 result. Returns {} if missing.
 */
function extractMeta(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const r = result as Record<string, unknown>;
  if (r.meta && typeof r.meta === 'object') return r.meta as Record<string, unknown>;
  return {};
}

/**
 * Drain the buffer in one batched transaction. Two separate INSERTs (one per
 * table). Failures log to stderr but never block the response — the
 * gate-counter is best-effort observability, not a billing path.
 */
async function flushOnce(pool: Pool): Promise<void> {
  if (buffer.length === 0) return;
  if (flushInFlight) return;
  flushInFlight = true;

  const batch = buffer.splice(0, buffer.length);
  const deliverRows = batch.filter((r): r is DeliverToRow => r.kind === 'deliver_to');
  const emptyRows = batch.filter((r): r is EmptyRow => r.kind === 'empty_response');

  let client: import('pg').PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    if (deliverRows.length > 0) {
      const cols = [
        'tool_name',
        'deliver_to_iso',
        'deliver_to_inferred',
        'gate_passed',
        'empty',
        'query_intent',
        'result_count',
        'bucket',
        'called_at',
      ];
      const valuesSql: string[] = [];
      const params: unknown[] = [];
      for (let i = 0; i < deliverRows.length; i++) {
        const r = deliverRows[i];
        const base = i * cols.length;
        valuesSql.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
        );
        params.push(
          r.tool_name,
          r.deliver_to,
          r.deliver_to_inferred,
          r.gate_passed,
          r.empty,
          r.query_intent,
          r.result_count,
          r.bucket,
          r.called_at
        );
      }
      await client.query(
        `INSERT INTO monitoring.deliver_to_calls (${cols.join(', ')}) VALUES ${valuesSql.join(', ')}`,
        params
      );
    }

    if (emptyRows.length > 0) {
      const cols = [
        'tool_name',
        'region',
        'category',
        'emptiness_reason',
        'confidence',
        'engine_status',
        'indexed_for_region',
        'category_recognized',
        'rate_limit_remaining',
        'called_at',
      ];
      const valuesSql: string[] = [];
      const params: unknown[] = [];
      for (let i = 0; i < emptyRows.length; i++) {
        const r = emptyRows[i];
        const base = i * cols.length;
        valuesSql.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`
        );
        params.push(
          r.tool_name,
          r.region,
          r.category,
          r.emptiness_reason,
          r.confidence,
          r.engine_status,
          r.indexed_for_region,
          r.category_recognized,
          r.rate_limit_remaining,
          r.called_at
        );
      }
      // bucket column lives on monitoring.deliver_to_calls; mcp_empty_responses
      // stores raw diagnostics and the gate metric excludes internal probes via
      // api_keys.is_internal at the source, so we do NOT add a bucket column here.
      await client.query(
        `INSERT INTO monitoring.mcp_empty_responses (${cols.join(', ')}) VALUES ${valuesSql.join(', ')}`,
        params
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch { /* swallow */ }
    // Silent drop on failure — never block the response. A single console.warn
    // per flush attempt is enough for ops to see the issue if the buffer grows.
    console.warn(
      `[v2KpiWriter] flush failed (${batch.length} rows dropped): ${(err as Error)?.message?.slice(0, 160) ?? err}`
    );
  } finally {
    if (client) {
      try { client.release(); } catch { /* swallow */ }
    }
    flushInFlight = false;
  }
}

/**
 * Start the periodic flush timer. Idempotent — safe to call from module load.
 * Mirrors shoppingJobFunnel.startShoppingJobFunnel.
 */
export function startV2KpiWriter(pool: Pool = db): void {
  if (started) return;
  started = true;
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushOnce(pool).catch(() => { /* swallowed inside flushOnce */ });
  }, FLUSH_INTERVAL_MS);
  // Don't keep the event loop alive for the flush timer (process can exit cleanly).
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

/**
 * Stop the flush timer and drain remaining rows. Used by graceful shutdown
 * and tests. Mirrors shoppingJobFunnel.stopShoppingJobFunnel.
 */
export async function stopV2KpiWriter(pool: Pool = db): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushOnce(pool);
  started = false;
}

/**
 * Enqueue a forward-direction row from a v2 tools/call response.
 *
 * Called from api/src/routes/mcp.ts after the v2 handler returns. Skips
 * silently when:
 *   - toolName is not a v2 tool (defensive — caller should already gate this).
 *   - apiKey is internal (probe/health/monitor prefix).
 *   - the response is an error envelope (statusCode >= 400).
 *
 * Otherwise enqueues AT MOST one row: a deliver_to_calls row if the response
 * returned >=1 product OR a mcp_empty_responses row if the response returned
 * 0 with a non-null emptiness_reason. Both cases are mutually exclusive.
 *
 * @param input.toolName        The v2 tool name (must end in _v2).
 * @param input.args            The v2 tool arguments (deliver_to/country_code etc).
 * @param input.apiKey          The raw API key string (used only for the internal-prefix
 *                              classification; never stored).
 * @param input.result          The handler response object (or null on error).
 * @param input.statusCode      HTTP-equivalent status code (200 / 4xx / 5xx).
 */
export function recordV2KpiSink(input: {
  toolName: string;
  args: Record<string, unknown>;
  apiKey: string | null | undefined;
  result: unknown;
  statusCode: number;
}): void {
  const { toolName, args, apiKey, result, statusCode } = input;

  // Defensive gating: not a v2 tool, OR is internal probe, OR transport error.
  if (!V2_TOOLS.has(toolName)) return;
  const isInternal = classifyIsInternal(apiKey);
  if (isInternal) return; // gate metric is external-agent only
  if (statusCode >= 400) return; // only successful (200 OK) responses

  const resultCount = extractResultCount(result);
  const meta = extractMeta(result);
  const calledAt = new Date();

  if (resultCount !== null && resultCount >= 1) {
    const deliverTo = deriveDeliverTo(args);
    const deliverToInferred = !(typeof args?.deliver_to === 'string' && args.deliver_to.trim());
    // gate_passed = deliver_to was present OR inferred from country_code/country.
    // INVALID_DELIVER_TO (BUY-72700) returns 200 + empty result with
    // emptiness_reason='invalid_deliver_to', so gate_passed=false there. That
    // case is captured by extractResultCount returning 0 — it goes to the
    // empty-responses branch, not here.
    const gatePassed = deliverTo !== null;

    buffer.push({
      kind: 'deliver_to',
      tool_name: toolName,
      deliver_to: deliverTo,
      deliver_to_inferred: deliverToInferred,
      gate_passed: gatePassed,
      empty: false,
      query_intent: deriveQueryIntent(args),
      result_count: resultCount,
      bucket: 'external-agent',
      called_at: calledAt,
    });
    return;
  }

  // result_count === 0 (or shape-unrecognised null) AND a non-null emptiness_reason.
  // The spec says "every non-error v2 response where result_count=0 AND
  // emptiness_reason is set". Shape-unrecognised responses don't qualify.
  const emptinessReason = typeof meta.emptiness_reason === 'string' ? meta.emptiness_reason : null;
  if (resultCount !== 0 || !emptinessReason) return;

  const diagnostic =
    meta.diagnostic && typeof meta.diagnostic === 'object'
      ? (meta.diagnostic as Record<string, unknown>)
      : {};

  buffer.push({
    kind: 'empty_response',
    tool_name: toolName,
    region: deriveDeliverTo(args),
    category: typeof args?.category === 'string' ? args.category : null,
    emptiness_reason: emptinessReason,
    confidence: typeof meta.confidence === 'string' ? meta.confidence : null,
    engine_status: typeof diagnostic.engine_status === 'string' ? diagnostic.engine_status : null,
    indexed_for_region: typeof diagnostic.indexed_for_region === 'boolean' ? diagnostic.indexed_for_region : null,
    category_recognized: typeof diagnostic.category_recognized === 'boolean' ? diagnostic.category_recognized : null,
    rate_limit_remaining: typeof diagnostic.rate_limit_remaining === 'number' ? diagnostic.rate_limit_remaining : null,
    bucket: 'external-agent',
    called_at: calledAt,
  });
}

// Auto-start on module load (idempotent — matches shoppingJobFunnel).
startV2KpiWriter();
