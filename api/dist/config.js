"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIER_LIMITS = exports.FREE_TIER = exports.API_BASE_URL = exports.PORT = exports.redis = exports.db = void 0;
const pg_1 = require("pg");
const ioredis_1 = __importDefault(require("ioredis"));
exports.db = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/buywhere',
    max: parseInt(process.env.PG_POOL_MAX || '50'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
const pgStatementTimeout = parseInt(process.env.PG_STATEMENT_TIMEOUT || '30000');
const pgLockTimeout = parseInt(process.env.PG_LOCK_TIMEOUT || '2000');
exports.db.on('connect', (client) => {
    Promise.all([
        client.query(`SET statement_timeout = ${pgStatementTimeout}`),
        client.query(`SET lock_timeout = ${pgLockTimeout}`),
    ]).catch(() => { });
});
exports.redis = new ioredis_1.default({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6380'),
    maxRetriesPerRequest: 0,
    commandTimeout: 500,
    connectTimeout: 2000,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
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
    rpm: 10,
    daily: 10000,
};
exports.TIER_LIMITS = {
    free: exports.FREE_TIER,
    starter: { rpm: 100, daily: 10000 },
    pro: { rpm: 500, daily: 100000 },
    unverified: { rpm: 10, daily: 10000 },
    enterprise: { rpm: 1000, daily: 100000 },
    internal: { rpm: 10000, daily: 999999 },
};
