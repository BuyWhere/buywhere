// BuyWhere Monitoring API - BUY-31208, BUY-31294, BUY-22737
// Main entry point for P95 monitoring service + probe scheduler

const express = require('express');
const { Pool } = require('pg');
const { registerRoutes } = require('./monitoring/routes');
const { startProbeScheduler, stopProbeScheduler, API_BASE_URL } = require('./monitoring/p95');
const { registerEmbeddingRoutes } = require('./monitoring/embedding');

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Parse port from environment or use default
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

// Initialize database connection pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // BUY-22737: prober writes are write-mostly and infrequent; keep the pool
  // small so we don't hold open a herd of idle connections on Railway.
  max: 5,
  idleTimeoutMillis: 30_000,
});

// BUY-54722: vector-db pool (pgvector 0.8 / 100M+ product_embeddings)
const VECTOR_DB_URL = process.env.VECTOR_DB_URL || '';
const vectorPool = VECTOR_DB_URL
  ? new Pool({
      connectionString: VECTOR_DB_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 3,
      idleTimeoutMillis: 30_000,
    })
  : null;

// BUY-54722: Redis pool for query-embedding cache hit/miss counters
const REDIS_URL = process.env.REDIS_URL || '';
let redisClient = null;
if (REDIS_URL) {
  try {
    // Lazy require so a missing ioredis install does not crash the prober
    // when the cache endpoint is disabled.
    const Redis = require('ioredis');
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    redisClient.on('error', (err) => {
      console.warn('[redis] connection error:', err.message);
    });
  } catch (err) {
    console.warn('[redis] ioredis unavailable, cache stats endpoint disabled:', err.message);
    redisClient = null;
  }
}

// BUY-54722: alert relay — same target as api/src/routes/webhooks.ts
const ALERT_RELAY_URL = (process.env.UPTIMEROBOT_WEBHOOK_RELAY_URL || '').replace(/\/+$/, '');
const ALERT_RELAY_API_KEY = process.env.UPTIMEROBOT_WEBHOOK_RELAY_API_KEY || '';
const ALERT_RELAY_COMPANY_ID = process.env.UPTIMEROBOT_WEBHOOK_RELAY_COMPANY_ID || '177bc805-e3c8-4336-84cb-8e1e482d5a17';
const ALERT_RELAY_PARENT_ISSUE_ID = process.env.ALERT_RELAY_PARENT_ISSUE_ID || '79d50257-93fa-43d2-9042-bc14bcafd4b4'; // BUY-13701
const ALERT_RELAY_GOAL_ID = process.env.ALERT_RELAY_GOAL_ID || '2c19e8cc-3e32-4144-8fcb-c4f206cb9fa4';
const ALERT_RELAY_ASSIGNEE_AGENT_ID = process.env.ALERT_RELAY_ASSIGNEE_AGENT_ID || '8ca957f8-0911-4e81-a963-e2cf54c97d44';

// BUY-22737: always start the scheduler regardless of the initial DB ping.
// If the Postgres replica is in crash-recovery (57P03) at deploy time the
// individual probe inserts will fail and be logged, but the next probe tick
// will succeed. The /api/monitoring/health endpoint is process-liveness only.
console.log(`Probe target: ${API_BASE_URL}`);
console.log('Database URL present, starting probe scheduler immediately');
startProbeScheduler(pool);

// Register monitoring routes
registerRoutes(app, pool);

// BUY-54722: embedding pipeline + cache stats endpoints
registerEmbeddingRoutes(app, {
  pool,
  vectorPool,
  redisClient,
  alertRelay: {
    url: ALERT_RELAY_URL,
    apiKey: ALERT_RELAY_API_KEY,
    companyId: ALERT_RELAY_COMPANY_ID,
    parentIssueId: ALERT_RELAY_PARENT_ISSUE_ID,
    goalId: ALERT_RELAY_GOAL_ID,
    assigneeAgentId: ALERT_RELAY_ASSIGNEE_AGENT_ID,
  },
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'buywhere-monitoring-api',
    version: '1.2.0',
    endpoints: {
      health: '/api/monitoring/health',
      p95_current: '/api/monitoring/p95?market=sg',
      p95_history: '/api/monitoring/p95/history?market=sg&endpoint=search|similar',
      p95_all: '/api/monitoring/p95/all',
      alerts: '/api/monitoring/alerts?kind=deploy_fail|semantic_p95',
      record: 'POST /api/monitoring/p95/record',
      compute: 'POST /api/monitoring/p95/compute',
      embedding_pipeline_state: 'GET /api/monitoring/embedding/pipeline_state',
      embedding_cache_stats: 'GET /api/monitoring/embedding/cache_stats?window=1h'
    },
    probes: {
      health: { interval_ms: 30_000, regions: ['sg', 'us', 'my', 'vn', 'th'] },
      catalog_stats: { interval_ms: 60_000, regions: ['sg'] },
      mcp_list_categories: { interval_ms: 60_000, regions: ['sg'] },
      railway_deploy_fail: { interval_ms: 300_000, statuses: ['FAILED'] }
    },
    documentation: 'BUY-31208 P95 Monitoring Infrastructure, BUY-22737 extended probes, BUY-54722 embedding-pipeline metrics'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`BuyWhere Monitoring API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/monitoring/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  stopProbeScheduler();
  pool.end().catch(() => {});
  if (vectorPool) vectorPool.end().catch(() => {});
  if (redisClient) redisClient.quit().catch(() => {});
  process.exit(0);
});

module.exports = { app, pool };
