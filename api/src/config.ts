import { Pool } from 'pg';
import Redis from 'ioredis';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/buywhere',
  // With PgBouncer in transaction mode in front of Postgres, we can safely
  // allow more client-side connections — PgBouncer caps the actual DB
  // connections at DEFAULT_POOL_SIZE (20). Without PgBouncer, keep this ≤20
  // to avoid Postgres shared-memory exhaustion under concurrent load (BUY-1841).
  max: parseInt(process.env.PG_POOL_MAX || '50'),
  idleTimeoutMillis: 30000,
});

export const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6380'),
  // maxRetriesPerRequest: null hangs commands indefinitely when Redis is down.
  // 0 = fail fast so HTTP request handlers can catch and fail open.
  maxRetriesPerRequest: 0,
  commandTimeout: 500,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 500, 10000),
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
  rpm: 60,
  daily: 1000,
};
