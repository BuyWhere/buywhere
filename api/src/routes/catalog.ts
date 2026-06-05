import { Router, Request, Response } from 'express';
import { db, redis } from '../config';

const router = Router();

const CACHE_KEY = 'catalog:stats:exact';
const CACHE_TTL = 300;

interface ExactStats {
  total_products: number;
  active_products: number;
  total_merchants: number;
  collected_at: string;
}

async function computeExactStats(): Promise<ExactStats> {
  const client = await db.connect();
  try {
    await client.query('SET LOCAL statement_timeout = 8000');
    const result = await client.query(`
      SELECT
        count(*) AS total_products,
        count(*) FILTER (WHERE is_active) AS active_products,
        count(DISTINCT merchant_id) AS total_merchants,
        now() AT TIME ZONE 'utc' AS collected_at
      FROM products
    `);
    return {
      total_products: Number(result.rows[0].total_products),
      active_products: Number(result.rows[0].active_products),
      total_merchants: Number(result.rows[0].total_merchants),
      collected_at: result.rows[0].collected_at.toISOString(),
    };
  } finally {
    client.release();
  }
}

async function getExactStats(): Promise<ExactStats | null> {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch {}

  try {
    const stats = await computeExactStats();
    try { await redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL); } catch {}
    return stats;
  } catch (err) {
    console.error('[catalog/stats] exact count failed, falling back:', (err as Error).message);
    return null;
  }
}

async function getFallbackStats(): Promise<{ total_products: number; total_merchants: number; source: string }> {
  try {
    const result = await db.query(`
      SELECT total FROM catalog_stats
      WHERE source IS NULL AND region IS NULL AND country_code IS NULL
      LIMIT 1
    `);
    if (result.rows.length > 0 && Number(result.rows[0].total) > 0) {
      const pgResult = await db.query(
        `SELECT reltuples::bigint AS total FROM pg_class WHERE oid = 'public.merchants'::regclass`
      );
      return {
        total_products: Number(result.rows[0].total),
        total_merchants: Math.max(Number(pgResult.rows[0]?.total || 0), 0),
        source: 'catalog_stats',
      };
    }
  } catch {}

  const result = await db.query(`
    SELECT
      (SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.products'::regclass) AS total_products,
      (SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.merchants'::regclass) AS total_merchants
  `);
  const row = result.rows[0] || {};
  return {
    total_products: Math.max(Number(row.total_products || 0), 0),
    total_merchants: Math.max(Number(row.total_merchants || 0), 0),
    source: 'pg_class_fallback',
  };
}

// GET /v1/catalog/stats — catalog-level aggregate statistics
// Unauthenticated — used by MCP server info, monitor, and discovery tools
// Primary: exact count from public.products (cached 5 min in Redis). Fallback: catalog_stats / pg_class.
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const exact = await getExactStats();
    if (exact) {
      res.json({
        data: {
          total_products: exact.total_products,
          total_merchants: exact.total_merchants,
          active_products: exact.active_products,
        },
        meta: {
          approximate: false,
          source: 'public.products',
          ts: exact.collected_at,
        },
      });
      return;
    }

    const fallback = await getFallbackStats();
    res.json({
      data: {
        total_products: fallback.total_products,
        total_merchants: fallback.total_merchants,
        active_products: fallback.total_products,
      },
      meta: {
        approximate: true,
        source: fallback.source,
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
