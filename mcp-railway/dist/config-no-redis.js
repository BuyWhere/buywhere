"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_TIER = exports.API_BASE_URL = exports.PORT = exports.redis = exports.db = void 0;
const pg_1 = require("pg");
// Disabled Redis for testing - MCP server should work without caching
// import Redis from 'ioredis';
exports.db = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/buywhere',
    max: parseInt(process.env.PG_POOL_MAX || '50'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
const pgStatementTimeout = parseInt(process.env.PG_STATEMENT_TIMEOUT || '10000');
const pgLockTimeout = parseInt(process.env.PG_LOCK_TIMEOUT || '2000');
exports.db.on('connect', (client) => {
    Promise.all([
        client.query(`SET statement_timeout = ${pgStatementTimeout}`),
        client.query(`SET lock_timeout = ${pgLockTimeout}`),
    ]).catch(() => { });
});
// Disabled Redis for testing - MCP server should work without caching
exports.redis = {
    get: async () => { return null; },
    set: async () => { },
    on: () => { },
};
exports.PORT = parseInt(process.env.PORT || '3000');
exports.API_BASE_URL = process.env.API_BASE_URL || 'https://api.buywhere.ai';
exports.FREE_TIER = {
    rpm: 60,
    daily: 1000,
};
