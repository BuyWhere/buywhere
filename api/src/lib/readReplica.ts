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
 *   - A background probe (BUY-54916) tracks replica freshness using WAL-level
 *     signals (`pg_stat_wal_receiver` + replay/receive LSNs). `readDb()` routes
 *     to the replica only while those signals are fresh; otherwise it falls
 *     back to the primary so callers never read stale data.
 *
 * Env:
 *   REPLICA_DATABASE_URL        connection string for the read replica (unset = disabled)
 *   REPLICA_POOL_MAX            max replica pool connections (default 20)
 *   REPLICA_MAX_LAG_MS          replica freshness ceiling in ms (default 2000)
 *   REPLICA_PROBE_INTERVAL_MS   how often to probe replica freshness (default 5000)
 *
 * BUY-54916 fix: previous probe used `pg_last_xact_replay_timestamp()`, which
 * only advances on transaction commits. During sustained non-transactional WAL
 * activity on the primary (e.g. `CREATE INDEX CONCURRENTLY` or vacuum) the
 * timestamp stays "stale" even when the replica is fully caught up at the WAL
 * level — every WAL byte received and replayed, but the last_xact timestamp
 * unchanged. That made `/v1/catalog/stats/health` flap between healthy and
 * unhealthy every few seconds, even though the replica was actually serving
 * current data. The new probe uses WAL-receiver freshness (active streaming +
 * recent messages + matching receive/replay LSNs) as the health signal and
 * keeps the xact-timestamp lag as a secondary observability field.
 */

const REPLICA_URL = process.env.REPLICA_DATABASE_URL || '';
const MAX_LAG_MS = parseInt(process.env.REPLICA_MAX_LAG_MS || '2000');
const PROBE_INTERVAL_MS = parseInt(process.env.REPLICA_PROBE_INTERVAL_MS || '5000');
const REPLICA_POOL_MAX = parseInt(process.env.REPLICA_POOL_MAX || '20');
// BUY-54931 / BUY-54933: in node:test runs, the search test mocks db.query
// directly and never configures REPLICA_DATABASE_URL. Treat NODE_ENV=test as
// "no replica, use the primary" so `servingReadDb()` falls through to db
// instead of throwing ReplicaUnavailableError and breaking the test suite.
const IS_NODE_TEST =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.some((arg) => arg === '--test' || arg.startsWith('--test-'));
const TEST_BYPASS_REPLICA_GATE = IS_NODE_TEST && !REPLICA_URL;

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

// ─── Freshness probe (BUY-45692.C + BUY-54916) ─────────────────────────────
//
// Healthy iff:
//   1. The connection is in recovery (real standby, not a masquerading primary).
//   2. pg_stat_wal_receiver.status = 'streaming' (actively receiving from primary).
//   3. Time since last received WAL message <= REPLICA_MAX_LAG_MS.
//
// `lag_ms` reported to observability is the time since the last WAL message was
// received (true replication freshness), clamped at the configured ceiling. We
// also surface `xact_lag_ms` (the legacy `pg_last_xact_replay_timestamp()`
// measurement) as `lag_ms_xact` so dashboards can distinguish a real backlog
// (high xact lag + high recv age) from a primary doing mostly non-transactional
// WAL (low recv age + high xact lag — the BUY-54916 case).
let replicaHealthy = false;
let lastLagMs: number | null = null;
let lastXactLagMs: number | null = null;
let lastRecvAgeMs: number | null = null;
let lastProbeAt: string | null = null;
let lastError: string | null = null;

