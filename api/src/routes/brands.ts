import { Router, Request, Response } from 'express';
import { redis } from '../config';
import { readDb } from '../lib/readReplica';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { agentDetectMiddleware } from '../middleware/agentDetect';
import { queryLogMiddleware } from '../middleware/queryLog';
import { agentIndexMiddleware } from '../middleware/agentHeaders';

const router = Router();

// BUY-75413 (P2.3): emit X-Agent-Index on 200 OK catalog responses.
router.use(agentIndexMiddleware);
const CACHE_TTL = 900; // 15 min — brands change slowly

// Brand metadata mapping from commerce-routes.ts
const BRAND_METADATA: Record<string, { name: string; description: string; logo_url?: string }> = {
  apple: {
    name: 'Apple',
    description: 'Discover Apple products including iPhone, iPad, Mac, Apple Watch, and accessories. Compare prices across retailers.',
    logo_url: undefined,
  },
  samsung: {
    name: 'Samsung',
    description: 'Explore Samsung smartphones, tablets, TVs, appliances, and electronics. Find the best deals from multiple retailers.',
    logo_url: undefined,
  },
  sony: {
    name: 'Sony',
    description: 'Browse Sony products including PlayStation, cameras, headphones, TVs, and audio equipment. Compare prices and save.',
    logo_url: undefined,
  },
  nike: {
    name: 'Nike',
    description: 'Shop Nike footwear, apparel, and sports equipment. Compare prices across retailers for the best deals.',
    logo_url: undefined,
  },
  dyson: {
    name: 'Dyson',
    description: 'Find Dyson vacuums, fans, heaters, and hair care products. Compare prices from authorized retailers.',
    logo_url: undefined,
  },
  nintendo: {
    name: 'Nintendo',
    description: 'Discover Nintendo consoles, games, and accessories. Compare prices for Switch, games, and more.',
    logo_url: undefined,
  },
  dell: {
    name: 'Dell',
    description: 'Browse Dell laptops, desktops, monitors, and accessories. Find the best prices from multiple retailers.',
    logo_url: undefined,
  },
  lenovo: {
    name: 'Lenovo',
    description: 'Explore Lenovo laptops, tablets, smartphones, and accessories. Compare prices and save on your next purchase.',
    logo_url: undefined,
  },
  canon: {
    name: 'Canon',
    description: 'Find Canon cameras, lenses, printers, and imaging equipment. Compare prices from trusted retailers.',
    logo_url: undefined,
  },
  xiaomi: {
    name: 'Xiaomi',
    description: 'Discover Xiaomi smartphones, smart home devices, and electronics. Compare prices across retailers.',
    logo_url: undefined,
  },
};

function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error(`[brands] unhandled error on ${req.method} ${req.path}:`, err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  };
}

// GET /v1/brand/:slug
// 2026-08-27: `WHERE brand = $1` was a sequential scan of the 365M-row products table (no brand index) →
// 30 s statement timeout → 500 → every brand page 404'd whenever the Redis cache expired. Narrowing with the
// FTS GIN index (brand names are in search_vector) turns it into a bitmap scan (100–250 ms on the replica).
// lower(brand) because the column is mixed-case (Dyson/DYSON).
// Returns brand data and products for a given brand slug
router.get(
  '/:slug',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('brand.get'),
  async (req: Request, res: Response) => {
    const { slug } = req.params;
    const currency = (req.query.currency as string) || 'SGD';
    const cacheKey = `brand:${slug}:${currency}`;

    // Validate slug
    const normalizedSlug = slug.toLowerCase();
    if (!BRAND_METADATA[normalizedSlug]) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    try {
      // Check cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    } catch (err) {
      console.error('[brands] redis get error:', err);
      // Continue without cache
    }

    const client = await readDb().connect();
    try {
      const brandMeta = BRAND_METADATA[normalizedSlug];

      // BUY-78930: known brands (sony/apple/samsung/lenovo) hung past 15s with 0 bytes
      // because the FTS+lower(brand) scan never returned and the site fetch had no AbortSignal.
      // Bound this request well under the SSR timeout so the page can 500 → Temporarily Unavailable.
      await client.query("SET LOCAL statement_timeout = '8000'");
      await client.query("SET LOCAL lock_timeout = '2000'");

      // Bounded-candidate pattern (same as get_deals): the FTS GIN index narrows to this brand's rows,
      // we take a small unsorted window, then rank those. Sorting the full match set for a
      // big brand (Apple/Nike = millions of rows) blew the 30 s statement timeout.
      const query = `
        WITH cand AS (
          SELECT id, title, price, avg_rating, in_stock, image_url, url, country_code
          FROM products
          WHERE search_vector @@ plainto_tsquery('english', $1)
            AND lower(brand) = lower($1)
            AND is_active = true
            AND is_available = true
          LIMIT 200
        )
        SELECT id, title, price, avg_rating as rating, in_stock, image_url, url, country_code
        FROM cand
        ORDER BY avg_rating DESC NULLS LAST, price ASC
        LIMIT 24
      `;

      const result = await client.query(query, [brandMeta.name]);

      // Transform products to match frontend interface
      const products = result.rows.map((row) => ({
        slug: row.id.toString(),
        name: row.title,
        price: parseFloat(row.price),
        rating: row.rating ? parseFloat(row.rating) : 0,
        in_stock: row.in_stock !== false,
        image_url: row.image_url,
        compare_url: row.url,
      }));

      // BUY-78930: skip the second COUNT scan (same predicate, LIMIT 5000) — it doubled hang
      // time on cache miss. Display count is the page-sized result.
      const product_count = products.length;

      const response = {
        slug: normalizedSlug,
        name: brandMeta.name,
        logo_url: brandMeta.logo_url,
        description: brandMeta.description,
        product_count,
        products,
      };

      // Cache the response
      try {
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(response));
      } catch (err) {
        console.error('[brands] redis set error:', err);
        // Continue without caching
      }

      return res.json(response);
    } catch (err) {
      console.error(`[brands] error fetching brand ${slug}:`, err);
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  }
);

export default router;