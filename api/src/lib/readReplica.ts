import { Pool, PoolClient } from 'pg';
import { db } from '../config';

/**
 * Read-replica routing for heavy aggregate / catalog reads (BUY-45692).
 *
 * Follow-up to BUY-45671 (CEO report: 17.56% 5xx + p95 10,003ms). Heavy
 * aggregate / catalog queries (catalog stats, category rollups, deals) compete
 * with interactive /v1/products/search for shared_buffers/work_mem on the single
 * maglev Postgres. This module routes those read-only aggregates to a Railway
 * Postgres read replica when one is configured, keeping interactive search on
 * the primary.
 *
 * Design (mirrors the env-gated `vectorDb` pool in config.ts):
 *   - `replicaPool` is null until REPLICA_DATABASE_URL is set. While null,
 *     `readDb()` transparently returns the primary `db` pool, so this is a
 *     no-op in production until Bolt/Ops provisions the replica and sets the
 *     env var (BUY-45692.A). Zero behaviour change before then.
 *   - A background probe (pg_last_xact_replay_timestamp) tracks replication lag.
 *     `readDb()` routes to the replica only while lag <= REPLICA_MAX_LAG_MS;
 *     otherwise it falls back to the primary so callers never read stale data
 *     beyond the threshold (BUY-45692.C).
 *
 * Env:
 *   REPLICA_DATABASE_URL        connection string for the read replica (unset = disabled)
 *   REPLICA_POOL_MAX            max replica pool connections (default 20)
 *   REPLICA_MAX_LAG_MS          lag ceiling before falling back to primary (default 2000)
 *   REPLICA_PROBE_INTERVAL_MS   how often to probe replica lag (default 5000)
 */

const REPLICA_URL = process.env.REPLICA_DATABASE_URL || '';
const MAX_LAG_MS = parseInt(process.env.REPLICA_MAX_LAG_MS || '2000');
const PROBE_INTERVAL_MS = parseInt(process.env.REPLICA_PROBE_INTERVAL_MS || '5000');
const REPLICA_POOL_MAX = parseInt(process.env.REPLICA_POOL_MAX || '20');

const pgStatementTimeout = parseInt(process.env.PG_STATEMENT_TIMEOUT || '30000');

export const replicaPool: Pool | null = REPLICA_URL
  ? new Pool({
      connectionString: REPLICA_URL,
      max: REPLICA_POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : null;

if (replicaPool) {
  // Replica connections are read-only; apply the same statement timeout guard
  // as the primary so a runaway aggregate can't pin a replica backend.
  replicaPool.on('connect', (client) => {
    client.query(`SET statement_timeout = ${pgStatementTimeout}`).catch(() => {});
  });
  replicaPool.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[read-replica] pool error:', err.message);
    }
  });
}

// ─── Lag monitor (BUY-45692.C) ──────────────────────────────────────────────
let replicaHealthy = false;
let lastLagMs: number | null = null;
let lastProbeAt: string | null = null;
let lastError: string | null = null;

async function probeLag(): Promise<void> {
  if (!replicaPool) return;
  try {
    const r = await replicaPool.query<{ lag_seconds: number | null }>(
      `SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag_seconds`
    );
    const lagSeconds = r.rows?.[0]?.lag_seconds;
    lastProbeAt = new Date().toISOString();
    lastError = null;
    if (lagSeconds == null) {
      // NULL = not a standby (or nothing replayed yet). Don't route reads here;
      // a primary masquerading as a replica adds no isolation, and an unprimed
      // standby can't be trusted. Fall back to primary.
      replicaHealthy = false;
      lastLagMs = null;
      return;
    }
    lastLagMs = Math.max(0, Math.round(Number(lagSeconds) * 1000));
    replicaHealthy = lastLagMs <= MAX_LAG_MS;
  } catch (err) {
    replicaHealthy = false;
    lastLagMs = null;
    lastError = (err as Error).message;
    lastProbeAt = new Date().toISOString();
  }
}

if (replicaPool) {
  probeLag().catch(() => {});
  const probeTimer = setInterval(() => {
    probeLag().catch(() => {});
  }, PROBE_INTERVAL_MS);
  probeTimer.unref();
}

/**
 * Pool to use for read-only heavy aggregates. Returns the replica only while it
 * is configured AND caught up within REPLICA_MAX_LAG_MS; otherwise the primary.
 * NEVER use for writes or for interactive /v1/products/search.
 */
export function readDb(): Pool {
  return replicaHealthy && replicaPool ? replicaPool : db;
}

/** Convenience: a pooled client from the current read pool. Caller must release(). */
export function readDbConnect(): Promise<PoolClient> {
  return readDb().connect();
}

/** Observability for /v1/catalog/stats/health and ops dashboards. */
export function replicaStatus() {
  return {
    configured: Boolean(replicaPool),
    healthy: replicaHealthy,
    routing_to: replicaHealthy && replicaPool ? 'replica' : 'primary',
    lag_ms: lastLagMs,
    max_lag_ms: MAX_LAG_MS,
    last_probe_at: lastProbeAt,
    last_error: lastError,
  };
}
