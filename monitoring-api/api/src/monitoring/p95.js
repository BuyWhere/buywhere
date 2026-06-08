// P95 Monitoring - BUY-31208, BUY-31294, BUY-22737 (extended probes)
// P95 calculation, probe scheduler, and storage logic

const { Pool } = require('pg');

// Markets supported
const MARKETS = ['sg', 'us', 'my', 'vn', 'th'];
const THRESHOLD_MS = 300;

// BUY-22737: target API host. Defaults to api.buywhere.ai; can be overridden by env.
const API_BASE_URL = process.env.BUYWHERE_API_BASE_URL
  || (process.env.RAILWAY_SERVICE_BUYWHERE_API_URL ? `https://${process.env.RAILWAY_SERVICE_BUYWHERE_API_URL}` : 'https://api.buywhere.ai');

// BUY-22737: System API key for the MCP `tools/call` probe. The prober MUST
// authenticate to the buywhere-api MCP endpoint; without this the probe would
// hit the unauthenticated path and fail (tools/call is gated by requireApiKey).
const SYSTEM_API_KEY = process.env.BUYWHERE_SYSTEM_API_KEY || '';

// BUY-22737: per-endpoint probe intervals (ms). Hard-coded as the plan specifies.
const HEALTH_INTERVAL_MS = 30 * 1000;     // 30s for /health across 5 regions
const CATALOG_STATS_INTERVAL_MS = 60 * 1000;   // 60s for /v1/catalog/stats (sg)
const MCP_LIST_CATEGORIES_INTERVAL_MS = 60 * 1000;  // 60s for mcp:list_categories (sg)

// Internal: scheduler state
let schedulerTimers = [];
let schedulerStarted = false;

// Sample storage for latency measurements (in-memory for demo)
// In production, this would be stored in Redis or a time-series database
const latencySamples = new Map();

/**
 * Initialize sample storage for a market/endpoint
 */
function initSamples(market, endpoint) {
  const key = `${market}:${endpoint}`;
  if (!latencySamples.has(key)) {
    latencySamples.set(key, []);
  }
  return latencySamples.get(key);
}

/**
 * Record a latency measurement
 */
function recordLatency(market, endpoint, latencyMs) {
  const samples = initSamples(market, endpoint);
  const timestamp = new Date().toISOString();
  samples.push({ latencyMs, timestamp });

  // Keep only last 300 samples per market
  if (samples.length > 300) {
    samples.shift();
  }
}

/**
 * Calculate P95 from samples
 */
function calculateP95(samples) {
  if (samples.length === 0) return null;

  // Sort latencies
  const sorted = samples.map(s => s.latencyMs).sort((a, b) => a - b);

  // Calculate P95 index (95th percentile)
  const p95Index = Math.floor(sorted.length * 0.95);

  return sorted[p95Index] || sorted[sorted.length - 1];
}

/**
 * Get current P95 for a market
 */
