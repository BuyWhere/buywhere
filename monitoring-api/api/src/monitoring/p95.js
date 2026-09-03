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
const DEPLOY_FAIL_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min for Railway deploy failures

// BUY-35392: Railway failed-deploy poller defaults to the BuyWhere prod project.
const RAILWAY_GRAPHQL_URL = process.env.RAILWAY_GRAPHQL_URL || 'https://backboard.railway.com/graphql/v2';
const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN || '';
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || 'a9456c30-63f8-4701-baa1-ecc9274e95ed';
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || 'ebcb2ca2-f5e8-4713-a3e1-48c92e2b23ae';
const DEPLOY_FAIL_MARKET = process.env.DEPLOY_FAIL_ALERT_MARKET || 'sg';
const DEPLOY_FAIL_SERVICE_IDS = (process.env.RAILWAY_DEPLOY_FAIL_SERVICE_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const DEPLOY_FAIL_STATUSES = new Set(
  (process.env.RAILWAY_FAILED_DEPLOY_STATUSES || 'FAILED')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
);

// BUY-54722: endpoint discriminator for p95 rows. Matches the values
// /api/monitoring/p95/history?endpoint= accepts and the rows that the
// semantic prober will write when /search and /products/:id/similar are
// instrumented. Mirrors monitoring/embedding.js for consistency.
const VALID_ENDPOINTS = ['search', 'similar'];

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
 * Get historical P95 data, optionally filtered by endpoint.
 * BUY-54722: when `endpoint` is 'search' or 'similar' the query is narrowed
 * to those rows so the dashboard can split hybrid vs Find-Similar p95.
 */
async function getHistory(pool, market, from, to, limit = 100, endpoint = null) {
  if (!MARKETS.includes(market)) {
    throw new Error('INVALID_MARKET');
  }
  if (endpoint != null && !VALID_ENDPOINTS.includes(endpoint)) {
    throw new Error('INVALID_ENDPOINT');
  }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();
  const maxLimit = Math.min(limit, 1000);

  const values = [market, fromDate, toDate];
  let endpointClause = '';
  if (endpoint) {
    values.push(endpoint);
    endpointClause = `AND endpoint = ${values.length}`;
  }
  values.push(maxLimit);

  const result = await pool.query(
    `SELECT p95_ms, sample_size, window_start, window_end, endpoint, market
     FROM monitoring.p95_latency
     WHERE market = $1
       AND window_start >= $2
       AND window_end <= $3
       ${endpointClause}
     ORDER BY window_end DESC
     LIMIT ${values.length}`,
    values
  );

  return {
    market,
    endpoint: endpoint || null,
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
     (market, p95_ms, threshold_ms, kind)
     VALUES ($1, $2, $3, 'p95')`,
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
 * Read recent alert history with optional filters.
 */
async function getAlertHistory(pool, options = {}) {
  const {
    market = null,
    kind = null,
    limit = 50,
  } = options;

  const values = [];
  const filters = [];

  if (market) {
    values.push(market);
    filters.push(`market = $${values.length}`);
  }

  if (kind) {
    values.push(kind);
    filters.push(`kind = $${values.length}`);
  }

  values.push(Math.min(Math.max(limit, 1), 500));
  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT id, market, p95_ms, threshold_ms, kind, triggered_at, acknowledged_at,
            acknowledged_by, resolution_notes
       FROM monitoring.alert_history
       ${whereClause}
      ORDER BY triggered_at DESC
      LIMIT $${values.length}`,
    values
  );

  return result.rows;
}

async function railwayGraphql(query, variables = {}, options = {}) {
  const token = options.token || RAILWAY_TOKEN;
  const fetchImpl = options.fetchImpl || fetch;

  if (!token) {
    throw new Error('RAILWAY_TOKEN_MISSING');
  }

  const response = await fetchImpl(RAILWAY_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).join('; ')
      || `HTTP ${response.status}`;
    throw new Error(`RAILWAY_GRAPHQL_FAILED: ${message}`);
  }

  return payload.data;
}

async function listProjectServiceInstances(options = {}) {
  const projectId = options.projectId || RAILWAY_PROJECT_ID;
  const environmentId = options.environmentId || RAILWAY_ENVIRONMENT_ID;
  const serviceIds = options.serviceIds || DEPLOY_FAIL_SERVICE_IDS;

  const projectData = await railwayGraphql(
    `query ProjectServices($projectId: String!) {
      project(id: $projectId) {
        services {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }`,
    { projectId },
    options
  );

  const services = (projectData.project?.services?.edges || [])
    .map((edge) => edge.node)
    .filter((node) => !serviceIds.length || serviceIds.includes(node.id));

  // BUY-37864: project.deployments is the only queryable path with the
  // project-scoped token. The earlier serviceInstance(environmentId, serviceId)
  // query returns "Not Authorized". Fetch a wide recent window once and group
  // by serviceId client-side so each service contributes its latest deployment.
  const lookback = options.deploymentsLookback || 50;
  const deploymentsData = await railwayGraphql(
    `query ProjectDeployments($first: Int!, $input: DeploymentListInput!) {
      deployments(first: $first, input: $input) {
        edges {
          node {
            id
            status
            createdAt
            updatedAt
            deploymentStopped
            staticUrl
            serviceId
            service { name }
          }
        }
      }
    }`,
    { first: lookback, input: { projectId, environmentId } },
    options
  );

  const deployments = (deploymentsData.deployments?.edges || []).map((edge) => edge.node);

  const latestByService = new Map();
  for (const deployment of deployments) {
    if (!deployment.serviceId) continue;
    const existing = latestByService.get(deployment.serviceId);
    if (!existing || new Date(deployment.createdAt) > new Date(existing.createdAt)) {
      latestByService.set(deployment.serviceId, deployment);
    }
  }

  return services
    .map((service) => {
      const latest = latestByService.get(service.id);
      if (!latest) return null;
      return {
        serviceId: service.id,
        serviceName: latest.service?.name || service.name,
        latestDeployment: {
          id: latest.id,
          status: latest.status,
          createdAt: latest.createdAt,
          updatedAt: latest.updatedAt,
          deploymentStopped: latest.deploymentStopped,
          staticUrl: latest.staticUrl,
        },
      };
    })
    .filter(Boolean);
}

