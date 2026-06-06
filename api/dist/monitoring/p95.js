"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateP95 = calculateP95;
exports.getP95Latency = getP95Latency;
exports.getLatestP95ForMarket = getLatestP95ForMarket;
exports.getAllLatestP95 = getAllLatestP95;
exports.insertP95Latency = insertP95Latency;
exports.insertAlert = insertAlert;
exports.getAlertHistory = getAlertHistory;
exports.cleanupOldData = cleanupOldData;
exports.recordLatencySample = recordLatencySample;
exports.getLatencySamples = getLatencySamples;
exports.clearLatencySamples = clearLatencySamples;
exports.computeAndStoreP95 = computeAndStoreP95;
const config_1 = require("../config");
const VALID_MARKETS = ['sg', 'us', 'my', 'vn', 'th'];
const P95_THRESHOLD_MS = parseInt(process.env.P95_THRESHOLD_MS || '300', 10);
function isValidMarket(market) {
    return VALID_MARKETS.includes(market);
}
function calculateP95(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;
    return Math.round(sorted[p95Index]);
}
async function getP95Latency(market, limit = 100) {
    const result = await config_1.db.query(`SELECT * FROM monitoring.p95_latency
     WHERE market = $1
     ORDER BY window_end DESC
     LIMIT $2`, [market, limit]);
    return result.rows;
}
async function getLatestP95ForMarket(market) {
    const result = await config_1.db.query(`SELECT * FROM monitoring.p95_latency
     WHERE market = $1
     ORDER BY window_end DESC
     LIMIT 1`, [market]);
    return result.rows[0] || null;
}
async function getAllLatestP95() {
    const result = await config_1.db.query(`SELECT DISTINCT ON (market) market, p95_ms, window_end
     FROM monitoring.p95_latency
     ORDER BY market, window_end DESC`);
    const markets = {};
    for (const row of result.rows) {
        markets[row.market] = {
            p95_ms: row.p95_ms,
            alert_triggered: row.p95_ms > P95_THRESHOLD_MS
        };
    }
    for (const market of VALID_MARKETS) {
        if (!markets[market]) {
            markets[market] = { p95_ms: 0, alert_triggered: false };
        }
    }
    return markets;
}
async function insertP95Latency(market, endpoint, p95Ms, sampleSize, windowStart, windowEnd) {
    await config_1.db.query(`INSERT INTO monitoring.p95_latency (market, endpoint, p95_ms, sample_size, window_start, window_end)
     VALUES ($1, $2, $3, $4, $5, $6)`, [market, endpoint, p95Ms, sampleSize, windowStart, windowEnd]);
    if (p95Ms > P95_THRESHOLD_MS) {
        await insertAlert(market, p95Ms, P95_THRESHOLD_MS);
    }
}
async function insertAlert(market, p95Ms, thresholdMs) {
    await config_1.db.query(`INSERT INTO monitoring.alert_history (market, p95_ms, threshold_ms)
     VALUES ($1, $2, $3)`, [market, p95Ms, thresholdMs]);
}
async function getAlertHistory(market, limit = 50) {
    const result = await config_1.db.query(`SELECT * FROM monitoring.alert_history
     WHERE market = $1
     ORDER BY triggered_at DESC
     LIMIT $2`, [market, limit]);
    return result.rows;
}
async function cleanupOldData(retentionDays = 7) {
    const result = await config_1.db.query(`SELECT monitoring.cleanup_old_p95_data($1) as deleted_count`, [retentionDays]);
    return result.rows[0].deleted_count;
}
const latencySamples = new Map();
function recordLatencySample(market, endpoint, latencyMs) {
    const key = `${market}:${endpoint}`;
    if (!latencySamples.has(key)) {
        latencySamples.set(key, []);
    }
    const samples = latencySamples.get(key);
    samples.push(latencyMs);
    if (samples.length > 1000) {
        samples.shift();
    }
}
function getLatencySamples(market, endpoint) {
    const key = `${market}:${endpoint}`;
    return latencySamples.get(key) || [];
}
function clearLatencySamples(market, endpoint) {
    const key = `${market}:${endpoint}`;
    latencySamples.delete(key);
}
async function computeAndStoreP95(market, endpoint) {
    const samples = getLatencySamples(market, endpoint);
    if (samples.length < 10) {
        return;
    }
    const p95Ms = calculateP95(samples);
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 5 * 60 * 1000);
    await insertP95Latency(market, endpoint, p95Ms, samples.length, windowStart, windowEnd);
    clearLatencySamples(market, endpoint);
}
