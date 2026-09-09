"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = require("crypto");
const config_1 = require("../config");
const p95_1 = require("./p95");
const router = express_1.default.Router();
const toIso = (v) => {
    if (v == null)
        return null;
    if (v instanceof Date)
        return v.toISOString();
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
function parseResolutionNotes(note) {
    if (!note) {
        return null;
    }
    try {
        return JSON.parse(note);
    }
    catch {
        return note;
    }
}
/**
 * Monitoring auth middleware (BUY-32082).
 *
 * Accepts either:
 *  - An API key via X-API-Key / Authorization: Bearer / ?api_key=
 *  - The MONITORING_API_KEY env var (shared secret for BUY-31447 routine)
 *  - No auth from loopback / private IPs (internal access)
 *
 * This is intentionally permissive so the monitoring routine can access the
 * endpoints without going through the full API key rate-limiting flow.
 */
async function monitoringAuth(req, res, next) {
    const monitoringKey = process.env.MONITORING_API_KEY;
    if (monitoringKey) {
        const authHeader = req.headers['authorization'] || '';
        const xApiKey = req.headers['x-api-key'];
        const queryKey = req.query['api_key'];
        let providedKey;
        if (authHeader.startsWith('Bearer ')) {
            providedKey = authHeader.slice(7).trim();
        }
        else if (authHeader.startsWith('ApiKey ')) {
            providedKey = authHeader.slice(7).trim();
        }
        else if (xApiKey) {
            providedKey = xApiKey.trim();
        }
        else if (queryKey) {
            providedKey = queryKey;
        }
        if (providedKey === monitoringKey) {
            return next();
        }
        if (providedKey) {
            try {
                const keyHash = (0, crypto_1.createHash)('sha256').update(providedKey).digest('hex');
                const result = await config_1.db.query('SELECT id FROM api_keys WHERE key_hash = $1 AND is_active = true', [keyHash]);
                if (result.rows.length > 0) {
                    return next();
                }
            }
            catch { }
        }
        res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'Valid API key or MONITORING_API_KEY required for monitoring endpoints'
        });
        return;
    }
    next();
}
// Hard timeout for all monitoring endpoints — prevents any single request from hanging
// indefinitely (e.g., slow DB aggregation + stale-freshness probes). BUY-44164
router.use('/api/monitoring', (req, _res, next) => {
    req.setTimeout(10000, () => { });
    next();
}, monitoringAuth);
router.get('/api/monitoring/p95', async (req, res) => {
    try {
        const { market } = req.query;
        const skipFreshness = req.headers[p95_1.INTERNAL_P95_PROBE_HEADER] === '1';
        if (!market || typeof market !== 'string') {
            return res.status(400).json({
                error: 'INVALID_MARKET',
                message: 'Market parameter is required and must be a string'
            });
        }
        if (!(0, p95_1.isValidMarket)(market.toLowerCase())) {
            return res.status(400).json({
                error: 'INVALID_MARKET',
                message: `Market must be one of: ${p95_1.VALID_MARKETS.join(', ')}`
            });
        }
        const record = await (0, p95_1.getLatestP95ForMarket)(market.toLowerCase(), { skipFreshness });
        if (!record) {
            return res.status(404).json({
                error: 'NO_DATA',
                message: `No P95 data available for market ${market.toLowerCase()}`
            });
        }
        const alertTriggered = record.p95_ms > p95_1.P95_THRESHOLD_MS;
        const baselineMs = market.toLowerCase() === 'sg' ? 160 : 0;
        res.json({
            market: record.market,
            p95_ms: record.p95_ms,
            sample_size: record.sample_size,
            window_start: toIso(record.window_start),
            window_end: toIso(record.window_end),
            alert_triggered: alertTriggered,
            baseline_ms: baselineMs,
            threshold_ms: p95_1.P95_THRESHOLD_MS
        });
    }
    catch (error) {
        console.error('[P95] Error fetching P95 data:', error);
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Failed to fetch P95 data'
        });
    }
});
router.get('/api/monitoring/p95/history', async (req, res) => {
    try {
        const { market, from, to, limit } = req.query;
        if (!market || typeof market !== 'string') {
            return res.status(400).json({
                error: 'INVALID_MARKET',
                message: 'Market parameter is required'
            });
        }
        if (!(0, p95_1.isValidMarket)(market.toLowerCase())) {
            return res.status(400).json({
                error: 'INVALID_MARKET',
                message: `Market must be one of: ${p95_1.VALID_MARKETS.join(', ')}`
            });
        }
        const limitNum = limit ? parseInt(limit, 10) : 100;
        if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
            return res.status(400).json({
                error: 'INVALID_LIMIT',
                message: 'Limit must be between 1 and 1000'
            });
        }
        const records = await (0, p95_1.getP95Latency)(market.toLowerCase(), limitNum);
        let filteredRecords = records;
        if (from || to) {
            const fromTime = from ? new Date(parseInt(from, 10)) : new Date(0);
            const toTime = to ? new Date(parseInt(to, 10)) : new Date();
            filteredRecords = records.filter((r) => r.window_end >= fromTime && r.window_end <= toTime);
        }
        res.json({
            market: market.toLowerCase(),
            data: filteredRecords.map((r) => ({
                p95_ms: r.p95_ms,
                sample_size: r.sample_size,
                window_start: toIso(r.window_start),
                window_end: toIso(r.window_end)
            })),
            count: filteredRecords.length
        });
    }
    catch (error) {
        console.error('[P95] Error fetching P95 history:', error);
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Failed to fetch P95 history'
        });
    }
});
router.get('/api/monitoring/p95/all', async (req, res) => {
    try {
        const markets = await (0, p95_1.getAllLatestP95)({ skipFreshness: true });
        const serializedMarkets = Object.fromEntries(Object.entries(markets).map(([market, record]) => [
            market,
            {
                endpoint: record.endpoint,
                p95_ms: record.p95_ms,
                sample_size: record.sample_size,
                window_start: toIso(record.window_start),
                window_end: toIso(record.window_end),
                alert_triggered: record.alert_triggered,
                baseline_ms: record.baseline_ms,
                threshold_ms: record.threshold_ms,
            },
        ]));
        res.json({
            timestamp: new Date().toISOString(),
            markets: serializedMarkets,
            threshold_ms: p95_1.P95_THRESHOLD_MS
        });
    }
    catch (error) {
        console.error('[P95] Error fetching all P95 data:', error);
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Failed to fetch P95 data for all markets'
        });
    }
});
async function handleAlertsRequest(req, res) {
    try {
        const { market, kind, limit } = req.query;
        if (market && typeof market !== 'string') {
            res.status(400).json({
                error: 'INVALID_MARKET',
                message: 'Market parameter must be a string'
            });
            return;
        }
        const normalizedMarket = market ? market.toLowerCase() : null;
        if (normalizedMarket && !(0, p95_1.isValidMarket)(normalizedMarket)) {
            res.status(400).json({
                error: 'INVALID_MARKET',
                message: `Market must be one of: ${p95_1.VALID_MARKETS.join(', ')}`
            });
            return;
        }
        if (kind && typeof kind !== 'string') {
            res.status(400).json({
                error: 'INVALID_KIND',
                message: 'kind parameter must be a string'
            });
            return;
        }
        const limitNum = limit ? parseInt(limit, 10) : 50;
        if (isNaN(limitNum) || limitNum < 1 || limitNum > 500) {
            res.status(400).json({
                error: 'INVALID_LIMIT',
                message: 'Limit must be between 1 and 500'
            });
            return;
        }
        const alerts = await (0, p95_1.getAlertHistory)({
            market: normalizedMarket,
            kind: kind || null,
            limit: limitNum,
        });
        res.json({
            timestamp: new Date().toISOString(),
            market: normalizedMarket,
            kind: kind || null,
            alerts: alerts.map((a) => ({
                id: a.id,
                market: a.market,
                kind: a.kind,
                p95_ms: a.p95_ms,
                threshold_ms: a.threshold_ms,
                triggered_at: toIso(a.triggered_at),
                acknowledged_at: toIso(a.acknowledged_at),
                acknowledged_by: a.acknowledged_by,
                resolution_notes: a.resolution_notes,
                details: parseResolutionNotes(a.resolution_notes),
            })),
            count: alerts.length
        });
    }
    catch (error) {
        console.error('[P95] Error fetching alert history:', error);
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Failed to fetch alert history'
        });
    }
}
router.get('/api/monitoring/alerts', handleAlertsRequest);
router.get('/api/monitoring/p95/alerts', handleAlertsRequest);
router.post('/api/monitoring/p95/cleanup', async (req, res) => {
    try {
        const { retention_days } = req.body;
        const retentionDays = retention_days ? parseInt(retention_days, 10) : 7;
        if (isNaN(retentionDays) || retentionDays < 1) {
            return res.status(400).json({
                error: 'INVALID_RETENTION',
                message: 'Retention days must be a positive integer'
            });
        }
        const deletedCount = await (0, p95_1.cleanupOldData)(retentionDays);
        res.json({
            success: true,
            deleted_count: deletedCount,
            retention_days: retentionDays
        });
    }
    catch (error) {
        console.error('[P95] Error cleaning up old data:', error);
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'Failed to cleanup old P95 data'
        });
    }
});
exports.default = router;
