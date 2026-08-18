import { Router, Request, Response } from 'express';
import { db } from '../config';

// Public, unauthenticated stats backing the site's live-numbers strip.
// Every value is either a planner estimate or a narrow indexed scan, and the
// result is cached in-process for 5 minutes — this endpoint can never add
// meaningful DB load no matter how often the site or crawlers hit it.
const router = Router();

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; body: Record<string, unknown> } | null = null;

router.get('/', async (_req: Request, res: Response) => {
  if (cache && Date.now() - cache.at < TTL_MS) {
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(cache.body);
  }
  try {
    const [products, merchants, requests, clicks] = await Promise.all([
      db.query("SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'products'"),
      db.query(
        'SELECT count(*)::bigint AS total, ' +
        'count(*) FILTER (WHERE products_count > 0)::bigint AS with_products FROM merchants'
      ),
      db.query("SELECT count(*)::bigint AS n FROM query_log WHERE created_at > now() - interval '24 hours'"),
      db.query("SELECT count(*)::bigint AS n FROM affiliate_clicks WHERE clicked_at > now() - interval '7 days'"),
    ]);
    const body = {
      products_indexed: Number(products.rows[0]?.n ?? 0),
      merchants_total: Number(merchants.rows[0]?.total ?? 0),
      merchants_with_products: Number(merchants.rows[0]?.with_products ?? 0),
      requests_24h: Number(requests.rows[0]?.n ?? 0),
      outbound_clicks_7d: Number(clicks.rows[0]?.n ?? 0),
      updated_at: new Date().toISOString(),
    };
    cache = { at: Date.now(), body };
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(body);
  } catch (err) {
    if (cache) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json(cache.body); // stale beats an error for a display strip
    }
    return res.status(503).json({ error: 'stats_unavailable' });
  }
});

export default router;
