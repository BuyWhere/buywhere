// BUY-54722: Embedding pipeline metrics + cache stats + alert rule.
// Exposes:
//   GET  /api/monitoring/embedding/pipeline_state
//   GET  /api/monitoring/embedding/cache_stats?window=1h
//   GET  /api/monitoring/embedding/p95?endpoint=search|similar
//   POST /api/monitoring/embedding/alerts/check
//
// Alert rule (BUY-41137 acceptance): p95 hybrid > 600ms OR err_rate > 0.1%.
// Posts incidents via the same relay as buywhere-api/src/routes/webhooks.ts
// (UPTIMEROBOT_WEBHOOK_RELAY_URL).

const SEMANTIC_P95_THRESHOLD_MS = 600;
const SEMANTIC_ERR_RATE_THRESHOLD = 0.001; // 0.1%
const VALID_ENDPOINTS = ['search', 'similar'];

const WINDOW_SECONDS = {
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
};
const DEFAULT_CACHE_WINDOW = '1h';
const DEFAULT_P95_WINDOW = '1h';

function parseWindow(window) {
  if (!window) return null;
  const trimmed = String(window).trim().toLowerCase();
  if (WINDOW_SECONDS[trimmed]) return WINDOW_SECONDS[trimmed];
  const m = /^(\d+)(s|m|h)$/.exec(trimmed);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n) || n <= 0) return null;
  if (m[2] === 's') return n;
  if (m[2] === 'm') return n * 60;
  return n * 3600;
}

async function getPipelineState(vectorPool) {
  if (!vectorPool) {
    return { available: false, reason: 'VECTOR_DB_URL not configured on monitoring-api' };
  }
  const client = await vectorPool.connect().catch((err) => {
    const e = new Error('VECTOR_DB_CONNECT_FAILED');
    e.cause = err;
    throw e;
  });
  try {
    const countsResult = await client.query(
      `SELECT
         COUNT(*)::bigint                       AS products_embedded,
         COUNT(*) FILTER (WHERE embedded_at > now() - INTERVAL '24 hours')::bigint AS products_embedded_24h,
         MAX(embedded_at)                       AS last_embedded_at,
         MIN(embedded_at)                       AS first_embedded_at,
         COUNT(DISTINCT model_ver)::int         AS distinct_models
       FROM product_embeddings`
    );
    const counts = countsResult.rows[0] || {};
    let stateRows = [];
    try {
      const stateResult = await client.query(
        `SELECT key, value, updated_at
           FROM embedding_pipeline_state
          ORDER BY key`
      );
      stateRows = stateResult.rows;
    } catch (_err) {
      stateRows = [];
    }
    const state = {};
    for (const row of stateRows) {
      state[row.key] = { value: row.value, updated_at: row.updated_at };
    }
    return {
      available: true,
      products_embedded: Number(counts.products_embedded || 0),
      products_embedded_24h: Number(counts.products_embedded_24h || 0),
      last_embedded_at: counts.last_embedded_at,
      first_embedded_at: counts.first_embedded_at,
      distinct_models: counts.distinct_models || 0,
      pipeline_state: state,
    };
  } finally {
    client.release();
  }
}

async function getCacheStats(redisClient, windowSeconds) {
  if (!redisClient) {
    return { available: false, reason: 'REDIS_URL not configured on monitoring-api' };
  }
  if (!windowSeconds) {
    return { available: false, reason: 'invalid window parameter' };
  }
  const now = Math.floor(Date.now() / 1000);
  const bucketSize = windowSeconds <= 300 ? 10 : 60;
  const startBucket = Math.floor((now - windowSeconds) / bucketSize);
  const endBucket = Math.floor(now / bucketSize);

  let total = 0;
  let hits = 0;
  let misses = 0;
  const buckets = [];

  try {
    const pipeline = redisClient.pipeline();
    for (let b = startBucket; b <= endBucket; b++) {
      pipeline.hgetall(`qembed:stats:${bucketSize}:${b}`);
    }
    const results = await pipeline.exec();
    for (let i = 0; i < results.length; i++) {
      const [err, raw] = results[i];
      if (err || !raw) continue;
      const h = parseInt(raw.hit || '0', 10);
      const m = parseInt(raw.miss || '0', 10);
      if (h === 0 && m === 0) continue;
      total += h + m;
      hits += h;
      misses += m;
      const b = startBucket + i;
      buckets.push({
        bucket_start: new Date(b * bucketSize * 1000).toISOString(),
        hit: h,
        miss: m,
      });
    }
  } catch (err) {
    return { available: false, reason: `redis read failed: ${err.message}` };
  }

  const hit_rate = total === 0 ? null : hits / total;
  const miss_rate = total === 0 ? null : misses / total;

  return {
    available: true,
    window_seconds: windowSeconds,
    bucket_size_seconds: bucketSize,
    total_lookups: total,
    cache_hits: hits,
    cache_misses: misses,
    query_embedding_cache_hit_rate: hit_rate,
    query_embedding_cache_miss_rate: miss_rate,
    buckets: buckets.slice(-50),
  };
}