async function getCurrentP95(pool, market) {
  if (!MARKETS.includes(market)) {
    throw new Error('INVALID_MARKET');
  }

  // Query latest P95 from database
  const result = await pool.query(
    `SELECT p95_ms, sample_size, window_start, window_end
     FROM monitoring.p95_latency
     WHERE market = $1
     ORDER BY window_end DESC
     LIMIT 1`,
    [market]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Get P95 for all markets
 */
async function getAllMarketsP95(pool) {
  const result = await pool.query(
    `SELECT DISTINCT ON (market) market, p95_ms, window_end
     FROM monitoring.p95_latency
     ORDER BY market, window_end DESC`
  );

  const markets = {};
  for (const row of result.rows) {
    markets[row.market] = {
      p95_ms: row.p95_ms,
      alert_triggered: row.p95_ms > THRESHOLD_MS
    };
  }

  return markets;
}

/**
 * Get historical P95 data
 */
async function getHistory(pool, market, from, to, limit = 100) {
  if (!MARKETS.includes(market)) {
    throw new Error('INVALID_MARKET');
  }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();
  const maxLimit = Math.min(limit, 1000);

  const result = await pool.query(
    `SELECT p95_ms, sample_size, window_start, window_end
     FROM monitoring.p95_latency
     WHERE market = $1
       AND window_start >= $2
       AND window_end <= $3
     ORDER BY window_end DESC
     LIMIT $4`,
    [market, fromDate, toDate, maxLimit]
  );

  return {
    market,
    data: result.rows,
    count: result.rowCount
  };
}

/**
 * Store P95 calculation
 */
async function storeP95(pool, market, endpoint, p95Ms, sampleSize, windowStart, windowEnd) {
  const result = await pool.query(
    `INSERT INTO monitoring.p95_latency
     (market, endpoint, p95_ms, sample_size, window_start, window_end)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [market, endpoint, p95Ms, sampleSize, windowStart, windowEnd]
  );

  // Check if alert should be triggered
  if (p95Ms > THRESHOLD_MS) {
    await triggerAlert(pool, market, p95Ms);
  }

  return result.rows[0];
}

/**
 * Trigger alert when P95 exceeds threshold
 */
async function triggerAlert(pool, market, p95Ms) {
  await pool.query(
    `INSERT INTO monitoring.alert_history
     (market, p95_ms, threshold_ms)
     VALUES ($1, $2, $3)`,
    [market, p95Ms, THRESHOLD_MS]
  );

  // TODO: Integrate with existing notification system (PagerDuty/Slack)
  console.log(`[BUY-31208 Alert] P95 Latency Threshold Exceeded
Market: ${market}
P95 Latency: ${p95Ms}ms
Threshold: ${THRESHOLD_MS}ms
Time: ${new Date().toISOString()}
Action required: Investigate ${market.toUpperCase()} market performance`);
}

/**
 * Cleanup old data
 */
async function cleanupOldData(pool, retentionDays = 7) {
  const result = await pool.query(
    `SELECT monitoring.cleanup_old_p95_data($1) as deleted_count`,
    [retentionDays]
  );

  return result.rows[0].deleted_count;
}

/**
 * Process samples and compute P95 for a market
 */
async function computeAndStoreP95(pool, market, endpoint) {
  const key = `${market}:${endpoint}`;
  const samples = latencySamples.get(key);

  if (!samples || samples.length === 0) {
    return null;
  }

  const p95Ms = calculateP95(samples);
  if (p95Ms === null) {
    return null;
  }

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 5 * 60 * 1000); // 5 minute window

  const result = await storeP95(
    pool,
    market,
    endpoint,
    p95Ms,
    samples.length,
    windowStart,
    windowEnd
  );

  // Clear samples after storing
  latencySamples.set(key, []);

  return result;
}

// ============================================================================
// BUY-22737 — Probe scheduler + per-endpoint probe functions
// ============================================================================

/**
 * Persist a single raw measurement into monitoring.p95_raw_measurements.
 * Best-effort: errors are logged but never thrown (the scheduler must not
 * take down the API process if a single write fails or the DB hiccups).
 */
async function recordRawMeasurement(pool, market, endpoint, responseTimeMs, statusCode) {
  try {
    await pool.query(
      `INSERT INTO monitoring.p95_raw_measurements
         (market, endpoint, response_time_ms, status_code, measured_at)
       VALUES ($1, $2, $3, $4, now())`,
      [market, endpoint, responseTimeMs, statusCode]
    );
  } catch (err) {
    console.error(`[probe] failed to record ${market}:${endpoint} (${statusCode}, ${responseTimeMs}ms):`, err.message);
  }
}

/**
 * Issue a probe request and time it. Returns { statusCode, latencyMs, ok }.
 * On transport failure, statusCode is 0 and ok=false.
 */
async function timedFetch(url, init = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      // Hard ceiling so a stuck target doesn't hold a probe slot forever.
      signal: AbortSignal.timeout(10_000),
    });
    // Drain body so the connection can be reused, but don't keep the bytes.
    try { await res.text(); } catch (_) { /* ignore */ }
    return { statusCode: res.status, latencyMs: Date.now() - started, ok: res.status >= 200 && res.status < 400 };
  } catch (err) {
    return { statusCode: 0, latencyMs: Date.now() - started, ok: false, error: err.message };
  }
}

async function probeHealth(pool) {
  for (const market of MARKETS) {
    const url = `${API_BASE_URL}/health`;
    const { statusCode, latencyMs, ok } = await timedFetch(url);
    console.log(`[probe] ${market} /health -> ${statusCode} in ${latencyMs}ms (ok=${ok})`);
    await recordRawMeasurement(pool, market, '/health', latencyMs, statusCode);
  }
}

async function probeCatalogStats(pool) {
  // region=sg only per BUY-22737 §2; the catalog DB is sg-canonical.
  const url = `${API_BASE_URL}/v1/catalog/stats`;
  const { statusCode, latencyMs, ok } = await timedFetch(url);
  console.log(`[probe] sg /v1/catalog/stats -> ${statusCode} in ${latencyMs}ms (ok=${ok})`);
  await recordRawMeasurement(pool, 'sg', '/v1/catalog/stats', latencyMs, statusCode);
}

async function probeMcpListCategories(pool) {
  // MCP tools/call is auth-gated. Without a key the call would 401 and skew
  // uptime_pct — so we record status 0 and skip the write if the key is unset.
  if (!SYSTEM_API_KEY) {
    console.warn('[probe] BUYWHERE_SYSTEM_API_KEY not set; skipping mcp:list_categories probe');
    return;
  }
  const url = `${API_BASE_URL}/mcp`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 'probe:list_categories',
    method: 'tools/call',
    params: { name: 'list_categories', arguments: {} },
  });
  const { statusCode, latencyMs, ok } = await timedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${SYSTEM_API_KEY}`,
    },
    body,
  });
  console.log(`[probe] sg mcp:list_categories -> ${statusCode} in ${latencyMs}ms (ok=${ok})`);
  await recordRawMeasurement(pool, 'sg', 'mcp:list_categories', latencyMs, statusCode);
}