function buildDeployFailFingerprint(serviceInstance) {
  return JSON.stringify({
    kind: 'deploy_fail',
    serviceId: serviceInstance.serviceId,
    serviceName: serviceInstance.serviceName,
    deploymentId: serviceInstance.latestDeployment.id,
    status: serviceInstance.latestDeployment.status,
    staticUrl: serviceInstance.latestDeployment.staticUrl || null,
  });
}

async function hasDeployFailAlert(pool, fingerprint) {
  const result = await pool.query(
    `SELECT 1
       FROM monitoring.alert_history
      WHERE kind = 'deploy_fail'
        AND resolution_notes = $1
      LIMIT 1`,
    [fingerprint]
  );

  return result.rowCount > 0;
}

async function insertDeployFailAlert(pool, serviceInstance, fingerprint) {
  const result = await pool.query(
    `INSERT INTO monitoring.alert_history
       (market, p95_ms, threshold_ms, kind, resolution_notes)
     VALUES ($1, 0, 0, 'deploy_fail', $2)
     RETURNING id, triggered_at`,
    [DEPLOY_FAIL_MARKET, fingerprint]
  );

  console.warn(
    `[BUY-35392 Alert] Railway deploy status ${serviceInstance.latestDeployment.status}`
    + ` service=${serviceInstance.serviceName}`
    + ` deployment=${serviceInstance.latestDeployment.id}`
    + ` updated_at=${serviceInstance.latestDeployment.updatedAt}`
  );

  return result.rows[0];
}

async function pollRailwayFailedDeployments(pool, options = {}) {
  let serviceInstances;
  try {
    serviceInstances = await listProjectServiceInstances(options);
  } catch (err) {
    if (String(err.message || '').includes('RAILWAY_TOKEN_MISSING')) {
      console.warn('[deploy-fail] RAILWAY_TOKEN missing; skipping Railway deploy poll');
      return { skipped: true, reason: 'RAILWAY_TOKEN_MISSING', inspected: 0, failing: 0, created: [] };
    }
    throw err;
  }

  const failing = serviceInstances.filter((serviceInstance) => {
    const status = serviceInstance.latestDeployment?.status?.toUpperCase();
    return status && DEPLOY_FAIL_STATUSES.has(status);
  });

  const created = [];
  for (const serviceInstance of failing) {
    const fingerprint = buildDeployFailFingerprint(serviceInstance);
    const alreadyRecorded = await hasDeployFailAlert(pool, fingerprint);
    if (alreadyRecorded) {
      continue;
    }

    const row = await insertDeployFailAlert(pool, serviceInstance, fingerprint);
    created.push({
      id: row.id,
      triggered_at: row.triggered_at,
      service: serviceInstance.serviceName,
      serviceId: serviceInstance.serviceId,
      deploymentId: serviceInstance.latestDeployment.id,
      status: serviceInstance.latestDeployment.status,
      staticUrl: serviceInstance.latestDeployment.staticUrl || null,
      resolution_notes: fingerprint,
    });
  }

  return {
    skipped: false,
    inspected: serviceInstances.length,
    failing: failing.length,
    created,
  };
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
  schedulerTimers.push(setInterval(() => { void pollRailwayFailedDeployments(pool); }, DEPLOY_FAIL_POLL_INTERVAL_MS));

  console.log(
    `[probe] scheduler started (health ${HEALTH_INTERVAL_MS}ms × ${MARKETS.length} regions,`
    + ` catalog_stats ${CATALOG_STATS_INTERVAL_MS}ms,`
    + ` mcp:list_categories ${MCP_LIST_CATEGORIES_INTERVAL_MS}ms,`
    + ` deploy_fail ${DEPLOY_FAIL_POLL_INTERVAL_MS}ms)`
  );
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
    pollRailwayFailedDeployments(pool),
  ]);
}

module.exports = {
  MARKETS,
  VALID_ENDPOINTS,
  THRESHOLD_MS,
  API_BASE_URL,
  SYSTEM_API_KEY,
  HEALTH_INTERVAL_MS,
  CATALOG_STATS_INTERVAL_MS,
  MCP_LIST_CATEGORIES_INTERVAL_MS,
  DEPLOY_FAIL_POLL_INTERVAL_MS,
  DEPLOY_FAIL_STATUSES,
  RAILWAY_PROJECT_ID,
  RAILWAY_ENVIRONMENT_ID,
  recordLatency,
  getCurrentP95,
  getAllMarketsP95,
  getHistory,
  getAlertHistory,
  storeP95,
  computeAndStoreP95,
  cleanupOldData,
  calculateP95,
  startProbeScheduler,
  stopProbeScheduler,
  probeHealth,
  probeCatalogStats,
  probeMcpListCategories,
  listProjectServiceInstances,
  pollRailwayFailedDeployments,
  buildDeployFailFingerprint,
  recordRawMeasurement,
};
