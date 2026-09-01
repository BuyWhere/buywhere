// P95 Monitoring API Routes - BUY-31208, BUY-31294
// API route handlers for P95 latency monitoring

const p95Service = require('./p95');

// Write guard (2026-08-08): p95/record + p95/compute were internet-exposed with
// no auth — anyone could poison the metrics that gate deploys and fire alerts.
// Reads stay public; writes require X-Monitoring-Token. Fail-closed if unset.
function requireWriteToken(req, res, next) {
  const expected = process.env.MONITORING_WRITE_TOKEN || '';
  const got = req.get('x-monitoring-token') || '';
  if (!expected) {
    return res.status(503).json({ error: 'WRITE_DISABLED', message: 'Monitoring writes are not configured.' });
  }
  if (got !== expected) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid X-Monitoring-Token required for writes.' });
  }
  next();
}

function parseResolutionNotes(note) {
  if (!note) {
    return null;
  }

  try {
    return JSON.parse(note);
  } catch (_) {
    return note;
  }
}

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
      const { market, from, to, limit = '100', endpoint } = req.query;

      if (!market) {
        return res.status(400).json({
          error: 'MISSING_MARKET',
          message: 'Market parameter is required'
        });
      }

      const limitNum = parseInt(limit, 10);
      // BUY-54722: optional endpoint filter (search|similar) so the dashboard
      // can split hybrid vs Find-Similar p95 on the same chart.
      const endpointFilter = endpoint ? String(endpoint).trim() : null;
      if (endpointFilter && !p95Service.VALID_ENDPOINTS.includes(endpointFilter)) {
        return res.status(400).json({
          error: 'INVALID_ENDPOINT',
          message: 'endpoint must be one of: ' + p95Service.VALID_ENDPOINTS.join(', ')
        });
      }

      const data = await p95Service.getHistory(
        pool,
        market,
        from ? parseInt(from, 10) : null,
        to ? parseInt(to, 10) : null,
        limitNum,
        endpointFilter
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
   * GET /api/monitoring/alerts?kind=deploy_fail&market=sg&limit=20
   * Returns recent alert history, including BUY-35392 deploy-fail alerts.
   */
  app.get(`${apiBase}/alerts`, async (req, res) => {
    try {
      const { market, kind, limit = '50' } = req.query;
      const limitNum = parseInt(limit, 10);

      if (market && !p95Service.MARKETS.includes(market)) {
        return res.status(400).json({
          error: 'INVALID_MARKET',
          message: `Market must be one of: ${p95Service.MARKETS.join(', ')}`
        });
      }

      const alerts = await p95Service.getAlertHistory(pool, {
        market: market || null,
        kind: kind || null,
        limit: Number.isNaN(limitNum) ? 50 : limitNum,
      });

      res.json({
        timestamp: new Date().toISOString(),
        count: alerts.length,
        alerts: alerts.map((alert) => ({
          id: alert.id,
          market: alert.market,
          kind: alert.kind,
          p95_ms: alert.p95_ms,
          threshold_ms: alert.threshold_ms,
          triggered_at: alert.triggered_at,
          acknowledged_at: alert.acknowledged_at,
          acknowledged_by: alert.acknowledged_by,
          resolution_notes: alert.resolution_notes,
          details: parseResolutionNotes(alert.resolution_notes),
        })),
      });
    } catch (error) {
      console.error('Error fetching alert history:', error);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch alert history'
      });
    }
  });

  /**
   * POST /api/monitoring/p95/record
   * Record a latency measurement (for instrumentation)
   */
  app.post(`${apiBase}/p95/record`, requireWriteToken, async (req, res) => {
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
  app.post(`${apiBase}/p95/compute`, requireWriteToken, async (req, res) => {
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
   * GET /api/monitoring/ceo_kpis?window=24h
   * BUY-75183: Acceptance-gate readback for P2.6 (silently_empty_rate_24h)
   * and P2.7 (deliver_to_pass_rate_24h) — Reed (CPO) starts a 14-day rolling
   * clock once these two columns populate every day.
   *
   * BUY-75445: appends the P2.7 gate-counter — per-window count of v2 calls
   * tagged bucket='external-agent' on monitoring.deliver_to_calls, plus the
   * subset where gate_passed=t (deliver_to present or inferred). Reed's daily
   * monitor (BUY-75346) reads `kpis.mcp_v2_external_agent_calls_24h` to verify
   * the 14-day external-agent > 0/day streak.
   *
   * Currently both pre-existing rates derive from monitoring.v_ceo_kpis. The
   * view supports any window size (the underlying CTEs scan the whole table
   * for now); the `window` query param is validated and surfaced for forward
   * compatibility with planned per-window view variants.
   */
  const ALLOWED_WINDOWS = ['24h', '7d', '30d'];
  app.get(`${apiBase}/ceo_kpis`, async (req, res) => {
    try {
      const window = ALLOWED_WINDOWS.includes(req.query.window)
        ? req.query.window
        : '24h';

      const result = await pool.query(
        `SELECT report_date,
                zero_result_rate,
                near_miss_rate,
                near_miss_7day_mean_under_threshold,
                near_miss_latest_sweep_under_threshold,
                p1_3_nm_status,
                computed_at,
                silently_empty_rate_24h,
                deliver_to_pass_rate_24h,
                mcp_v2_external_agent_calls_24h,
                mcp_v2_external_agent_calls_7d,
                mcp_v2_external_agent_calls_30d,
                mcp_v2_external_agent_calls_with_deliver_to_24h,
                mcp_v2_external_agent_calls_with_deliver_to_7d,
                mcp_v2_external_agent_calls_with_deliver_to_30d,
                affiliate_click_intent_page_total_24h,
                intent_page_r_link_density_avg_24h,
                affiliate_redirect_success_rate_24h,
                affiliate_revenue_intent_page_total_24h_usd
           FROM monitoring.v_ceo_kpis`
      );
      const row = result.rows[0] || null;

      res.json({
        timestamp: new Date().toISOString(),
        window,
        kpis: row,
      });
    } catch (error) {
      console.error('Error fetching ceo_kpis:', error.message);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch CEO KPIs',
      });
    }
  });

  /**
   * GET /api/monitoring/health
   * Health check endpoint — process liveness only. The DB ping was removed
   * because the Postgres replica can be in crash-recovery (57P03) right after
   * a restart; we want Railway to see the process as healthy and let the
   * scheduler retry. DB readiness is reported via the per-probe status_code
   * column in monitoring.p95_raw_measurements.
   */
  app.get(`${apiBase}/health`, (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'buywhere-monitoring-api',
      version: '1.3.0',
      probes: {
        deploy_fail_poll_interval_ms: p95Service.DEPLOY_FAIL_POLL_INTERVAL_MS,
        deploy_fail_statuses: Array.from(p95Service.DEPLOY_FAIL_STATUSES),
      }
    });
  });

  // Optional: keep the old DB-aware path at /api/monitoring/health/db for
  // ops dashboards that want to know the actual DB state.
  app.get(`${apiBase}/health/db`, async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
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
