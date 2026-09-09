/**
 * v2RequestLog.ts — BUY-72556 per-call telemetry for v2 MCP tools.
 *
 * BUY-72550 (Atlas) needs server-side adoption telemetry for the v2 deliver_to
 * wire (BUY-72533). Every incoming JSON-RPC `tools/call` whose `params.name`
 * ends with `_v2` MUST insert one row into `monitoring.mcp_v2_request_log`.
 * Atlas's daily 23:56Z aggregator (run off this table) emits
 * `data/v2-adoption-server-side/YYYY-MM-DD.csv` and fires the drift alert.
 *
 * Design:
 *   - Discriminator: `params.name.endsWith('_v2')` — matches live wire.
 *     v1 tools are NOT logged (no deliver_to adoption concern on v1).
 *   - Buffer: in-memory FIFO. Flushed every 5 s (FLUSH_INTERVAL_MS).
 *   - Pool: shares the existing `catalogDb` pool (catalog DB owns the table).
 *   - Failure mode: SILENT DROP. Any failure logs `[usage_metering] drop:`
 *     and removes the row from the buffer. We never block the JSON-RPC
 *     response and never throw out of the writer — telemetry is best-effort.
 *   - Insert timing: after gate decision (so `gate_rejected` rows are captured)
 *     but BEFORE returning the JSON-RPC response (so transport errors that
 *     abort before insert are NOT captured, which is correct).
 *
 * Row schema (see migrations/2026-08-21-buy-72550-mcp-v2-request-log.sql):
 *   request_id, tool_name, deliver_to_present, country_code, gate_passed,
 *   outcome, api_key_hash, received_at.
 *
 * Wire-vs-spec note: the issue described discriminating on
 * `arguments.api_version === 'v2'`, but the live wire does NOT have an
 * `api_version` argument. v2 is signalled by the `_v2` suffix on
 * `params.name`, which is what this writer matches.
 */

import { createHash } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { catalogDb } from '../config';

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER = 5_000; // hard cap to bound memory if flush stalls

export type V2RequestOutcome =
  | 'success'
  | 'gate_rejected'
  | 'rpc_error'
  | 'transport_error';

export interface V2RequestRow {
  request_id: string;
  tool_name: string;
  deliver_to_present: boolean;
  country_code: string | null;
  gate_passed: boolean;
  outcome: V2RequestOutcome;
  api_key_hash: string | null;
  received_at: Date;
}

const buffer: V2RequestRow[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushInFlight = false;
let started = false;

function hashApiKey(rawKey: string | null | undefined): string | null {
  if (!rawKey) return null;
  return createHash('sha256').update(rawKey).digest('hex').slice(0, 16);
}

/**
 * Pick the country code from the tool call arguments using the fan-in
 * precedence documented in the issue: deliver_to > country_code > country.
 * Returns null if none present (or empty).
 */
function deriveCountryCode(args: Record<string, unknown> | null | undefined): string | null {
  if (!args) return null;
  const dt = (args.deliver_to != null) ? String(args.deliver_to).trim() : '';
  if (dt) return dt.toUpperCase();
  const cc = (args.country_code != null) ? String(args.country_code).trim() : '';
  if (cc) return cc.toUpperCase();
  const c = (args.country != null) ? String(args.country).trim() : '';
  if (c) return c.toUpperCase();
  return null;
}

function deriveDeliverToPresent(args: Record<string, unknown> | null | undefined): boolean {
  if (!args) return false;
  const dt = args.deliver_to;
  if (dt == null) return false;
  return String(dt).trim().length > 0;
}

async function flushOnce(pool: Pool): Promise<void> {
  if (buffer.length === 0) return;
  if (flushInFlight) return; // next tick will pick it up
  flushInFlight = true;
  const batch = buffer.splice(0, buffer.length);
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Build a single multi-row INSERT — one round trip per flush.
    const cols = [
      'request_id',
      'tool_name',
      'deliver_to_present',
      'country_code',
      'gate_passed',
      'outcome',
      'api_key_hash',
      'received_at',
    ];
    const valuesSql: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];
      const base = i * cols.length;
      valuesSql.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
      );
      params.push(
        r.request_id,
        r.tool_name,
        r.deliver_to_present,
        r.country_code,
        r.gate_passed,
        r.outcome,
        r.api_key_hash,
        r.received_at,
      );
    }
    const sql = `INSERT INTO monitoring.mcp_v2_request_log (${cols.join(', ')}) VALUES ${valuesSql.join(', ')}`;
    await client.query(sql, params);
    await client.query('COMMIT');
  } catch (err) {
    // Silent drop — never block the JSON-RPC response. Buffer is already
    // spliced; we log the reason once and move on.
    try {
      if (client) await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[usage_metering] drop: ${batch.length} rows (reason: ${reason})`);
  } finally {
    if (client) {
      try {
        client.release();
      } catch {
        // ignore release errors
      }
    }
    flushInFlight = false;
  }
}

function scheduleFlush(pool: Pool): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushOnce(pool).catch((err) => {
      console.error('[usage_metering] flush error:', err);
    });
  }, FLUSH_INTERVAL_MS);
  // Allow Node to exit even if a timer is pending.
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

/**
 * Start the periodic flush timer. Idempotent. Safe to call multiple times.
 * Exposed so the API entrypoint can wire it during startup.
 */
export function startV2RequestLog(pool: Pool = catalogDb): void {
  if (started) return;
  started = true;
  // Initial flush in case rows were enqueued before startup.
  scheduleFlush(pool);
}

/**
 * Stop the writer. Flushes any pending rows synchronously (best-effort).
 */
export async function stopV2RequestLog(pool: Pool = catalogDb): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushOnce(pool);
}

/**
 * Build a `{request_id, tool_name, deliver_to_present, country_code, gate_passed,
 * api_key_hash}` partial row from the JSON-RPC envelope. Used by the wire
 * dispatch to compute the common fields before/after the gate check.
 *
 * The caller chooses `gate_passed` and `outcome` based on whether the gate
 * fired (-32602) or the handler returned a result/error.
 */
export function buildV2RequestRow(input: {
  requestId: unknown;
  toolName: string;
  args: Record<string, unknown> | null | undefined;
  apiKey: string | null | undefined;
  gatePassed: boolean;
  outcome: V2RequestOutcome;
}): V2RequestRow {
  const requestId = (input.requestId == null || input.requestId === '')
    ? 'unknown'
    : String(input.requestId);
  return {
    request_id: requestId,
    tool_name: input.toolName,
    deliver_to_present: deriveDeliverToPresent(input.args),
    country_code: deriveCountryCode(input.args),
    gate_passed: input.gatePassed,
    outcome: input.outcome,
    api_key_hash: hashApiKey(input.apiKey),
    received_at: new Date(),
  };
}

/**
 * Enqueue a row for the next batched flush. Best-effort: a buffer overflow
 * logs `[usage_metering] drop:` and drops the row. Never throws.
 */
export function recordV2Request(row: V2RequestRow, pool: Pool = catalogDb): void {
  if (buffer.length >= MAX_BUFFER) {
    console.error(`[usage_metering] drop: buffer full (${MAX_BUFFER} rows), dropping row for tool=${row.tool_name}`);
    return;
  }
  buffer.push(row);
  if (buffer.length === 1) {
    scheduleFlush(pool);
  }
}
