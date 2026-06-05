import { Router, Request, Response } from 'express';
import { db } from '../config';

const router = Router();

// GET /v1/catalog/stats — catalog-level aggregate statistics
// Unauthenticated — used by MCP server info, monitor, and discovery tools
// Primary: catalog_stats counter table (BUY-22720, BUY-30969). Fallback: pg_class estimate.
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [statsResult, merchantsResult] = await Promise.all([
      db.query(`
        SELECT total FROM catalog_stats
        WHERE source IS NULL AND region IS NULL AND country_code IS NULL
        LIMIT 1
      `),
      db.query(`SELECT reltuples::bigint AS total FROM pg_class WHERE oid = 'public.merchants'::regclass`),
    ]);

    let totalProducts: number;
    let source: string;

    if (statsResult.rows.length > 0 && Number(statsResult.rows[0].total) > 0) {
      totalProducts = Number(statsResult.rows[0].total);
      source = 'catalog_stats';
    } else {
      const pgResult = await db.query(
        `SELECT reltuples::bigint AS total FROM pg_class WHERE oid = 'public.products'::regclass`
      );
      totalProducts = Math.max(Number(pgResult.rows[0]?.total || 0), 0);
      source = 'pg_class_fallback';
    }

    const totalMerchants = Math.max(Number(merchantsResult.rows[0]?.total || 0), 0);

    res.json({
      data: {
        total_products: totalProducts,
        total_merchants: totalMerchants,
        active_products: totalProducts,
      },
      meta: {
        approximate: true,
        source,
        ts: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[catalog/stats] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /v1/catalog/categories — top categories from cached mcp_category_summary table (BUY-30969)
// Unauthenticated — used by MCP discovery, category browsing, and analytics tools
// Reads only from the pre-computed summary table; never falls back to live COUNT(*) on products.
router.get('/categories', async (_req: Request, res: Response) => {
  const start = Date.now();
  try {
    const result = await db.query(
      `SELECT slug, name, product_count FROM mcp_category_summary ORDER BY product_count DESC LIMIT 50`
    );

    const categories = result.rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      product_count: parseInt(row.product_count, 10),
    }));

    res.json({
      data: categories,
      meta: {
        total: categories.length,
        source: 'mcp_category_summary',
        response_time_ms: Date.now() - start,
      },
    });
  } catch (err) {
    console.error('[catalog/categories] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
