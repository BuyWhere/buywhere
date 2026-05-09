import { Router, Request, Response } from 'express';
import { db, redis } from '../config';

const router = Router();

const STATS_CACHE_KEY = 'catalog:stats';
const STATS_CACHE_TTL = 600; // 10 minutes — stats change slowly

// GET /v1/catalog/stats — catalog-level aggregate statistics
// Unauthenticated — used by MCP server info, monitor, and discovery tools
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // Try cache first — the underlying query is expensive (full table scan on 15M+ rows)
    try {
      const cached = await redis.get(STATS_CACHE_KEY);
      if (cached) return res.json(JSON.parse(cached));
    } catch (_) {}

    // Split into parallel queries (each <5s) instead of one 27s full-table scan
    // that exceeds the 10s statement_timeout. Use subqueries for DISTINCT counts
    // to leverage index skip-scan behavior.
    const [countResult, merchantsResult, recentResult, countriesResult] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total_products FROM products WHERE is_active = true`),
      db.query(`SELECT COUNT(*)::int AS total_merchants FROM (SELECT DISTINCT source FROM products WHERE is_active = true) sub`),
      db.query(`SELECT COUNT(*)::int AS products_added_7d FROM products WHERE is_active = true AND updated_at >= NOW() - INTERVAL '7 days'`),
      db.query(`SELECT COUNT(*)::int AS total_countries FROM (SELECT DISTINCT country_code FROM products WHERE is_active = true) sub`),
    ]);

    let totalRegisteredMerchants = 0;
    try {
      const regResult = await db.query('SELECT COUNT(*)::int AS count FROM merchants');
      totalRegisteredMerchants = regResult.rows[0].count;
    } catch {
      // merchants table may not exist in all environments
    }

    const stats = {
      total_products: countResult.rows[0].total_products,
      total_merchants: merchantsResult.rows[0].total_merchants,
      products_added_7d: recentResult.rows[0].products_added_7d,
      total_countries: countriesResult.rows[0].total_countries,
    };

    const body = {
      data: {
        total_products: stats.total_products,
        total_merchants: stats.total_merchants,
        products_added_7d: stats.products_added_7d,
        total_countries: stats.total_countries,
        total_registered_merchants: totalRegisteredMerchants,
      },
      meta: { ts: new Date().toISOString() },
    };

    // Cache result
    redis.set(STATS_CACHE_KEY, JSON.stringify(body), 'EX', STATS_CACHE_TTL).catch(() => {});

    res.json(body);
  } catch (err) {
    console.error('[catalog/stats] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
