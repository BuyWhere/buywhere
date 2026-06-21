"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplicaUnavailableError = exports.replicaPool = void 0;
exports.estimateReplicaLagMs = estimateReplicaLagMs;
exports.readDb = readDb;
exports.readDbConnect = readDbConnect;
exports.servingReadDb = servingReadDb;
exports.servingReadDbConnect = servingReadDbConnect;
exports.replicaStatus = replicaStatus;
const pg_1 = require("pg");
const config_1 = require("../config");
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
 *   - A background probe checks replica replay state and only treats elapsed
 *     replay age as lag while WAL is actually behind. Once the standby is
 *     caught up, idle time alone does not flip it back to primary.
 *     `readDb()` routes to the replica only while lag <= REPLICA_MAX_LAG_MS;
 *     otherwise it falls back to the primary so callers never read stale data
 *     beyond the threshold (BUY-45692.C).
 *
 * Env:
 *   REPLICA_DATABASE_URL        connection string for the read replica (unset = disabled)
 *   REPLICA_POOL_MAX            max replica pool connections (default 20)
 *   REPLICA_MAX_LAG_MS          lag ceiling before falling back to primary (default 2000)
 *   REPLICA_PROBE_INTERVAL_MS   how often to probe replica lag (default 5000)
 */
const REPLICA_URL = process.env.REPLICA_DATABASE_URL || '';
const MAX_LAG_MS = parseInt(process.env.REPLICA_MAX_LAG_MS || '2000');
const RECOVER_LAG_MS = parseInt(process.env.REPLICA_RECOVER_LAG_MS || String(MAX_LAG_MS));
const FAIL_LAG_MS = parseInt(process.env.REPLICA_FAIL_LAG_MS || String(Math.max(MAX_LAG_MS, Math.round(MAX_LAG_MS * 1.25))));
const PROBE_INTERVAL_MS = parseInt(process.env.REPLICA_PROBE_INTERVAL_MS || '5000');
const REPLICA_POOL_MAX = parseInt(process.env.REPLICA_POOL_MAX || '20');
const IS_NODE_TEST = process.env.NODE_ENV === 'test' ||
    process.execArgv.some((arg) => arg === '--test' || arg.startsWith('--test-'));
const TEST_BYPASS_REPLICA_GATE = IS_NODE_TEST && !REPLICA_URL;
const pgStatementTimeout = parseInt(process.env.PG_STATEMENT_TIMEOUT || '30000');
exports.replicaPool = REPLICA_URL
    ? new pg_1.Pool({
        connectionString: REPLICA_URL,
        max: REPLICA_POOL_MAX,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    })
    : null;