async function getSemanticP95(pool, endpoint, market, windowSeconds) {
  if (!VALID_ENDPOINTS.includes(endpoint)) {
    const err = new Error('INVALID_ENDPOINT');
    err.code = 'INVALID_ENDPOINT';
    throw err;
  }
  const result = await pool.query(
    `SELECT p95_ms, sample_size, window_start, window_end
       FROM monitoring.p95_latency
      WHERE endpoint = $1
        AND ($2::text IS NULL OR market = $2)
        AND window_end > now() - ($3::int * INTERVAL '1 second')
      ORDER BY window_end DESC
      LIMIT 1`,
    [endpoint, market || null, windowSeconds]
  );
  const errResult = await pool.query(
    `SELECT
       COUNT(*)::int                                                 AS total,
       COUNT(*) FILTER (WHERE status_code >= 500)::int               AS errors_5xx,
       COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS errors_4xx
     FROM monitoring.p95_raw_measurements
     WHERE endpoint = $1
       AND ($2::text IS NULL OR market = $2)
       AND created_at > now() - ($3::int * INTERVAL '1 second')`,
    [endpoint, market || null, windowSeconds]
  );
  const err = errResult.rows[0] || { total: 0, errors_5xx: 0, errors_4xx: 0 };
  const errRate = err.total > 0 ? err.errors_5xx / err.total : 0;
  return {
    endpoint,
    market: market || null,
    window_seconds: windowSeconds,
    p95_ms: result.rows[0]?.p95_ms ?? null,
    sample_size: result.rows[0]?.sample_size ?? null,
    window_start: result.rows[0]?.window_start ?? null,
    window_end: result.rows[0]?.window_end ?? null,
    requests_total: err.total,
    errors_5xx: err.errors_5xx,
    errors_4xx: err.errors_4xx,
    err_rate: errRate,
    p95_threshold_ms: SEMANTIC_P95_THRESHOLD_MS,
    err_rate_threshold: SEMANTIC_ERR_RATE_THRESHOLD,
    alert_triggered: (result.rows[0]?.p95_ms != null && result.rows[0].p95_ms > SEMANTIC_P95_THRESHOLD_MS)
                  || errRate > SEMANTIC_ERR_RATE_THRESHOLD,
  };
}

/**
 * Increment the cache stats counters for a hit or miss.
 * Backed by Redis hash buckets: qembed:stats:<bucketSize>:<bucket> -> { hit, miss }.
 * Exposed so api/src/routes/products.ts and api/src/routes/mcp.ts can call it
 * (or directly via this module) when serving a query embedding lookup.
 */
async function recordCacheLookup(redisClient, isHit) {
  if (!redisClient) return { recorded: false, reason: 'redis not configured' };
  const bucketSize = 60;
  const bucket = Math.floor(Date.now() / 1000 / bucketSize);
  const key = `qembed:stats:${bucketSize}:${bucket}`;
  const field = isHit ? 'hit' : 'miss';
  try {
    await redisClient.hincrby(key, field, 1);
    await redisClient.expire(key, 24 * 60 * 60); // 24h TTL
    return { recorded: true };
  } catch (err) {
    return { recorded: false, reason: err.message };
  }
}

/**
 * Post an incident to the Paperclip relay used by /api/monitoring/uptime-robot.
 * Mirrors api/src/routes/webhooks.ts so incidents surface in the same queue.
 */
