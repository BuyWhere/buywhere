"use strict";
/**
 * BUY-69817: In-memory per-tool/per-region health snapshot.
 *
 * Records latency + error for every MCP tool call, keyed on
 * (tool, region) in a rolling 5-minute window. The snapshot is
 * recomputed every 10 s and served without hitting the DB.
 *
 * Failure-open: if the snapshotter itself throws, the /health
 * endpoints return their last good snapshot (or an empty one).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_REGIONS = exports.P95_TARGET_MS = exports.ROLLING_WINDOW_MS = void 0;
exports.computeSnapshot = computeSnapshot;
exports.recordToolCall = recordToolCall;
exports.getDegradedRegions = getDegradedRegions;
exports.buildHealthResponse = buildHealthResponse;
// ── Config ────────────────────────────────────────────────────────────────────
exports.ROLLING_WINDOW_MS = 5 * 60 * 1000; // 5 min
const MAX_SAMPLES_PER_KEY = 2000; // cap memory
const SNAPSHOT_TTL_MS = 10 * 1000; // 10 s cache
// SLO thresholds (BUY-69817 spec)
// p95_target_ms is the per-tool SLO; status taxonomy uses 2× and 10× multipliers.
exports.P95_TARGET_MS = 200;
const P95_DEGRADED_MS = exports.P95_TARGET_MS * 2; // 400 ms  → degraded
const P95_DOWN_MS = exports.P95_TARGET_MS * 10; // 2000 ms → down
const ERROR_RATE_OK = 0.01; // < 1 %
const ERROR_RATE_DEGRADED = 0.25; // 1–25 %  → degraded
const ERROR_RATE_DOWN = 0.25; // > 25 %  → down
const buffers = new Map();
function getOrCreate(key) {
    let buf = buffers.get(key);
    if (!buf) {
        buf = { samples: [], regionSamples: new Map() };
        buffers.set(key, buf);
    }
    return buf;
}
function pruneOld(samples) {
    const cutoff = Date.now() - exports.ROLLING_WINDOW_MS;
    let i = 0;
    while (i < samples.length && samples[i].ts < cutoff)
        i++;
    return i > 0 ? samples.slice(i) : samples;
}
function record(key, region, sample) {
    const buf = getOrCreate(key);
    buf.samples.push(sample);
    if (buf.samples.length > MAX_SAMPLES_PER_KEY)
        buf.samples.shift();
    else
        buf.samples = pruneOld(buf.samples);
    const rBuf = buf.regionSamples.get(region) ?? [];
    rBuf.push(sample);
    if (rBuf.length > MAX_SAMPLES_PER_KEY)
        rBuf.shift();
    else
        buf.regionSamples.set(region, pruneOld(rBuf));
}
// ── Stats helpers ─────────────────────────────────────────────────────────────
function percentile(values, p) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}
function calcToolHealth(samples) {
    if (!samples.length)
        return { p50_ms: null, p95_ms: null, error_rate_5m: 0, sample_count: 0 };
    const latencies = samples.map(s => s.latency_ms);
    const errors = samples.filter(s => s.error).length;
    return {
        p50_ms: Math.round(percentile(latencies, 0.50)),
        p95_ms: Math.round(percentile(latencies, 0.95)),
        error_rate_5m: Math.round((errors / samples.length) * 10000) / 10000,
        sample_count: samples.length,
    };
}
function toolStatus(errorRate, p95Ms) {
    if (p95Ms === null)
        return 'ok';
    if (errorRate > ERROR_RATE_DOWN || p95Ms > P95_DOWN_MS)
        return 'down';
    if (errorRate > ERROR_RATE_OK || p95Ms > P95_DEGRADED_MS)
        return 'degraded';
    return 'ok';
}
function regionStatus(toolMap, region) {
    const degraded = Object.entries(toolMap)
        .filter(([_, t]) => t.degraded_regions.includes(region))
        .map(([n]) => n);
    const down = Object.entries(toolMap)
        .filter(([_, t]) => t.down_regions.includes(region))
        .map(([n]) => n);
    if (down.length > 0)
        return 'down';
    if (degraded.length > 0)
        return 'degraded';
    return 'ok';
}
// ── Snapshot computation (10 s cache) ────────────────────────────────────────
let cachedSnapshot = null;
let snapshotExpiresAt = 0;
function computeSnapshot() {
    if (cachedSnapshot && Date.now() < snapshotExpiresAt)
        return cachedSnapshot;
    const now = Date.now();
    const cutoff = now - exports.ROLLING_WINDOW_MS;
    // Collect all (tool, region) keys
    const toolRegionKeys = new Map();
    for (const key of Array.from(buffers.keys())) {
        const [tool, region] = key.split('\x00');
        if (!tool || !region)
            continue;
        if (!toolRegionKeys.has(tool))
            toolRegionKeys.set(tool, new Set());
        toolRegionKeys.get(tool).add(region);
    }
    const tools = {};
    const regions = {};
    const allRegions = new Set();
    for (const [tool, regionSet] of Array.from(toolRegionKeys.entries())) {
        const allSamples = [];
        const degradedRegions = [];
        const downRegions = [];
        const regionStats = {};
        for (const region of Array.from(regionSet.values())) {
            const key = `${tool}\x00${region}`;
            const buf = buffers.get(key);
            if (!buf)
                continue;
            const pruned = pruneOld([...buf.samples]);
            allSamples.push(...pruned);
            allRegions.add(region);
            const { p50_ms, p95_ms, error_rate_5m } = calcToolHealth(pruned);
            regionStats[region] = { errorRate: error_rate_5m, p95Ms: p95_ms };
            const rs = toolStatus(error_rate_5m, p95_ms);
            if (rs === 'down')
                downRegions.push(region);
            else if (rs === 'degraded')
                degradedRegions.push(region);
        }
        const { p50_ms, p95_ms, error_rate_5m, sample_count } = calcToolHealth(allSamples);
        const status = toolStatus(error_rate_5m, p95_ms);
        tools[tool] = {
            status,
            p50_ms,
            p95_ms,
            error_rate_5m,
            sample_count,
            regions: regionSet.size > 1 ? Array.from(regionSet.values()) : ['*all*'],
            degraded_regions: degradedRegions,
            down_regions: downRegions,
        };
    }
    // Region-level view — iterate all regions across all tools
    for (const region of Array.from(allRegions.values())) {
        const tools_ok = [];
        const tools_degraded = [];
        const tools_down = [];
        for (const [tool, toolHealth] of Object.entries(tools)) {
            const key = `${tool}\x00${region}`;
            const buf = buffers.get(key);
            if (!buf)
                continue;
            const pruned = pruneOld([...buf.samples]);
            const { p95_ms, error_rate_5m } = calcToolHealth(pruned);
            const rs = toolStatus(error_rate_5m, p95_ms);
            if (rs === 'down')
                tools_down.push(tool);
            else if (rs === 'degraded')
                tools_degraded.push(tool);
            else
                tools_ok.push(tool);
        }
        const status = tools_down.length > 0 ? 'down'
            : tools_degraded.length > 0 ? 'degraded' : 'ok';
        regions[region] = { status, tools_ok, tools_degraded, tools_down };
    }
    // Top-level status
    const toolStatuses = Object.values(tools).map(t => t.status);
    const overallStatus = toolStatuses.includes('down') ? 'down'
        : toolStatuses.includes('degraded') ? 'degraded' : 'ok';
    cachedSnapshot = {
        status: overallStatus,
        server: 'mcp',
        ts: new Date().toISOString(),
        tools,
        regions,
        catalog: undefined,
    };
    snapshotExpiresAt = Date.now() + SNAPSHOT_TTL_MS;
    return cachedSnapshot;
}
// ── Public recording API ───────────────────────────────────────────────────────
// Normalised region codes used by the MCP tools.
exports.SUPPORTED_REGIONS = ['SG', 'US', 'MY', 'TH', 'VN', 'PH', 'ID', 'GB', 'IN', 'AU'];
function recordToolCall(opts) {
    const key = `${opts.tool}\x00${opts.region}`;
    record(key, opts.region, { ts: Date.now(), latency_ms: opts.latency_ms, error: opts.error });
}
// ── Degraded regions helper ───────────────────────────────────────────────────
// Returns the list of region codes that have degraded+ status across all tools.
// Used to set the X-BuyWhere-Degraded-Regions response header.
function getDegradedRegions() {
    try {
        const snap = computeSnapshot();
        const degraded = new Set();
        for (const [, rh] of Object.entries(snap.regions)) {
            if (rh.status === 'degraded' || rh.status === 'down') {
                degraded.add(Object.entries(snap.regions).find(([, v]) => v === rh)?.[0] ?? '');
            }
        }
        return Array.from(degraded.values()).filter(Boolean);
    }
    catch {
        return [];
    }
}
// ── Backward-compatible /health body ────────────────────────────────────────
function buildHealthResponse(catalogTotal, p95TargetMs = exports.P95_TARGET_MS) {
    const snap = computeSnapshot();
    return {
        ...snap,
        catalog: { total_products: catalogTotal },
        slo: { window: '5m', p95_target_ms: p95TargetMs },
    };
}