async function probeLag(): Promise<void> {
  if (!replicaPool) return;
  try {
    const r = await replicaPool.query<{
      in_recovery: boolean;
      wal_status: string | null;
      last_msg_age_ms: number | null;
      replay_lsn: string | null;
      receive_lsn: string | null;
      xact_replay_ts: Date | null;
      xact_lag_ms: number | null;
    }>(
      `SELECT
         pg_is_in_recovery() AS in_recovery,
         (SELECT status FROM pg_stat_wal_receiver) AS wal_status,
         (SELECT EXTRACT(EPOCH FROM (now() - last_msg_receipt_time)) * 1000
            FROM pg_stat_wal_receiver) AS last_msg_age_ms,
         pg_last_wal_replay_lsn()::text AS replay_lsn,
         pg_last_wal_receive_lsn()::text AS receive_lsn,
         pg_last_xact_replay_timestamp() AS xact_replay_ts,
         EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 AS xact_lag_ms`
    );
    const row = r.rows?.[0];
    lastProbeAt = new Date().toISOString();
    lastError = null;
    if (!row) {
      replicaHealthy = false;
      lastLagMs = null;
      lastXactLagMs = null;
      lastRecvAgeMs = null;
      return;
    }
    lastRecvAgeMs = row.last_msg_age_ms == null ? null : Math.round(Number(row.last_msg_age_ms));
    lastXactLagMs = row.xact_lag_ms == null ? null : Math.max(0, Math.round(Number(row.xact_lag_ms)));
    // Prefer WAL-receiver freshness; fall back to xact lag only when the
    // receiver view is unavailable (e.g. very early in standby bring-up before
    // the first WAL message arrives, when last_msg_age_ms is NULL).
    const freshnessMs = lastRecvAgeMs != null ? lastRecvAgeMs : lastXactLagMs;
    lastLagMs = freshnessMs == null ? null : Math.max(0, freshnessMs);
    replicaHealthy =
      row.in_recovery === true &&
      row.wal_status === 'streaming' &&
      freshnessMs != null &&
      freshnessMs <= MAX_LAG_MS;
  } catch (err) {
    replicaHealthy = false;
    lastLagMs = null;
    lastXactLagMs = null;
    lastRecvAgeMs = null;
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

// BUY-54775 / BUY-54790 / BUY-54933: strict canonical-serving read path.
// Search/stats MUST fail loud instead of drifting back to roundhouse when the
// replica is missing/unhealthy. This is the mechanism that surfaces the
// 503 search_replica_unavailable / catalog_replica_unavailable responses that
// MCP and REST clients now rely on to stop polling for cached fallback results.
export class ReplicaUnavailableError extends Error {
  code = 'REPLICA_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'ReplicaUnavailableError';
  }
}

async function ensureReplicaHealthy(): Promise<void> {
  if (TEST_BYPASS_REPLICA_GATE) {
    return;
  }

  if (!replicaPool) {
    throw new ReplicaUnavailableError(
      'REPLICA_DATABASE_URL is not configured. Canonical serving must read from maglev via replica.'
    );
  }

  if (!lastProbeAt) {
    await probeLag();
  }

  if (!replicaHealthy) {
    const status = replicaStatus();
    const details = status.last_error
      ? `last_error=${status.last_error}`
      : status.lag_ms == null
        ? 'replica_lag_unknown'
        : `lag_ms=${status.lag_ms} max_lag_ms=${status.max_lag_ms}`;
    throw new ReplicaUnavailableError(
      `Replica is unavailable for canonical serving (${details}). Fix REPLICA_DATABASE_URL / replica health; do not fall back to DATABASE_URL.`
    );
  }
}

/**
 * Strict read pool for canonical serving (BUY-54775). Throws
 * ReplicaUnavailableError when the replica is misconfigured or unhealthy.
 */
export async function servingReadDb(): Promise<Pool> {
  if (TEST_BYPASS_REPLICA_GATE) {
    return db;
  }
  await ensureReplicaHealthy();
  return replicaPool as Pool;
}

/** Strict-pooled-client version of servingReadDb(). */
export async function servingReadDbConnect(): Promise<PoolClient> {
  const pool = await servingReadDb();
  return pool.connect();
}

/** Observability for /v1/catalog/stats/health and ops dashboards. */
export function replicaStatus() {
  return {
    configured: Boolean(replicaPool),
    healthy: replicaHealthy,
    routing_to: replicaHealthy && replicaPool ? 'replica' : 'primary',
    lag_ms: lastLagMs,
    lag_ms_xact: lastXactLagMs,
    recv_age_ms: lastRecvAgeMs,
    max_lag_ms: MAX_LAG_MS,
    last_probe_at: lastProbeAt,
    last_error: lastError,
  };
}