async function postAlertIncident(alertRelay, payload) {
  if (!alertRelay || !alertRelay.url || !alertRelay.apiKey) {
    return { dispatched: false, reason: 'alert relay not configured (set UPTIMEROBOT_WEBHOOK_RELAY_URL + UPTIMEROBOT_WEBHOOK_RELAY_API_KEY)' };
  }
  const endpoint = `${alertRelay.url}/api/companies/${alertRelay.companyId}/issues`;
  const issuePayload = {
    title: payload.title,
    description: payload.description,
    status: 'todo',
    priority: 'critical',
    assigneeAgentId: alertRelay.assigneeAgentId,
    parentId: alertRelay.parentIssueId,
    goalId: alertRelay.goalId,
  };
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${alertRelay.apiKey}`,
      },
      body: JSON.stringify(issuePayload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { dispatched: false, reason: `relay ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = await res.json().catch(() => ({}));
    return { dispatched: true, issue_id: json.id, identifier: json.identifier };
  } catch (err) {
    return { dispatched: false, reason: `relay request failed: ${err.message}` };
  }
}

async function checkAndDispatchAlerts(ctx, opts = {}) {
  const { pool, alertRelay } = ctx;
  const windowSeconds = opts.windowSeconds || WINDOW_SECONDS[DEFAULT_P95_WINDOW];
  const triggered = [];
  const details = [];

  for (const endpoint of VALID_ENDPOINTS) {
    const snap = await getSemanticP95(pool, endpoint, null, windowSeconds);
    details.push(snap);
    if (snap.alert_triggered) triggered.push(snap);
  }

  if (triggered.length === 0) {
    return {
      evaluated: details.length,
      triggered_count: 0,
      incidents_created: 0,
      details,
      dispatched: [],
    };
  }

  const dispatched = [];
  for (const snap of triggered) {
    const reasons = [];
    if (snap.p95_ms != null && snap.p95_ms > SEMANTIC_P95_THRESHOLD_MS) {
      reasons.push(`p95=${snap.p95_ms}ms > ${SEMANTIC_P95_THRESHOLD_MS}ms`);
    }
    if (snap.err_rate > SEMANTIC_ERR_RATE_THRESHOLD) {
      reasons.push(`err_rate=${(snap.err_rate * 100).toFixed(3)}% > ${(SEMANTIC_ERR_RATE_THRESHOLD * 100).toFixed(3)}%`);
    }
    const reason = reasons.join(' AND ');
    const title = `[INCIDENT] Semantic ${snap.endpoint} p95/err_rate breach — ${reason}`;
    const description = [
      `**Service:** buywhere-api (semantic search)`,
      `**Endpoint:** ${snap.endpoint}`,
      `**Window:** ${windowSeconds}s`,
      `**Reason:** ${reason}`,
      `**p95:** ${snap.p95_ms ?? 'n/a'} ms (threshold ${SEMANTIC_P95_THRESHOLD_MS} ms)`,
      `**err_rate (5xx):** ${(snap.err_rate * 100).toFixed(3)}% over ${snap.requests_total} requests (threshold ${(SEMANTIC_ERR_RATE_THRESHOLD * 100).toFixed(3)}%)`,
      `**Source:** BUY-54722 monitoring-api alert rule`,
      `**Time:** ${new Date().toISOString()}`,
    ].join('\n');
    const result = await postAlertIncident(alertRelay, { title, description });
    dispatched.push({ endpoint: snap.endpoint, ...result, reason });
  }

  return {
    evaluated: details.length,
    triggered_count: triggered.length,
    incidents_created: dispatched.filter((d) => d.dispatched).length,
    details,
    dispatched,
  };
}

