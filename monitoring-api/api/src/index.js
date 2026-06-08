// BuyWhere Monitoring API - BUY-31208, BUY-31294, BUY-22737
// Main entry point for P95 monitoring service + probe scheduler

const express = require('express');
const { Pool } = require('pg');
const { registerRoutes } = require('./monitoring/routes');
const { startProbeScheduler, stopProbeScheduler, API_BASE_URL } = require('./monitoring/p95');

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

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
  console.log('Database connected at:', res.rows[0].now);
  console.log(`Probe target: ${API_BASE_URL}`);
  // BUY-22737: start the in-process probe scheduler once the DB is up.
  startProbeScheduler(pool);
});

// Register monitoring routes
registerRoutes(app, pool);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'buywhere-monitoring-api',
    version: '1.1.0',
    endpoints: {
      health: '/api/monitoring/health',
      p95_current: '/api/monitoring/p95?market=sg',
      p95_history: '/api/monitoring/p95/history?market=sg',
      p95_all: '/api/monitoring/p95/all',
      record: 'POST /api/monitoring/p95/record',
      compute: 'POST /api/monitoring/p95/compute'
    },
    probes: {
      health: { interval_ms: 30_000, regions: ['sg', 'us', 'my', 'vn', 'th'] },
      catalog_stats: { interval_ms: 60_000, regions: ['sg'] },
      mcp_list_categories: { interval_ms: 60_000, regions: ['sg'] }
    },
    documentation: 'BUY-31208 P95 Monitoring Infrastructure, BUY-22737 extended probes'
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
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

module.exports = { app, pool };
