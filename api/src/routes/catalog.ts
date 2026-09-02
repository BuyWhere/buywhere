import { Router, Request, Response } from 'express';
import { redis, catalogDb } from '../config';
import { readDb, replicaStatus } from '../lib/readReplica';
import { agentIndexMiddleware } from '../middleware/agentHeaders';

// BUY-45692: heavy catalog aggregates read from the replica when one is
// configured (REPLICA_DATABASE_URL) and caught up; otherwise readDb() returns
// the primary `db`. Interactive /v1/products/search stays on the primary.
// `db` is still used for the cheap pg_class estimates so they're available even
// before a replica is provisioned, but the expensive scans route through readDb.

const router = Router();

// BUY-75413 (P2.3): emit X-Agent-Index on 200 OK catalog responses.
router.use(agentIndexMiddleware);

// ─── Cache constants ───────────────────────────────────────────────────────
const CACHE_KEY = 'catalog:stats:exact';
const CACHE_TTL = 900;           // 15 min — reduces pressure on exact counts
const REFRESH_LOCK_KEY = 'catalog:stats:refresh-lock';
const REFRESH_LOCK_TTL = 120;    // 2 min lock to prevent thundering herd
const CATALOG_STATS_SOURCE_EXACT = 'catalog_stats';
const CATALOG_STATS_SOURCE_FALLBACK = 'pg_class_fallback';

// ─── Types ─────────────────────────────────────────────────────────────────
interface CatalogStatsResult {
  total_products: number;
  active_products: number;
  total_merchants: number;
  approximate: boolean;
  source: string;
  collected_at: string;
}

// ─── Fast estimate using pg_class + TABLESAMPLE ────────────────────────────
// BUY-31222: Full COUNT(*) on 32M rows times out at 60s on Railway Postgres.
// Use pg_class.reltuples for totals, TABLESAMPLE for active ratio,
// and exact count on the much-smaller merchants table.
async function collectExactSnapshot(): Promise<CatalogStatsResult | null> {
  // BUY-74088: never serve pg_class.reltuples from /v1/catalog/stats.
  // catalog_product_counts is maintained by the daily reconciliation job with
  // real COUNT(*) values. Reading one row is O(1) and stays under the gateway.
  const reader = readDb();
  try {
    const result = await reader.query(`
      SELECT total_products, active_products, total_merchants, snapshot_at
        FROM catalog_product_counts
       ORDER BY snapshot_at DESC
       LIMIT 1
    `);
    const row = result.rows?.[0];
    if (!row) return null;
    return {
      total_products: Number(row.total_products),
      active_products: Number(row.active_products),
      total_merchants: Number(row.total_merchants),
      approximate: false,
      source: CATALOG_STATS_SOURCE_EXACT,
      collected_at: new Date(row.snapshot_at).toISOString(),
    };
  } catch (err) {
    console.warn('[catalog/stats] catalog_product_counts read failed', err);
    return null;
  }
}

async function collectStats(): Promise<CatalogStatsResult> {
  const snapshot = await collectExactSnapshot();
  if (snapshot) return snapshot;

  const now = new Date().toISOString();
  const reader = readDb();
  const [
    productsEst,
    merchantsExact,
  ] = await Promise.all([
    reader.query(`SELECT reltuples::bigint AS est FROM pg_class WHERE oid = 'public.products'::regclass`)
      .then(r => Math.max(Number(r.rows?.[0]?.est || 0), 0))
      .catch(() => 0),
    reader.query(`SELECT count(*) AS cnt FROM merchants`)
      .then(r => Number(r.rows?.[0]?.cnt || 0))
      .catch(() =>
        reader.query(`SELECT reltuples::bigint AS est FROM pg_class WHERE oid = 'public.merchants'::regclass`)
          .then(r => Math.max(Number(r.rows?.[0]?.est || 0), 0))
          .catch(() => 0)
      ),
  ]);
  const activeRatio = 0.99;
  let activeProducts = Math.round(productsEst * activeRatio);
  if (activeProducts > productsEst) activeProducts = productsEst;
  if (activeProducts < 0) activeProducts = productsEst;
  return {
    total_products: productsEst,
    active_products: activeProducts,
    total_merchants: merchantsExact,
    approximate: true,
    source: CATALOG_STATS_SOURCE_FALLBACK,
    collected_at: now,
  };
}

