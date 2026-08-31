import { Pool, PoolConfig } from 'pg';
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

// BUY-76552: prepareThreshold=0 prevents Railway PostgreSQL proxy from mishandling
// the Prepare/Execute cycle across connections reused for multiple query shapes.
export const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/buywhere',
  max: parseInt(process.env.PG_POOL_MAX || '50'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
} as PoolConfig);
// @ts-ignore prepareThreshold not in pg@8 PoolConfig types but accepted at runtime
db.options.prepareThreshold = 0;
// Set statement_timeout on new connections to match Railway Postgres default
db.on('connect', (client) => {
  client.query(`SET statement_timeout = '4000'`).catch(() => {});
});

// Replica DB pool for read-heavy operations (e.g., embedding pipeline).
// Explicitly gated by REPLICA_DATABASE_URL so callers can enforce replica-only
// reads instead of silently falling back to the primary.
//
// BUY-60378: set statement_timeout on replicaDb so queries fail deterministically
// (57014) instead of waiting for the Railway proxy idle-client teardown (~3 min).
const replicaStatementTimeout = parseInt(process.env.REPLICA_STATEMENT_TIMEOUT || '60000');

export const replicaDb: Pool | null = process.env.REPLICA_DATABASE_URL
  ? (() => {
      const pool = new Pool({
        connectionString: process.env.REPLICA_DATABASE_URL,
        max: parseInt(process.env.PG_POOL_MAX || '20'),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      } as PoolConfig);
      // @ts-ignore prepareThreshold not in pg@8 PoolConfig types but accepted at runtime
      pool.options.prepareThreshold = 0;
      return pool;
    })()
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
  ? (() => {
      const pool = new Pool({
        connectionString: process.env.CATALOG_DATABASE_URL,
        max: parseInt(process.env.CATALOG_POOL_MAX || '30'),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      } as PoolConfig);
      // @ts-ignore prepareThreshold not in pg@8 PoolConfig types but accepted at runtime
      pool.options.prepareThreshold = 0;
      return pool;
    })()
  : db;

if (process.env.CATALOG_DATABASE_URL) {
  catalogDb.on('connect', (client) => {
    Promise.all([
      client.query(`SET statement_timeout = ${pgStatementTimeout}`),
      client.query(`SET lock_timeout = ${pgLockTimeout}`),
    ]).catch(() => {});
  });
}

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

export const TIER_LIMITS: Record<string, { rpm: number; daily: number; monthlyCap?: number; overageRate?: number }> = {
  // 2026-08-24: agent self-serve tier (was missing here — keys fell back to FREE_TIER)
  pending_verify: { rpm: 60, daily: 1000 },
  free: FREE_TIER,
  starter: { rpm: 100, daily: 10000 },
  pro: { rpm: 500, daily: 100000 },
  unverified: { rpm: 20, daily: 1000 },
  verified_agent: { rpm: 200, daily: 10000 },
  enterprise: { rpm: 1000, daily: 100000 },
  platform_starter: { rpm: 500, daily: 500000, monthlyCap: 500000, overageRate: 0.002 },
  internal: { rpm: 10000, daily: 999999 },
};
// Vector DB pool — separate Railway Postgres with pgvector 0.8 (BUY-41135).
// Null when VECTOR_DB_URL is unset; consumers must check before using.
//
// BUY-41137: set statement_timeout so slow KNN queries fail fast instead of
// hanging for the idleTimeout window and exhausting the pool (max=5).
const vectorStatementTimeout = parseInt(process.env.VECTOR_STATEMENT_TIMEOUT || '10000');

export const vectorDb: Pool | null = process.env.VECTOR_DB_URL
  ? (() => {
      const pool = new Pool({
        connectionString: process.env.VECTOR_DB_URL!,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      } as PoolConfig);
      // @ts-ignore prepareThreshold not in pg@8 PoolConfig types but accepted at runtime
      pool.options.prepareThreshold = 0;
      pool.on('connect', (client) => {
        client.query(`SET statement_timeout = ${vectorStatementTimeout}`).catch(() => {});
      });
      return pool;
    })()
  : null;
