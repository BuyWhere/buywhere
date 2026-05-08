import { Pool } from 'pg';
import Redis from 'ioredis';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/buywhere',
  max: parseInt(process.env.PG_POOL_MAX || '50'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});

export const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6380'),
  maxRetriesPerRequest: 3,
  commandTimeout: 1000,
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

/** Rate-limit & abuse-detection thresholds — tuneable via env without redeploy */
export const RATE_LIMIT_CONFIG = {
  /** Per-IP rate limit for unauthenticated requests (req/min) */
  IP_RPM: parseInt(process.env.RL_IP_RPM || '30'),
  /** Burst multiplier — triggers block when IP hits this × IP_RPM */
  IP_BURST_MULTIPLIER: parseFloat(process.env.RL_IP_BURST_MULTIPLIER || '2'),
  /** Seconds to block an IP after burst */
  IP_BURST_BLOCK_SEC: parseInt(process.env.RL_IP_BURST_BLOCK_SEC || '60'),
};

export const ABUSE_LIMITS = {
  /** Max identical requests from the same IP before triggering 429 */
  RAPID_FIRE_THRESHOLD: parseInt(process.env.ABUSE_RAPID_FIRE_THRESHOLD || '3'),
  /** Window in seconds for identical-request tracking */
  RAPID_FIRE_WINDOW_SEC: parseInt(process.env.ABUSE_RAPID_FIRE_WINDOW_SEC || '60'),
  /** Max product results per IP per minute before IP block */
  SCRAPE_PRODUCTS_PER_MIN_PER_IP: parseInt(process.env.ABUSE_SCRAPE_PRODUCTS_PER_MIN || '500'),
  /** Max invalid API key attempts per IP before IP block */
  INVALID_KEY_MAX_ATTEMPTS: parseInt(process.env.ABUSE_INVALID_KEY_MAX || '20'),
  /** Window in seconds for invalid key tracking */
  INVALID_KEY_WINDOW_SEC: parseInt(process.env.ABUSE_INVALID_KEY_WINDOW_SEC || '300'),
  /** Duration in seconds to block an IP after exceeding invalid key limit */
  INVALID_KEY_BLOCK_SEC: parseInt(process.env.ABUSE_INVALID_KEY_BLOCK_SEC || '60'),
};