// ─── Try exact count (background use, may time out on large tables) ─────
async function tryExactCount(timeoutMs = 45000): Promise<CatalogStatsResult | null> {
  // Heavy full-table count — route to the replica when available (BUY-45692).
  const client = await readDb().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
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
      approximate: false,
      source: CATALOG_STATS_SOURCE_EXACT,
      collected_at: row.collected_at.toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.warn('[catalog/stats] exact count failed (timeout_ms=%d):', timeoutMs, (err as Error).message);
    return null;
  } finally {
    client.release();
  }
}

// ─── Background refresh ─────────────────────────────────────────────────
async function triggerBackgroundRefresh(): Promise<void> {
  try {
    const lock = await redis.set(REFRESH_LOCK_KEY, '1', 'EX', REFRESH_LOCK_TTL, 'NX');
    if (lock !== 'OK') return;
    // DISABLED 2026-07-03: the exact count(*) over ~220M products was routed to the
    // SEARCH replica (BUY-45692) and ran on startup + every 10min + every /stats request
    // (p95 monitors probe /stats continuously). Each 45s full scan evicted the search
    // working set from the 4GB shared_buffers -> /v1/products/search 504s even on warm
    // terms. reltuples + 0.1% TABLESAMPLE estimates are plenty for a stats endpoint.
    // tryExactCount() is retained but no longer called from the hot path.
    const stats = await collectStats();
    await redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL);
    console.log('[catalog/stats] background estimate refresh ok: %d products', stats.total_products);
  } catch (err) {
    console.warn('[catalog/stats] background refresh error:', (err as Error).message);
  }
}

// ─── Warm-up on server start ────────────────────────────────────────────
let warmupDone = false;
async function warmUpCache(): Promise<void> {
  if (warmupDone) return;
  warmupDone = true;
  console.log('[catalog/stats] warming cache with fast estimates…');
  const stats = await collectStats();
  await redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL);
  console.log('[catalog/stats] warm-up ok: %d products, %d merchants', stats.total_products, stats.total_merchants);
  triggerBackgroundRefresh().catch(() => {});
}
warmUpCache().catch(() => {});

// ─── Periodic refresh (every 10 min) ────────────────────────────────────
const PERIODIC_INTERVAL_MS = 10 * 60 * 1000;
const periodicTimer = setInterval(() => {
  triggerBackgroundRefresh().catch(() => {});
}, PERIODIC_INTERVAL_MS);
periodicTimer.unref();

