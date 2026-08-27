import { Router, Request, Response } from 'express';
import { db, redis } from '../config';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { agentDetectMiddleware } from '../middleware/agentDetect';
import { queryLogMiddleware } from '../middleware/queryLog';
import { agentIndexMiddleware } from '../middleware/agentHeaders';

const router = Router();

// BUY-75413 (P2.3): emit X-Agent-Index on 200 OK catalog responses.
router.use(agentIndexMiddleware);
const CACHE_TTL = 300; // 5 min — categories change slowly

function slugifyCategory(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error(`[categories] unhandled error on ${req.method} ${req.path}:`, err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  };
}

// GET /v1/categories
// Returns top-level categories derived from products.category_path[1]
router.get(
  '/',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('categories.list'),
  async (req: Request, res: Response) => {
    const start = Date.now();
    const currency = (req.query.currency as string) || 'SGD';
    const cacheKey = `categories:top:${currency}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    } catch (_) {}

    // Fast path: use pre-computed mcp_category_summary table (populated by warmup)
    // Avoids the full GROUP BY on 16M products that always exceeds statement_timeout.
    try {
      const summaryCheck = await db.query(`SELECT to_regclass('public.mcp_category_summary') AS tbl`);
      if (summaryCheck.rows[0]?.tbl) {
        const summaryResult = await db.query(
          `SELECT slug, name, product_count FROM mcp_category_summary ORDER BY product_count DESC LIMIT 50`
        );
        if (summaryResult.rows.length > 0) {
          const categories = summaryResult.rows.map((row) => {
            const initcapName = (row.name as string).replace(/(^|\s|-|_)(\w)/g, (_m: string, sep: string, c: string) => sep + c.toUpperCase());
            return {
              slug: slugifyCategory((row.slug as string) || (row.name as string)),
              name: initcapName,
              product_count: parseInt(row.product_count, 10),
            };
          });
          const body = { data: categories, meta: { total: categories.length, response_time_ms: Date.now() - start } };
          redis.set(cacheKey, JSON.stringify(body), 'EX', CACHE_TTL).catch(() => {});
          return res.json(body);
        }
      }
    } catch (_) {}

    // Slow path fallback: full GROUP BY on products table (only reached if summary table is empty)
    const result = await db.query(
      `SELECT INITCAP(LOWER(raw_name)) AS name, SUM(cnt) AS product_count
       FROM (
         SELECT category_path[1] AS raw_name, COUNT(*) AS cnt
         FROM products
         WHERE currency = $1 AND category_path[1] IS NOT NULL
         GROUP BY category_path[1]
       ) sub
       GROUP BY INITCAP(LOWER(raw_name))
       ORDER BY SUM(cnt) DESC
       LIMIT 50`,
      [currency]
    );

    const categories = result.rows.map((row) => ({
      slug: slugifyCategory(row.name),
      name: row.name,
      product_count: parseInt(row.product_count, 10),
    }));

    const body = { data: categories, meta: { total: categories.length, response_time_ms: Date.now() - start } };
    redis.set(cacheKey, JSON.stringify(body), 'EX', CACHE_TTL).catch(() => {});
    res.json(body);
  }
);

// GET /v1/categories/:slug
// Returns category info + subcategories + sample products
router.get(
  '/:slug',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('categories.get'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const { slug } = req.params;
    const normalizedSlug = slugifyCategory(slug);
    const currency = (req.query.currency as string) || 'SGD';
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
    const offset = parseInt((req.query.offset as string) || '0');

    // Match slug back to a category_path[1] value (case-insensitive slug match)
    const slugResult = await db.query(
      `SELECT DISTINCT category_path[1] AS name FROM products
       WHERE currency = $1 AND category_path IS NOT NULL
         AND LOWER(REGEXP_REPLACE(category_path[1], '[^a-zA-Z0-9]+', '-', 'g')) = $2
       LIMIT 1`,
      [currency, normalizedSlug]
    );

    if (slugResult.rows.length === 0) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    const categoryName = slugResult.rows[0].name;

    const [countResult, productsResult, subCatsResult] = await Promise.all([
      db.query(
        `SELECT COUNT(*) FROM products WHERE currency = $1 AND category_path[1] = $2`,
        [currency, categoryName]
      ),
      db.query(
        `SELECT id, sku AS source_id, platform::text AS domain, url,
                title, price, currency, image_url, updated_at
         FROM products
         WHERE currency = $1 AND category_path[1] = $2
         ORDER BY updated_at DESC
         LIMIT $3 OFFSET $4`,
        [currency, categoryName, limit, offset]
      ),
      db.query(
        `SELECT category_path[2] AS sub_name, COUNT(*) AS product_count
         FROM products
         WHERE currency = $1 AND category_path[1] = $2
           AND array_length(category_path, 1) > 1
         GROUP BY category_path[2]
         ORDER BY COUNT(*) DESC
         LIMIT 20`,
        [currency, categoryName]
      ),
    ]);

    const products = productsResult.rows.map((row) => ({
      id: row.id,
      source: row.source_id,
      domain: row.domain,
      url: row.url,
      title: row.title,
      price: row.price ? parseFloat(row.price) : null,
      currency: row.currency,
      image_url: row.image_url,
      updated_at: row.updated_at,
    }));

    const subcategories = subCatsResult.rows
      .filter((r) => r.sub_name)
      .map((row) => ({
        slug: slugifyCategory(row.sub_name),
        name: row.sub_name,
        product_count: parseInt(row.product_count, 10),
      }));

    res.json({
      data: {
        slug: normalizedSlug,
        name: categoryName,
        product_count: parseInt(countResult.rows[0].count, 10),
        subcategories,
        products,
      },
      meta: { limit, offset, response_time_ms: Date.now() - start },
    });
  })
);

export default router;
