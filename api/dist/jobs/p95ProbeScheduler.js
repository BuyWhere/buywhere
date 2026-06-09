"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startP95ProbeScheduler = startP95ProbeScheduler;
exports.stopP95ProbeScheduler = stopP95ProbeScheduler;
const config_1 = require("../config");
const p95_1 = require("../monitoring/p95");
const MARKETS = ['sg', 'us', 'my', 'vn', 'th'];
const HEALTH_INTERVAL_MS = 30000;
const CATALOG_STATS_INTERVAL_MS = 60000;
const MCP_LIST_CATEGORIES_INTERVAL_MS = 60000;
const API_BASE_URL = process.env.BUYWHERE_API_BASE_URL
    || (process.env.RAILWAY_SERVICE_BUYWHERE_API_URL ? `https://${process.env.RAILWAY_SERVICE_BUYWHERE_API_URL}` : 'https://api.buywhere.ai');
const SYSTEM_API_KEY = process.env.BUYWHERE_SYSTEM_API_KEY || '';
let schedulerStarted = false;
let schedulerTimers = [];
async function recordRawMeasurement(market, endpoint, responseTimeMs, statusCode) {
    try {
        await config_1.db.query(`INSERT INTO monitoring.p95_raw_measurements
         (market, endpoint, response_time_ms, status_code, measured_at)
       VALUES ($1, $2, $3, $4, NOW())`, [market, endpoint, responseTimeMs, statusCode]);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[p95-probe] failed to record ${market}:${endpoint}: ${message}`);
    }
}
async function timedFetch(url, init = {}) {
    const startedAt = Date.now();
    try {
        const response = await fetch(url, {
            ...init,
            signal: AbortSignal.timeout(10000),
        });
        try {
            await response.text();
        }
        catch { }
        return { statusCode: response.status, latencyMs: Date.now() - startedAt };
    }
    catch {
        return { statusCode: 0, latencyMs: Date.now() - startedAt };
    }
}
async function probeHealth() {
    for (const market of MARKETS) {
        const { statusCode, latencyMs } = await timedFetch(`${API_BASE_URL}/health`);
        await recordRawMeasurement(market, '/health', latencyMs, statusCode);
    }
}
async function probeCatalogStats() {
    const { statusCode, latencyMs } = await timedFetch(`${API_BASE_URL}/v1/catalog/stats`);
    await recordRawMeasurement('sg', '/v1/catalog/stats', latencyMs, statusCode);
}
async function probeMcpListCategories() {
    if (!SYSTEM_API_KEY) {
        return;
    }
    const { statusCode, latencyMs } = await timedFetch(`${API_BASE_URL}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${SYSTEM_API_KEY}`,
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'probe:list_categories',
            method: 'tools/call',
            params: { name: 'list_categories', arguments: {} },
        }),
    });
    await recordRawMeasurement('sg', 'mcp:list_categories', latencyMs, statusCode);
}
async function runProbeCycle() {
    try {
        await Promise.allSettled([
            probeHealth(),
            probeCatalogStats(),
            probeMcpListCategories(),
            (0, p95_1.recordMonitoredEndpointProbeSamples)(),
        ]);
        await (0, p95_1.refreshRecentP95Windows)();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[p95-probe] probe cycle failed: ${message}`);
    }
}
function startP95ProbeScheduler() {
    if (schedulerStarted) {
        return;
    }
    schedulerStarted = true;
    console.log(`[p95-probe] starting external probe scheduler against ${API_BASE_URL}`);
    const initialTimer = setTimeout(() => {
        void runProbeCycle();
    }, 5000);
    if (initialTimer.unref) {
        initialTimer.unref();
    }
    schedulerTimers = [
        setInterval(() => { void probeHealth(); }, HEALTH_INTERVAL_MS),
        setInterval(() => { void probeCatalogStats(); }, CATALOG_STATS_INTERVAL_MS),
        setInterval(() => { void probeMcpListCategories(); }, MCP_LIST_CATEGORIES_INTERVAL_MS),
        setInterval(() => { void (0, p95_1.recordMonitoredEndpointProbeSamples)(); }, 60000),
        setInterval(() => {
            void (0, p95_1.refreshRecentP95Windows)().catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[p95-probe] refresh failed: ${message}`);
            });
        }, 60000),
    ];
    for (const timer of schedulerTimers) {
        if (timer.unref) {
            timer.unref();
        }
    }
}
function stopP95ProbeScheduler() {
    for (const timer of schedulerTimers) {
        clearInterval(timer);
    }
    schedulerTimers = [];
    schedulerStarted = false;
}