// ─── GET /stats ─────────────────────────────────────────────────────────
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // 1. Try Redis cache first, but reject approximate cached values (BUY-74088)
    const cached = await redis.get(CACHE_KEY).catch(() => null);
    if (cached) {
      const stats: CatalogStatsResult = JSON.parse(cached);
      // 2026-08-26 (Richmond): approximate cached stats are acceptable by default. BUY-74088's
      // "force exact recount" made every call run count(*) over 365M rows on the search replica
      // (it never finished inside 25 s, so callers got the estimate anyway after a 25 s full scan).
      // Exact counts are opt-in via ?exact=1 (or POST /stats/refresh).
      if (!stats.approximate) {
        triggerBackgroundRefresh().catch(() => {});
        res.json({
          data: {
            total_products: stats.total_products,
            total_merchants: stats.total_merchants,
            active_products: stats.active_products,
          },
          meta: {
            approximate: false,
            source: stats.source,
            ts: stats.collected_at,
          },
        });
        return;
      }
      // Approximate cache is not acceptable for this endpoint; fall through to exact count
      console.warn('[catalog/stats] cached stats are approximate, forcing exact recount (BUY-74088)');
    }

    // 2. Try exact count first, but fall back to fast estimates if the live
    //    367 M-row table scan cannot complete within the SLA. BUY-74088 wanted
    //    exact counts, yet COUNT(*) times out under current IO load; serving an
    //    honest approximate response keeps the health endpoint and citations
    //    alive while the replica/exact path remains attempted.
    //
    // BUY-74513: 60000ms exceeded the 30s gateway read timeout on the replica,
    // making the request hang at the edge for a full minute before the fallback
    // fired — and silently serving a stale approximate total to /v1/products
    // callers for >5 heartbeats. Cap at 25000ms (25s with a 5s safety margin
    // below the 30s gateway) so the exact path either succeeds quickly or
    // fails fast enough for the route to surface the degraded envelope
    // (meta.approximate=true) rather than a 30s+ gateway timeout followed by
    // an opaque stale total.
    const exact = await collectExactSnapshot() || (_req.query.exact === '1' ? await tryExactCount(25000) : null);
    if (exact) {
      await redis.set(CACHE_KEY, JSON.stringify(exact), 'EX', CACHE_TTL).catch(() => {});
      triggerBackgroundRefresh().catch(() => {});
      res.json({
        data: {
          total_products: exact.total_products,
          total_merchants: exact.total_merchants,
          active_products: exact.active_products,
        },
        meta: {
          approximate: false,
          source: exact.source,
          ts: exact.collected_at,
        },
      });
      return;
    }

    // 3. Exact count failed — serve fast pg_class/TABLESAMPLE estimate instead
    //    of a 500. The response is explicitly marked approximate so callers can
    //    decide how much trust to place in it.
    console.warn('[catalog/stats] exact count failed, returning approximate stats (BUY-74205)');
    const stats = await collectStats();
    await redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL).catch(() => {});
    triggerBackgroundRefresh().catch(() => {});
    res.json({
      data: {
        total_products: stats.total_products,
        total_merchants: stats.total_merchants,
        active_products: stats.active_products,
      },
      meta: {
        approximate: stats.approximate,
        source: stats.source,
        ts: stats.collected_at,
      },
    });
    return;
  } catch (err) {
    console.error('[catalog/stats] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /stats/refresh — force refresh ────────────────────────────────
router.post('/stats/refresh', async (_req: Request, res: Response) => {
  try {
    await redis.del(CACHE_KEY).catch(() => {});
    await redis.del(REFRESH_LOCK_KEY).catch(() => {});

    const exact = await tryExactCount(25000);
    if (exact) {
      await redis.set(CACHE_KEY, JSON.stringify(exact), 'EX', CACHE_TTL);
      res.json({
        data: {
          total_products: exact.total_products,
          total_merchants: exact.total_merchants,
          active_products: exact.active_products,
        },
        meta: { approximate: false, source: CATALOG_STATS_SOURCE_EXACT, ts: exact.collected_at },
      });
      return;
    }

    const stats = await collectStats();
    await redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL);
    res.json({
      data: {
        total_products: stats.total_products,
        total_merchants: stats.total_merchants,
        active_products: stats.active_products,
      },
      meta: { approximate: true, source: stats.source, ts: stats.collected_at },
    });
  } catch (err) {
    console.error('[catalog/stats/refresh] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /stats/health — regression guard ───────────────────────────────
router.get('/stats/health', async (_req: Request, res: Response) => {
  try {
    const cached = await redis.get(CACHE_KEY).catch(() => null);
    if (!cached) {
      res.json({ status: 'no_cache' });
      return;
    }
    const stats: CatalogStatsResult = JSON.parse(cached);
    const ageMin = Math.round((Date.now() - new Date(stats.collected_at).getTime()) / 60000);

    let status = 'ok';
    if (stats.approximate && stats.active_products === stats.total_products && stats.total_products > 1000000) {
      status = 'regression';
    } else if (ageMin > 30) {
      status = 'stale';
    }

    res.json({
      status,
      total_products: stats.total_products,
      active_products: stats.active_products,
      total_merchants: stats.total_merchants,
      approximate: stats.approximate,
      source: stats.source,
      cached_at: stats.collected_at,
      cache_age_min: ageMin,
      active_ratio: stats.total_products > 0
        ? (stats.active_products / stats.total_products * 100).toFixed(2) + '%'
        : 'N/A',
      // BUY-45692: read-replica routing + lag visibility for ops.
      replica: replicaStatus(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: (err as Error).message });
  }
});

// ─── GET /categories (unchanged) ─────────────────────────────────────────
router.get('/categories', async (_req: Request, res: Response) => {
  const start = Date.now();
  try {
    const result = await catalogDb.query(
      `SELECT slug, name, product_count FROM mcp_category_summary ORDER BY product_count DESC LIMIT 50`
    );
    const categories = result.rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      product_count: parseInt(row.product_count, 10),
    }));
    res.json({
      data: categories,
      meta: { total: categories.length, source: 'mcp_category_summary', response_time_ms: Date.now() - start },
    });
  } catch (err) {
    console.error('[catalog/categories] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
