import { Pool } from 'pg';
import Redis from 'ioredis';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/buywhere',
  max: parseInt(process.env.PG_POOL_MAX || '50'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const pgStatementTimeout = parseInt(process.env.PG_STATEMENT_TIMEOUT || '30000');
const pgLockTimeout = parseInt(process.env.PG_LOCK_TIMEOUT || '2000');

db.on('connect', (client) => {
  Promise.all([
    client.query(`SET statement_timeout = ${pgStatementTimeout}`),
    client.query(`SET lock_timeout = ${pgLockTimeout}`),
  ]).catch(() => {});
});

export const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6380'),
  maxRetriesPerRequest: 3,
  commandTimeout: 1000,
  connectTimeout: 2000,
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
  rpm: 60,
  daily: 1000,
};
