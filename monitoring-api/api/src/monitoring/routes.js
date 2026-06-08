// P95 Monitoring API Routes - BUY-31208, BUY-31294
// API route handlers for P95 latency monitoring

const p95Service = require('./p95');

/**
 * Register all monitoring routes
 */
function registerRoutes(app, pool) {
  const apiBase = '/api/monitoring';

  /**
   * GET /api/monitoring/p95?market=sg
   * Returns current P95 latency for specified market
   */
  app.get(`${apiBase}/p95`, async (req, res) => {
    try {
      const { market } = req.query;

      if (!market) {
        return res.status(400).json({
          error: 'MISSING_MARKET',
          message: 'Market parameter is required'
        });
      }

      const data = await p95Service.getCurrentP95(pool, market);

      if (!data) {
        return res.status(404).json({
          error: 'NO_DATA',
          message: `No P95 data available for market ${market}`
        });
      }

      res.json({
        market,
        p95_ms: data.p95_ms,
        sample_size: data.sample_size,
        window_start: data.window_start,
        window_end: data.window_end,
        alert_triggered: data.p95_ms > p95Service.THRESHOLD_MS,
        threshold_ms: p95Service.THRESHOLD_MS
      });
    } catch (error) {
      if (error.message === 'INVALID_MARKET') {
        return res.status(400).json({
          error: 'INVALID_MARKET',
          message: `Market must be one of: ${p95Service.MARKETS.join(', ')}`
        });
      }
      console.error('Error fetching P95:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch P95 data'
      });
    }
  });

  /**
   * GET /api/monitoring/p95/history?market=sg&from=X&to=Y&limit=100
   * Returns historical P95 data for trend analysis
   */
  app.get(`${apiBase}/p95/history`, async (req, res) => {
    try {
      const { market, from, to, limit = '100' } = req.query;

      if (!market) {
        return res.status(400).json({
          error: 'MISSING_MARKET',
          message: 'Market parameter is required'
        });
      }

      const limitNum = parseInt(limit, 10);

      const data = await p95Service.getHistory(
        pool,
        market,
        from ? parseInt(from, 10) : null,
        to ? parseInt(to, 10) : null,
        limitNum
      );

      res.json(data);
    } catch (error) {
      if (error.message === 'INVALID_MARKET') {
        return res.status(400).json({
          error: 'INVALID_MARKET',
          message: `Market must be one of: ${p95Service.MARKETS.join(', ')}`
        });
      }
      console.error('Error fetching P95 history:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch historical P95 data'
      });
    }
  });

  /**
   * GET /api/monitoring/p95/all
   * Returns current P95 for all markets (for dashboard)
   */
  app.get(`${apiBase}/p95/all`, async (req, res) => {
    try {
      const markets = await p95Service.getAllMarketsP95(pool);

      // Fill in missing markets
      for (const market of p95Service.MARKETS) {
        if (!markets[market]) {
          markets[market] = {
            p95_ms: null,
            alert_triggered: false
          };
        }
      }

      res.json({
        timestamp: new Date().toISOString(),
        markets
      });
    } catch (error) {
      console.error('Error fetching all markets P95:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch P95 data for all markets'
      });
    }
  });

  /**
   * POST /api/monitoring/p95/record
   * Record a latency measurement (for instrumentation)
   */
  app.post(`${apiBase}/p95/record`, async (req, res) => {
    try {
      const { market, endpoint, latency_ms } = req.body;

      if (!market || !endpoint || latency_ms === undefined) {
        return res.status(400).json({
          error: 'MISSING_PARAMETERS',
          message: 'market, endpoint, and latency_ms are required'
        });
      }

      if (!p95Service.MARKETS.includes(market)) {
        return res.status(400).json({
          error: 'INVALID_MARKET',
          message: `Market must be one of: ${p95Service.MARKETS.join(', ')}`
        });
      }

      p95Service.recordLatency(market, endpoint, latency_ms);

      res.json({
        status: 'recorded',
        market,
        endpoint,
        latency_ms
      });
    } catch (error) {
      console.error('Error recording latency:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to record latency measurement'
      });
    }
  });

  /**
   * POST /api/monitoring/p95/compute
   * Compute and store P95 from recorded samples (for scheduled job)
   */
  app.post(`${apiBase}/p95/compute`, async (req, res) => {
    try {
      const { market = 'all', endpoint = '/mcp' } = req.body;

      let results;
      if (market === 'all') {
        results = [];
        for (const m of p95Service.MARKETS) {
          const result = await p95Service.computeAndStoreP95(pool, m, endpoint);
          if (result) {
            results.push({ market: m, ...result });
          }
        }
      } else {
        if (!p95Service.MARKETS.includes(market)) {
          return res.status(400).json({
            error: 'INVALID_MARKET',
            message: `Market must be one of: ${p95Service.MARKETS.join(', ')}`
          });
        }
        const result = await p95Service.computeAndStoreP95(pool, market, endpoint);
        results = result ? [{ market, ...result }] : [];
      }

      res.json({
        status: 'computed',
        computed: results.length,
        results
      });
    } catch (error) {
      console.error('Error computing P95:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to compute P95'
      });
    }
  });

  /**
   * GET /api/monitoring/health
   * Health check endpoint
   */
  app.get(`${apiBase}/health`, async (req, res) => {
    try {
      // Check database connection
      await pool.query('SELECT 1');

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'buywhere-monitoring-api',
        version: '1.0.0'
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Database connection failed'
      });
    }
  });
}

module.exports = { registerRoutes };
