"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_TIER = exports.API_BASE_URL = exports.PORT = exports.redis = exports.db = void 0;
const pg_1 = require("pg");
const ioredis_1 = __importDefault(require("ioredis"));
exports.db = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/buywhere',
    // With PgBouncer in transaction mode in front of Postgres, we can safely
    // allow more client-side connections — PgBouncer caps the actual DB
    // connections at DEFAULT_POOL_SIZE (20). Without PgBouncer, keep this ≤20
    // to avoid Postgres shared-memory exhaustion under concurrent load (BUY-1841).
    max: parseInt(process.env.PG_POOL_MAX || '50'),
    idleTimeoutMillis: 30000,
});
exports.redis = new ioredis_1.default({
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
exports.redis.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test') {
        console.warn('[redis] connection error:', err.message);
    }
});
exports.PORT = parseInt(process.env.PORT || '3000');
exports.API_BASE_URL = process.env.API_BASE_URL || 'https://api.buywhere.ai';
exports.FREE_TIER = {
    rpm: 60,
    daily: 1000,
};
