import { Router, Request, Response } from 'express';
import { db } from '../config';

const router = Router();

// GET /v1/catalog/stats — catalog-level aggregate statistics
// Unauthenticated — used by MCP server info, monitor, and discovery tools
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const productsResult = await db.query(`
      SELECT
        COUNT(*)::int AS total_products,
        COUNT(DISTINCT source)::int AS total_merchants,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '7 days')::int AS products_added_7d,
        COUNT(DISTINCT country_code)::int AS total_countries
      FROM products WHERE is_active = true
    `);

    let totalRegisteredMerchants = 0;
    try {
      const merchantsResult = await db.query('SELECT COUNT(*)::int AS count FROM merchants');
      totalRegisteredMerchants = merchantsResult.rows[0].count;
    } catch {
      // merchants table may not exist in all environments
    }

    const stats = productsResult.rows[0];

    res.json({
      data: {
        total_products: stats.total_products,
        total_merchants: stats.total_merchants,
        products_added_7d: stats.products_added_7d,
        total_countries: stats.total_countries,
        total_registered_merchants: totalRegisteredMerchants,
      },
      meta: { ts: new Date().toISOString() },
    });
  } catch (err) {
    console.error('[catalog/stats] exact query failed, trying approximate:', (err as Error).message);

    try {
      // Fall back to approximate stats from PostgreSQL system catalogs
      // Works even when the table is too large for exact aggregates to complete in time
      const [relResult, srcStats, ccStats] = await Promise.all([
        db.query(
          `SELECT reltuples::bigint AS estimated_rows
           FROM pg_class WHERE relname = 'products'`
        ),
        db.query(
          `SELECT n_distinct FROM pg_stats
           WHERE tablename = 'products' AND attname = 'source'`
        ),
        db.query(
          `SELECT n_distinct FROM pg_stats
           WHERE tablename = 'products' AND attname = 'country_code'`
        ),
      ]);

      const estimatedTotal = relResult.rows[0]?.estimated_rows ?? 0;
      const sourceNDistinct = srcStats.rows[0]?.n_distinct ?? 0;
      const ccNDistinct = ccStats.rows[0]?.n_distinct ?? 0;

      let totalRegisteredMerchants = 0;
      try {
        const m = await db.query('SELECT COUNT(*)::int AS count FROM merchants');
        totalRegisteredMerchants = m.rows[0].count;
      } catch {
        // merchants table may not exist in all environments
      }

      res.json({
        data: {
          total_products: Math.max(0, estimatedTotal),
          total_merchants: sourceNDistinct > 0
            ? Math.round(Math.abs(sourceNDistinct))
            : null as unknown as number,
          products_added_7d: null as unknown as number,
          total_countries: ccNDistinct > 0
            ? Math.round(Math.abs(ccNDistinct))
            : null as unknown as number,
          total_registered_merchants: totalRegisteredMerchants,
        },
        meta: { ts: new Date().toISOString(), approximate: true },
      });
    } catch (fallbackErr) {
      console.error('[catalog/stats] fallback also failed:', fallbackErr);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