function registerEmbeddingRoutes(app, ctx) {
  const { pool, vectorPool, redisClient, alertRelay } = ctx;
  const apiBase = '/api/monitoring/embedding';

  app.get(`${apiBase}/pipeline_state`, async (_req, res) => {
    try {
      const state = await getPipelineState(vectorPool);
      if (!state.available) {
        return res.status(503).json({
          error: 'NOT_AVAILABLE',
          embedding_pipeline_state: state,
        });
      }
      res.json({
        timestamp: new Date().toISOString(),
        embedding_pipeline_state: {
          products_embedded: state.products_embedded,
          products_embedded_24h: state.products_embedded_24h,
          last_embedded_at: state.last_embedded_at,
          first_embedded_at: state.first_embedded_at,
          distinct_models: state.distinct_models,
          state: state.pipeline_state,
        },
      });
    } catch (err) {
      console.error('[embedding/pipeline_state]', err);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err.message || 'Failed to read embedding pipeline state',
      });
    }
  });

  app.get(`${apiBase}/cache_stats`, async (req, res) => {
    const window = req.query.window || DEFAULT_CACHE_WINDOW;
    const windowSeconds = parseWindow(window);
    if (!windowSeconds) {
      return res.status(400).json({
        error: 'INVALID_WINDOW',
        message: `window must be one of ${Object.keys(WINDOW_SECONDS).join(', ')} or "<n>s|m|h"`,
      });
    }
    const stats = await getCacheStats(redisClient, windowSeconds);
    if (!stats.available) {
      return res.status(503).json({
        error: 'NOT_AVAILABLE',
        cache_stats: stats,
      });
    }
    res.json({
      timestamp: new Date().toISOString(),
      window_seconds: stats.window_seconds,
      bucket_size_seconds: stats.bucket_size_seconds,
      total_lookups: stats.total_lookups,
      cache_hits: stats.cache_hits,
      cache_misses: stats.cache_misses,
      query_embedding_cache_hit_rate: stats.query_embedding_cache_hit_rate,
      query_embedding_cache_miss_rate: stats.query_embedding_cache_miss_rate,
      buckets: stats.buckets,
    });
  });

  app.get(`${apiBase}/p95`, async (req, res) => {
    const endpoint = req.query.endpoint;
    if (!endpoint) {
      return res.status(400).json({
        error: 'MISSING_ENDPOINT',
        message: `endpoint is required (one of: ${VALID_ENDPOINTS.join(', ')})`,
      });
    }
    if (!VALID_ENDPOINTS.includes(endpoint)) {
      return res.status(400).json({
        error: 'INVALID_ENDPOINT',
        message: `endpoint must be one of: ${VALID_ENDPOINTS.join(', ')}`,
      });
    }
    const window = req.query.window || DEFAULT_P95_WINDOW;
    const windowSeconds = parseWindow(window);
    if (!windowSeconds) {
      return res.status(400).json({
        error: 'INVALID_WINDOW',
        message: `window must be one of ${Object.keys(WINDOW_SECONDS).join(', ')} or "<n>s|m|h"`,
      });
    }
    const market = req.query.market || null;
    try {
      const snap = await getSemanticP95(pool, endpoint, market, windowSeconds);
      res.json(snap);
    } catch (err) {
      console.error('[embedding/p95]', err);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err.message || 'Failed to read semantic p95',
      });
    }
  });

  app.post(`${apiBase}/alerts/check`, async (req, res) => {
    const window = (req.query.window || req.body?.window || DEFAULT_P95_WINDOW);
    const windowSeconds = parseWindow(window);
    if (!windowSeconds) {
      return res.status(400).json({
        error: 'INVALID_WINDOW',
        message: `window must be one of ${Object.keys(WINDOW_SECONDS).join(', ')} or "<n>s|m|h"`,
      });
    }
    try {
      const result = await checkAndDispatchAlerts({ pool, alertRelay }, { windowSeconds });
      res.json({
        timestamp: new Date().toISOString(),
        window_seconds: windowSeconds,
        ...result,
      });
    } catch (err) {
      console.error('[embedding/alerts/check]', err);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err.message || 'Failed to evaluate alert rule',
      });
    }
  });
}

module.exports = {
  SEMANTIC_P95_THRESHOLD_MS,
  SEMANTIC_ERR_RATE_THRESHOLD,
  VALID_ENDPOINTS,
  WINDOW_SECONDS,
  DEFAULT_CACHE_WINDOW,
  DEFAULT_P95_WINDOW,
  parseWindow,
  getPipelineState,
  getCacheStats,
  getSemanticP95,
  recordCacheLookup,
  checkAndDispatchAlerts,
  postAlertIncident,
  registerEmbeddingRoutes,
};
