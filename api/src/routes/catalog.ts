import { Router, Request, Response } from 'express';
import { db, redis } from '../config';

const router = Router();

const CACHE_KEY = 'catalog:stats:exact';
const CACHE_TTL = 300;
const REFRESH_LOCK_KEY = 'catalog:stats:refresh-lock';
const REFRESH_LOCK_TTL = 30;

interface ExactStats {
  total_products: number;
  active_products: number;
  total_merchants: number;
  collected_at: string;
}

async function tryExactCount(): Promise<ExactStats | null> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 10000');
    const result = await client.query(`
      SELECT
        count(*) AS total_products,
        count(*) FILTER (WHERE is_active) AS active_products,
        count(DISTINCT merchant_id) AS total_merchants,
        now() AT TIME ZONE 'utc' AS collected_at
      FROM products
    `);
    await client.query('COMMIT');
    const row = result.rows[0];
    return {
      total_products: Number(row.total_products),
      active_products: Number(row.active_products),
      total_merchants: Number(row.total_merchants),
      collected_at: row.collected_at.toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return null;
  } finally {
    client.release();
  }
}

async function triggerBackgroundRefresh(): Promise<void> {
  try {
    const lock = await redis.set(REFRESH_LOCK_KEY, '1', 'EX', REFRESH_LOCK_TTL, 'NX');
    if (lock !== 'OK') return;
    const stats = await tryExactCount();
    if (stats) {
      await redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL);
    }
  } catch {}
}

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const cached = await redis.get(CACHE_KEY).catch(() => null);
    if (cached) {
      const stats: ExactStats = JSON.parse(cached);
      triggerBackgroundRefresh().catch(() => {});
      res.json({
        data: {
          total_products: stats.total_products,
          total_merchants: stats.total_merchants,
          active_products: stats.active_products,
        },
        meta: {
          approximate: false,
          source: 'public.products',
          ts: stats.collected_at,
        },
      });
      return;
    }

    const fresh = await tryExactCount();
    if (fresh) {
      await redis.set(CACHE_KEY, JSON.stringify(fresh), 'EX', CACHE_TTL).catch(() => {});
      res.json({
        data: {
          total_products: fresh.total_products,
          total_merchants: fresh.total_merchants,
          active_products: fresh.active_products,
        },
        meta: {
          approximate: false,
          source: 'public.products',
          ts: fresh.collected_at,
        },
      });
      return;
    }

    const [productsEst, merchantsEst] = await Promise.all([
      db.query(`SELECT reltuples::bigint AS est FROM pg_class WHERE oid = 'public.products'::regclass`),
      db.query(`SELECT reltuples::bigint AS est FROM pg_class WHERE oid = 'public.merchants'::regclass`),
    ]);
    const totalProducts = Math.max(Number(productsEst.rows[0]?.est || 0), 0);
    const totalMerchants = Math.max(Number(merchantsEst.rows[0]?.est || 0), 0);

    triggerBackgroundRefresh().catch(() => {});
    res.json({
      data: {
        total_products: totalProducts,
        total_merchants: totalMerchants,
        active_products: totalProducts,
      },
      meta: {
        approximate: true,
        source: 'pg_class_estimate',
        ts: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[catalog/stats] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