/**
 * Start the in-process probe scheduler. Idempotent: calling twice is a no-op.
 * Returns the array of timer handles (mostly for tests).
 */
function startProbeScheduler(pool, opts = {}) {
  if (schedulerStarted) return schedulerTimers;
  schedulerStarted = true;

  // Initial fire on a 5s delay so the server has time to bind its port and
  // the database pool can finish warming up.
  const initialDelayMs = opts.initialDelayMs ?? 5_000;
  setTimeout(() => { void runAllProbes(pool); }, initialDelayMs);

  schedulerTimers.push(setInterval(() => { void probeHealth(pool); }, HEALTH_INTERVAL_MS));
  schedulerTimers.push(setInterval(() => { void probeCatalogStats(pool); }, CATALOG_STATS_INTERVAL_MS));
  schedulerTimers.push(setInterval(() => { void probeMcpListCategories(pool); }, MCP_LIST_CATEGORIES_INTERVAL_MS));

  console.log(`[probe] scheduler started (health ${HEALTH_INTERVAL_MS}ms × ${MARKETS.length} regions, catalog_stats ${CATALOG_STATS_INTERVAL_MS}ms, mcp:list_categories ${MCP_LIST_CATEGORIES_INTERVAL_MS}ms)`);
  return schedulerTimers;
}

function stopProbeScheduler() {
  for (const t of schedulerTimers) clearInterval(t);
  schedulerTimers = [];
  schedulerStarted = false;
}

async function runAllProbes(pool) {
  await Promise.allSettled([
    probeHealth(pool),
    probeCatalogStats(pool),
    probeMcpListCategories(pool),
  ]);
}

module.exports = {
  MARKETS,
  THRESHOLD_MS,
  API_BASE_URL,
  SYSTEM_API_KEY,
  HEALTH_INTERVAL_MS,
  CATALOG_STATS_INTERVAL_MS,
  MCP_LIST_CATEGORIES_INTERVAL_MS,
  recordLatency,
  getCurrentP95,
  getAllMarketsP95,
  getHistory,
  storeP95,
  computeAndStoreP95,
  cleanupOldData,
  calculateP95,
  startProbeScheduler,
  stopProbeScheduler,
  probeHealth,
  probeCatalogStats,
  probeMcpListCategories,
  recordRawMeasurement,
};
