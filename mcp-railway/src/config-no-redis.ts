import { Pool } from 'pg';
// Disabled Redis for testing - MCP server should work without caching
// import Redis from 'ioredis';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/buywhere',
  max: parseInt(process.env.PG_POOL_MAX || '50'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const pgStatementTimeout = parseInt(process.env.PG_STATEMENT_TIMEOUT || '10000');
const pgLockTimeout = parseInt(process.env.PG_LOCK_TIMEOUT || '2000');

db.on('connect', (client) => {
  Promise.all([
    client.query(`SET statement_timeout = ${pgStatementTimeout}`),
    client.query(`SET lock_timeout = ${pgLockTimeout}`),
  ]).catch(() => {});
});

// Disabled Redis for testing - MCP server should work without caching
export const redis = {
  get: async () => { return null; },
  set: async () => {},
  on: () => {},
};

export const PORT = parseInt(process.env.PORT || '3000');
export const API_BASE_URL = process.env.API_BASE_URL || 'https://api.buywhere.ai';

export const FREE_TIER = {
  rpm: 60,
  daily: 1000,
};