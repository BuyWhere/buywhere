"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplicaUnavailableError = exports.replicaPool = void 0;
exports.readDb = readDb;
exports.readDbConnect = readDbConnect;
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
 *   - A background probe (BUY-54916) tracks replica freshness using WAL-level
 *     signals (`pg_stat_wal_receiver` + replay/receive LSNs). `readDb()` routes
 *     to the replica only while those signals are fresh; otherwise it falls
 *     back to the primary so callers never read stale data.
 *
 * Env:
 *   REPLICA_DATABASE_URL        connection string for the read replica (unset = disabled)
 *   REPLICA_POOL_MAX            max replica pool connections (default 20)
 *   REPLICA_MAX_LAG_MS          replica freshness ceiling in ms (default 2000)
 *   REPLICA_PROBE_INTERVAL_MS   how often to probe replica freshness (default 5000)
 *
 * BUY-54916 fix: previous probe used `pg_last_xact_replay_timestamp()`, which
 * only advances on transaction commits. During sustained non-transactional WAL
 * activity on the primary (e.g. `CREATE INDEX CONCURRENTLY` or vacuum) the
 * timestamp stays "stale" even when the replica is fully caught up at the WAL
 * level — every WAL byte received and replayed, but the last_xact timestamp
 * unchanged. That made `/v1/catalog/stats/health` flap between healthy and
 * unhealthy every few seconds, even though the replica was actually serving
 * current data. The new probe uses WAL-receiver freshness (active streaming +
 * recent messages + matching receive/replay LSNs) as the health signal and
 * keeps the xact-timestamp lag as a secondary observability field.
 */
const REPLICA_URL = process.env.REPLICA_DATABASE_URL || '';
const MAX_LAG_MS = parseInt(process.env.REPLICA_MAX_LAG_MS || '2000');
const PROBE_INTERVAL_MS = parseInt(process.env.REPLICA_PROBE_INTERVAL_MS || '5000');
const REPLICA_POOL_MAX = parseInt(process.env.REPLICA_POOL_MAX || '50'); // raised 20->50: absorb concurrent-search bursts (health-bot 395-req burst saturated 20-slot pool -> connect-timeout 500s 2026-07-14)
// hotfix: search tolerates a small replication backlog. Byte-exact LSN match
// never holds under continuous primary writes, so treat the replica as fresh
// when the un-replayed WAL gap is within a bounded threshold (default 50MB).
const LSN_GAP_HEALTHY_BYTES = parseInt(process.env.REPLICA_LSN_GAP_HEALTHY_BYTES || '52428800');
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
// ─── Freshness probe (BUY-45692.C + BUY-54916) ─────────────────────────────
//
// Healthy iff:
//   1. The connection is in recovery (real standby, not a masquerading primary).
//   2. pg_stat_wal_receiver.status = 'streaming' (actively receiving from primary).
//   3. Time since last received WAL message <= REPLICA_MAX_LAG_MS.
//
// `lag_ms` reported to observability is the time since the last WAL message was
// received (true replication freshness), clamped at the configured ceiling. We
// also surface `xact_lag_ms` (the legacy `pg_last_xact_replay_timestamp()`
// measurement) as `lag_ms_xact` so dashboards can distinguish a real backlog
// (high xact lag + high recv age) from a primary doing mostly non-transactional
// WAL (low recv age + high xact lag — the BUY-54916 case).
let replicaHealthy = false;
let lastLagMs = null;
let lastXactLagMs = null;
let lastRecvAgeMs = null;
let lastLsnGapBytes = null;
let lastProbeAt = null;
let lastError = null;
async function probeLag() {
    if (!exports.replicaPool)
        return;
    try {
        const r = await exports.replicaPool.query(`SELECT
         pg_is_in_recovery() AS in_recovery,
         (SELECT status FROM pg_stat_wal_receiver) AS wal_status,
         (SELECT EXTRACT(EPOCH FROM (now() - last_msg_receipt_time)) * 1000
            FROM pg_stat_wal_receiver) AS last_msg_age_ms,
         pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn())::text AS lsn_gap_bytes,
         pg_last_xact_replay_timestamp() AS xact_replay_ts,
         EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 AS xact_lag_ms`);
        const row = r.rows?.[0];
        lastProbeAt = new Date().toISOString();
        lastError = null;
        if (!row) {
            replicaHealthy = false;
            lastLagMs = null;
            lastXactLagMs = null;
            lastRecvAgeMs = null;
            lastLsnGapBytes = null;
            return;
        }
        lastRecvAgeMs = row.last_msg_age_ms == null ? null : Math.round(Number(row.last_msg_age_ms));
        lastXactLagMs = row.xact_lag_ms == null ? null : Math.max(0, Math.round(Number(row.xact_lag_ms)));
        lastLsnGapBytes = row.lsn_gap_bytes == null ? null : Math.max(0, Math.round(Number(row.lsn_gap_bytes)));
        // Health decision: zero-byte LSN backlog is the authoritative freshness
        // signal. When replay_lsn == receive_lsn, every WAL byte the replica
        // has received has been replayed — there is no risk of reading stale
        // data, regardless of how long the receiver has been quiet or how large
        // the xact-timestamp gap is. We deliberately do NOT use the xact
        // timestamp or the recv-age for the health decision (BUY-54916).
        const lsnMatched = lastLsnGapBytes !== null && lastLsnGapBytes <= LSN_GAP_HEALTHY_BYTES;
        // lag_ms: report LSN gap in bytes (true replication backlog). When
        // matched, this is 0. Never use the xact timestamp here.
        lastLagMs = lsnMatched ? 0 : lastLsnGapBytes;
        // BUY-77835: accept the replica as soon as it is in recovery and the WAL
        // receive/replay positions are caught up. During heavy primary I/O the
        // wal_receiver status can sit in 'catchup' even though the LSN gap is
        // already zero, causing readDb() to keep hammering the saturated primary.
        // The LSN gap is the authoritative freshness signal (BUY-54916).
        const walStatusHealthy = row.wal_status === 'streaming' || row.wal_status === 'catchup';
        replicaHealthy =
            row.in_recovery === true &&
                walStatusHealthy &&
                lsnMatched;
    }
    catch (err) {
        replicaHealthy = false;
        lastLagMs = null;
        lastXactLagMs = null;
        lastRecvAgeMs = null;
        lastLsnGapBytes = null;
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
/**
 * Backwards-compatible alias used by the products route.
 *
 * The route still expects a replica-specific name and error type from an older
 * implementation. Keeping these exports avoids a broad route rewrite while the
 * deploy context stays aligned with the current read-replica behavior.
 */
class ReplicaUnavailableError extends Error {
    constructor(message = 'Replica unavailable') {
        super(message);
        this.name = 'ReplicaUnavailableError';
    }
}
exports.ReplicaUnavailableError = ReplicaUnavailableError;
async function servingReadDbConnect() {
    return readDbConnect();
}
/** Observability for /v1/catalog/stats/health and ops dashboards. */
function replicaStatus() {
    return {
        configured: Boolean(exports.replicaPool),
        healthy: replicaHealthy,
        routing_to: replicaHealthy && exports.replicaPool ? 'replica' : 'primary',
        lag_ms: lastLagMs,
        lag_ms_xact: lastXactLagMs,
        lsn_gap_bytes: lastLsnGapBytes,
        recv_age_ms: lastRecvAgeMs,
        max_lag_ms: MAX_LAG_MS,
        last_probe_at: lastProbeAt,
        last_error: lastError,
    };
}