if (exports.replicaPool) {
    // Replica connections are read-only; apply the same statement timeout guard
    // as the primary so a runaway aggregate can't pin a replica backend.
    exports.replicaPool.on('connect', (client) => {
        client.query(`SET statement_timeout = ${pgStatementTimeout}`).catch(() => { });
    });
    exports.replicaPool.on('error', (err) => {
        if (process.env.NODE_ENV !== 'test') {
            console.warn('[read-replica] pool error:', err.message);
        }
    });
}
// ─── Lag monitor (BUY-45692.C) ──────────────────────────────────────────────
let replicaHealthy = false;
let lastLagMs = null;
let lastProbeAt = null;
let lastError = null;
function estimateReplicaLagMs(input) {
    const { lagSeconds, receiveLsn, replayLsn } = input;
    // A standby that has fully replayed the WAL it has received is caught up.
    // Wall-clock time since the last replayed transaction keeps growing when the
    // database is idle, so do not let that idle time alone flip healthy replica
    // checks back to primary.
    if (receiveLsn && replayLsn && receiveLsn === replayLsn) {
        return 0;
    }
    if (lagSeconds == null) {
        return null;
    }
    return Math.max(0, Math.round(Number(lagSeconds) * 1000));
}
class ReplicaUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.code = 'REPLICA_UNAVAILABLE';
        this.name = 'ReplicaUnavailableError';
    }
}
exports.ReplicaUnavailableError = ReplicaUnavailableError;
async function probeLag() {
    if (!exports.replicaPool)
        return;
    try {
        const r = await exports.replicaPool.query(`
      SELECT
        EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag_seconds,
        pg_last_wal_receive_lsn()::text AS receive_lsn,
        pg_last_wal_replay_lsn()::text AS replay_lsn
    `);
        const row = r.rows?.[0];
        lastProbeAt = new Date().toISOString();
        lastError = null;
        const lagMs = estimateReplicaLagMs({
            lagSeconds: row?.lag_seconds ?? null,
            receiveLsn: row?.receive_lsn ?? null,
            replayLsn: row?.replay_lsn ?? null,
        });
        if (lagMs == null) {
            // NULL = not a standby (or nothing replayed yet). Don't route reads here;
            // a primary masquerading as a replica adds no isolation, and an unprimed
            // standby can't be trusted. Fall back to primary.
            replicaHealthy = false;
            lastLagMs = null;
            return;
        }
        lastLagMs = lagMs;
        // BUY-54931: add hysteresis so canonical search doesn't flap when lag
        // hovers around the same single threshold.
        const healthCeilingMs = replicaHealthy ? FAIL_LAG_MS : RECOVER_LAG_MS;
        replicaHealthy = lastLagMs <= healthCeilingMs;
    }
    catch (err) {
        replicaHealthy = false;
        lastLagMs = null;
        lastError = err.message;
        lastProbeAt = new Date().toISOString();
    }
}
if (exports.replicaPool) {
    probeLag().catch(() => { });
    const probeTimer = setInterval(() => {
        probeLag().catch(() => { });
    }, PROBE_INTERVAL_MS);
    probeTimer.unref();
}
/**
 * Pool to use for read-only heavy aggregates. Returns the replica only while it
 * is configured AND caught up within REPLICA_MAX_LAG_MS; otherwise the primary.
 * NEVER use for writes or for interactive /v1/products/search.
 */
function readDb() {
    return replicaHealthy && exports.replicaPool ? exports.replicaPool : config_1.db;
}
/** Convenience: a pooled client from the current read pool. Caller must release(). */
function readDbConnect() {
    return readDb().connect();
}
async function ensureReplicaHealthy() {
    if (TEST_BYPASS_REPLICA_GATE) {
        return;
    }
    if (!exports.replicaPool) {
        throw new ReplicaUnavailableError('REPLICA_DATABASE_URL is not configured. Canonical serving must read from maglev via replica.');
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
                : `lag_ms=${status.lag_ms} recover_lag_ms=${status.recover_lag_ms} fail_lag_ms=${status.fail_lag_ms}`;
        throw new ReplicaUnavailableError(`Replica is unavailable for canonical serving (${details}). Fix REPLICA_DATABASE_URL / replica health; do not fall back to DATABASE_URL.`);
    }
}
/**
 * Strict read path for canonical serving (BUY-54775).
 * Search/stats must fail loudly instead of drifting back to roundhouse.
 */
async function servingReadDb() {
    if (TEST_BYPASS_REPLICA_GATE) {
        return config_1.db;
    }
    await ensureReplicaHealthy();
    return exports.replicaPool;
}
async function servingReadDbConnect() {
    const pool = await servingReadDb();
    return pool.connect();
}
/** Observability for /v1/catalog/stats/health and ops dashboards. */
function replicaStatus() {
    return {
        configured: Boolean(exports.replicaPool),
        healthy: replicaHealthy,
        routing_to: replicaHealthy && exports.replicaPool ? 'replica' : 'primary',
        lag_ms: lastLagMs,
        max_lag_ms: MAX_LAG_MS,
        recover_lag_ms: RECOVER_LAG_MS,
        fail_lag_ms: FAIL_LAG_MS,
        last_probe_at: lastProbeAt,
        last_error: lastError,
    };
}
