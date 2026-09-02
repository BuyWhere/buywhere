import { Pool } from 'pg';
import Redis from 'ioredis';

// BUY-51454: a missing DATABASE_URL used to silently fall back to localhost:5432, which
// made every deploy crash with `pg-pool ECONNREFUSED 127.0.0.1:5432` from the p95-probe
// scheduler. Log loudly so the actual root cause (missing Railway Postgres reference) is
// visible in startup logs instead of masquerading as a code bug. The pool itself is still
// created — runtime callers (with try/catch) keep working — but the warning is unmissable.
if (!process.env.DATABASE_URL) {
  console.error(
    '[config] FATAL: DATABASE_URL is not set. Falling back to postgresql://localhost:5432/buywhere, ' +
    'which will fail ECONNREFUSED inside this container. Check the Railway service ' +
    'reference to Postgres / `maglev`.'
  );
}

export const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/buywhere',
  max: parseInt(process.env.PG_POOL_MAX || '50'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Replica DB pool for read-heavy operations (e.g., embedding pipeline).
// Explicitly gated by REPLICA_DATABASE_URL so callers can enforce replica-only
// reads instead of silently falling back to the primary.
//
// BUY-60378: set statement_timeout on replicaDb so queries fail deterministically
// (57014) instead of waiting for the Railway proxy idle-client teardown (~3 min).
// 60 s gives index-backed scans ample room while capping wasted wall-clock on
// planner regressions.
const replicaStatementTimeout = parseInt(process.env.REPLICA_STATEMENT_TIMEOUT || '60000');

export const replicaDb: Pool | null = process.env.REPLICA_DATABASE_URL
  ? new Pool({
      connectionString: process.env.REPLICA_DATABASE_URL,
      max: parseInt(process.env.PG_POOL_MAX || '20'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : null;

if (replicaDb) {
  replicaDb.on('connect', (client) => {
    client.query(`SET statement_timeout = ${replicaStatementTimeout}`).catch(() => {});
  });
}

const pgStatementTimeout = parseInt(process.env.PG_STATEMENT_TIMEOUT || '30000');
const pgLockTimeout = parseInt(process.env.PG_LOCK_TIMEOUT || '2000');

db.on('connect', (client) => {
  Promise.all([
    client.query(`SET statement_timeout = ${pgStatementTimeout}`),
    client.query(`SET lock_timeout = ${pgLockTimeout}`),
  ]).catch(() => {});
});

// BUY-53789: catalog reads (search, stats, product lookups) serve the canonical
// maglev catalog (~127M) when CATALOG_DATABASE_URL is set; otherwise they fall back
// to the primary `db` (zero behavior change). Auth and ALL writes stay on `db`.
export const catalogDb: Pool = process.env.CATALOG_DATABASE_URL
  ? new Pool({
      connectionString: process.env.CATALOG_DATABASE_URL,
      max: parseInt(process.env.CATALOG_POOL_MAX || '30'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : db;

if (process.env.CATALOG_DATABASE_URL) {
  catalogDb.on('connect', (client) => {
    Promise.all([
      client.query(`SET statement_timeout = ${pgStatementTimeout}`),
      client.query(`SET lock_timeout = ${pgLockTimeout}`),
    ]).catch(() => {});
  });
}

// BUY-33815: swallow idle-client errors so a Postgres restart (which terminates
// every in-flight socket) does not surface as a process-level uncaughtException.
// The pool will reconnect on the next checkout. Sentry still sees it via the
// global uncaughtException/unhandledRejection handlers in index.ts, but the
// process stays up. Without this, BUY-33735-style crashes recurred on every
// Railway Postgres maintenance window.
db.on('error', (err) => {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const isConnectionLoss =
    code === 'ECONNRESET' ||
    code === '08006' || // SQLSTATE connection_failure
    code === '57P' ||   // admin_shutdown (Postgres fast shutdown)
    code === '57P01' || // admin_shutdown
    code === '57P02' || // crash_shutdown
    code === '57P03';   // cannot_connect_now
  if (isConnectionLoss) {
    console.warn(
      '[pg-pool] idle client error (expected during PG restart, pool will reconnect):',
      (err as Error).message
    );
    return;
  }
  // Unknown error on an idle client — log loudly but do not crash.
  console.error('[pg-pool] unexpected idle client error:', err);
});

export const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6380'),
  maxRetriesPerRequest: 0,
  commandTimeout: 500,
  connectTimeout: 2000,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});
// Suppress unhandled-error crashes from Redis reconnect attempts
redis.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[redis] connection error:', err.message);
  }
});

export const PORT = parseInt(process.env.PORT || '3000');
export const API_BASE_URL = process.env.API_BASE_URL || 'https://api.buywhere.ai';

export const FREE_TIER = {
  rpm: 10,
  daily: 10000,
};

export const TIER_LIMITS: Record<string, { rpm: number; daily: number; weekly?: number; monthlyCap?: number; overageRate?: number }> = {
  free: FREE_TIER,
  starter: { rpm: 100, daily: 10000 },
  pro: { rpm: 500, daily: 100000 },
  unverified: { rpm: 20, daily: 1000 },
  // BUY-72774 + 2026-08-24 (Richmond): pending-verify = the AGENT SELF-SERVE tier.
  // Usable without any human step: 1000/day, 5000/week. Abuse guards: 3 keys/24h/IP
  // (enforced at first use) + rpm cap. Email verification still upgrades to 10k/day.
  pending_verify: { rpm: 60, daily: 1000, weekly: 5000 },
  // BUY-75313: keyless GET identity — same self-serve quota as pending_verify.
  anonymous: { rpm: 60, daily: 1000 },
  verified_agent: { rpm: 200, daily: 10000 },
  enterprise: { rpm: 1000, daily: 100000 },
  platform_starter: { rpm: 500, daily: 500000, monthlyCap: 500000, overageRate: 0.002 },
  internal: { rpm: 10000, daily: 999999 },
  // BUY-78624: monitoring-tier keys previously fell through to FREE_TIER (10K/day)
  // and exhausted before market Cat A smokes (MY at 12:07Z). Internal probes must
  // not share the customer 10K cap.
  monitoring: { rpm: 1000, daily: 100000 },
};
// Vector DB pool — separate Railway Postgres with pgvector 0.8 (BUY-41135).
// Null when VECTOR_DB_URL is unset; consumers must check before using.
//
// BUY-41137: set statement_timeout so slow KNN queries (e.g. large HNSW scan on
// a mixed-dim index, or cross-dimension rejection) fail fast instead of hanging
// for the idleTimeout window and exhausting the pool (max=5). The fallback path
// (brand/category + FTS) then executes promptly on the main db pool.
// 10 s is generous for an HNSW-approximate nearest-neighbour scan with <=1000 rows.
const vectorStatementTimeout = parseInt(process.env.VECTOR_STATEMENT_TIMEOUT || '10000');

export const vectorDb: Pool | null = process.env.VECTOR_DB_URL
  ? (() => {
      const pool = new Pool({
        connectionString: process.env.VECTOR_DB_URL!,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
      pool.on('connect', (client) => {
        client.query(`SET statement_timeout = ${vectorStatementTimeout}`).catch(() => {});
      });
      return pool;
    })()
  : null;
