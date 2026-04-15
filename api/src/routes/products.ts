import { Router, Request, Response } from 'express';
import { db, redis } from '../config';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { agentDetectMiddleware } from '../middleware/agentDetect';
import { trackApiQuery } from '../analytics/posthog';

const SEARCH_CACHE_TTL_SECONDS = 60;

const router = Router();

// GET /v1/products/search
// Query params: q, domain, min_price, max_price, currency, limit, offset, source_page
router.get(
  '/search',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  async (req: Request, res: Response) => {
    const start = Date.now();

    const q = (req.query.q as string) || '';
    const domain = req.query.domain as string | undefined;
    const minPrice = req.query.min_price ? parseFloat(req.query.min_price as string) : undefined;
    const maxPrice = req.query.max_price ? parseFloat(req.query.max_price as string) : undefined;
    const currency = (req.query.currency as string) || 'SGD';
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
    const offset = parseInt((req.query.offset as string) || '0');
    const sourcePage = req.query.source_page as string | undefined;

    // Check Redis cache for this exact query (60s TTL)
    const cacheKey = `fts:${q}:${domain || ''}:${currency}:${minPrice ?? ''}:${maxPrice ?? ''}:${limit}:${offset}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        parsed.meta.cached = true;
        parsed.meta.response_time_ms = Date.now() - start;
        return res.json(parsed);
      }
    } catch (_) {
      // Redis miss or error — fall through to DB
    }

    const conditions: string[] = ['currency = $1'];
    const params: unknown[] = [currency];
    let idx = 2;
    let ftsParamIdx = 0;

    if (q) {
      // Use full-text search via GIN-indexed search_vector only.
      // The ILIKE fallback was removed: it defeats the GIN index and causes full table scans (3s vs 130ms).
      ftsParamIdx = idx;
      conditions.push(`search_vector @@ plainto_tsquery('english', $${idx})`);
      params.push(q);
      idx++;
    }
    if (domain) {
      // domain maps to platform in the products table
      conditions.push(`platform::text = $${idx}`);
      params.push(domain);
      idx++;
    }
    if (minPrice !== undefined) {
      conditions.push(`price >= $${idx}`);
      params.push(minPrice);
      idx++;
    }
    if (maxPrice !== undefined) {
      conditions.push(`price <= $${idx}`);
      params.push(maxPrice);
      idx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // Cap count at 1001: if result set > 1000 rows, ts_rank ordering over all matches is expensive
    // (500ms+ for broad queries like "apple iphone"). For large result sets, fall back to
    // updated_at DESC which uses the index and avoids full-scan rank computation.
    const COUNT_CAP = 1001;
    const countQuery = `SELECT COUNT(*) FROM (SELECT 1 FROM products ${whereClause} LIMIT ${COUNT_CAP}) _sub`;

    // Run count first (fast, capped) to decide ordering strategy, then fetch data
    const countResult = await db.query(countQuery, params.slice(0, idx - 1));
    const approxCount = parseInt(countResult.rows[0].count, 10);

    // For large result sets (>1000 rows), ORDER BY updated_at DESC with a direct GIN-filter
    // forces Postgres to scan the updated_at index backwards, skipping many non-matching rows.
    // Instead, use a candidate subquery: let the GIN index pick up to 500 candidates, then
    // sort those by recency. This keeps query time <10ms even for broad FTS terms.
    // For small result sets (<= 1000 rows), ts_rank gives more relevant ordering.
    const CANDIDATE_LIMIT = Math.max(500, (limit + offset) * 10);
    let dataQuery: string;
    if (ftsParamIdx && approxCount <= 1000) {
      // Small result set: ts_rank is fast and gives better relevance ordering
      dataQuery = `
        SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
               name AS title, price, currency, image_url, attributes AS metadata, updated_at
        FROM products
        ${whereClause}
        ORDER BY ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) DESC, updated_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    } else {
      // Large result set: subquery forces GIN index usage, outer sort is cheap
      dataQuery = `
        SELECT id, source_id, domain, url, title, price, currency, image_url, metadata, updated_at
        FROM (
          SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
                 name AS title, price, currency, image_url, attributes AS metadata, updated_at
          FROM products
          ${whereClause}
          LIMIT ${CANDIDATE_LIMIT}
        ) _candidates
        ORDER BY updated_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    }
    params.push(limit, offset);

    const dataResult = await db.query(dataQuery, params);

    const products = dataResult.rows.map((row) => ({
      id: row.id,
      source: row.source_id,
      domain: row.domain,
      url: row.url,
      title: row.title,
      price: row.price ? parseFloat(row.price) : null,
      currency: row.currency,
      image_url: row.image_url,
      metadata: row.metadata,
      updated_at: row.updated_at,
    }));

    const total = parseInt(countResult.rows[0].count, 10);
    const responseTimeMs = Date.now() - start;

    const responseBody = {
      data: products,
      meta: {
        total,
        limit,
        offset,
        response_time_ms: responseTimeMs,
        cached: false,
      },
    };

    // Cache result in Redis (fire-and-forget)
    redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => {});

    // Extract categories from results for analytics
    const categories = extractCategories(products);

    // PostHog event (fire-and-forget)
    if (req.apiKeyRecord) {
      trackApiQuery({
        apiKey: req.apiKeyRecord.key,
        agentFramework: req.agentInfo?.framework || 'unknown',
        agentVersion: req.agentInfo?.version || '',
        sdkLanguage: req.agentInfo?.sdkLanguage || 'unknown',
        queryIntent: inferQueryIntent(q, domain, minPrice, maxPrice),
        productCategories: categories,
        resultCount: products.length,
        responseTimeMs,
        signupChannel: req.apiKeyRecord.signupChannel,
        sourcePage: sourcePage || null,
        endpoint: 'products.search',
      });
    }

    res.json(responseBody);
  }
);

// GET /v1/products/deals
// Returns products on sale (original_price > price), sorted by discount %
router.get(
  '/deals',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  async (req: Request, res: Response) => {
    const start = Date.now();
    const currency = (req.query.currency as string) || 'SGD';
    const minDiscount = parseFloat((req.query.min_discount as string) || '10');
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
    const offset = parseInt((req.query.offset as string) || '0');

    const cacheKey = `deals:${currency}:${minDiscount}:${limit}:${offset}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        parsed.meta.cached = true;
        parsed.meta.response_time_ms = Date.now() - start;
        return res.json(parsed);
      }
    } catch (_) {}

    // Sanity cap: reject original_price > 10x price (likely scraped data corruption)
    const [countResult, dataResult] = await Promise.all([
      db.query(
        `SELECT COUNT(*) FROM products
         WHERE currency = $1 AND original_price > price AND original_price <= price * 10
           AND ((original_price - price) / original_price * 100) >= $2`,
        [currency, minDiscount]
      ),
      db.query(
        `SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
                name AS title, price, original_price, currency, image_url, attributes AS metadata, updated_at,
                ROUND(((original_price - price) / original_price * 100)::numeric, 1) AS discount_pct
         FROM products
         WHERE currency = $1 AND original_price > price AND original_price <= price * 10
           AND ((original_price - price) / original_price * 100) >= $2
         ORDER BY ((original_price - price) / original_price) DESC, updated_at DESC
         LIMIT $3 OFFSET $4`,
        [currency, minDiscount, limit, offset]
      ),
    ]);

    const deals = dataResult.rows.map((row) => ({
      id: row.id,
      source: row.source_id,
      domain: row.domain,
      url: row.url,
      title: row.title,
      price: row.price ? parseFloat(row.price) : null,
      original_price: row.original_price ? parseFloat(row.original_price) : null,
      discount_pct: row.discount_pct ? parseFloat(row.discount_pct) : null,
      currency: row.currency,
      image_url: row.image_url,
      metadata: row.metadata,
      updated_at: row.updated_at,
    }));

    const responseBody = {
      data: deals,
      meta: { total: parseInt(countResult.rows[0].count, 10), limit, offset, response_time_ms: Date.now() - start, cached: false },
    };
    redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => {});
    res.json(responseBody);
  }
);

// GET /v1/products/compare?ids=id1,id2,id3
router.get(
  '/compare',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  async (req: Request, res: Response) => {
    const start = Date.now();
    const ids = ((req.query.ids as string) || '').split(',').filter(Boolean).slice(0, 10);
    if (ids.length < 2) {
      res.status(400).json({ error: 'Provide at least 2 product IDs via ?ids=id1,id2' });
      return;
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await db.query(
      `SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
              name AS title, price, original_price, currency, image_url, attributes AS metadata,
              category_path, brand, rating, review_count, updated_at
       FROM products WHERE id IN (${placeholders})`,
      ids
    );

    const products = result.rows.map((row) => ({
      id: row.id,
      source: row.source_id,
      domain: row.domain,
      url: row.url,
      title: row.title,
      price: row.price ? parseFloat(row.price) : null,
      original_price: row.original_price ? parseFloat(row.original_price) : null,
      currency: row.currency,
      image_url: row.image_url,
      brand: row.brand,
      category_path: row.category_path,
      rating: row.rating ? parseFloat(row.rating) : null,
      review_count: row.review_count,
      metadata: row.metadata,
      updated_at: row.updated_at,
    }));

    res.json({ data: products, meta: { count: products.length, response_time_ms: Date.now() - start } });
  }
);

// GET /v1/products/:id/prices — price history from price_snapshots
router.get(
  '/:id/prices',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  async (req: Request, res: Response) => {
    const start = Date.now();
    const { id } = req.params;
    const days = Math.min(parseInt((req.query.days as string) || '30'), 90);

    const [productResult, historyResult] = await Promise.all([
      db.query(
        `SELECT id, name AS title, price, original_price, currency FROM products WHERE id = $1`,
        [id]
      ),
      db.query(
        `SELECT price, currency, scraped_at
         FROM price_snapshots
         WHERE product_id = $1 AND scraped_at >= NOW() - ($2 || ' days')::interval
         ORDER BY scraped_at ASC`,
        [id, days]
      ),
    ]);

    if (productResult.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const p = productResult.rows[0];
    const history = historyResult.rows.map((row) => ({
      price: parseFloat(row.price),
      currency: row.currency,
      at: row.scraped_at,
    }));

    const prices = history.map((h) => h.price);
    res.json({
      data: {
        product_id: p.id,
        title: p.title,
        current_price: p.price ? parseFloat(p.price) : null,
        original_price: p.original_price ? parseFloat(p.original_price) : null,
        currency: p.currency,
        history,
        stats: prices.length
          ? { min: Math.min(...prices), max: Math.max(...prices), avg: +(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2), data_points: prices.length }
          : null,
      },
      meta: { days, response_time_ms: Date.now() - start },
    });
  }
);

// GET /v1/products/:id
router.get(
  '/:id',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  async (req: Request, res: Response) => {
    const start = Date.now();
    const { id } = req.params;

    const result = await db.query(
      `SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
              name AS title, price, currency, image_url, attributes AS metadata, updated_at
       FROM products WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const row = result.rows[0];
    const product = {
      id: row.id,
      source: row.source_id,
      domain: row.domain,
      url: row.url,
      title: row.title,
      price: row.price ? parseFloat(row.price) : null,
      currency: row.currency,
      image_url: row.image_url,
      metadata: row.metadata,
      updated_at: row.updated_at,
    };

    if (req.apiKeyRecord) {
      trackApiQuery({
        apiKey: req.apiKeyRecord.key,
        agentFramework: req.agentInfo?.framework || 'unknown',
        agentVersion: req.agentInfo?.version || '',
        sdkLanguage: req.agentInfo?.sdkLanguage || 'unknown',
        queryIntent: 'lookup',
        productCategories: extractCategories([product]),
        resultCount: 1,
        responseTimeMs: Date.now() - start,
        signupChannel: req.apiKeyRecord.signupChannel,
        sourcePage: null,
        endpoint: 'products.get',
      });
    }

    res.json({ data: product });
  }
);

function inferQueryIntent(q: string, domain?: string, minPrice?: number, maxPrice?: number): string {
  const lower = q.toLowerCase();
  if (minPrice !== undefined && maxPrice !== undefined) return 'price_check';
  if (/\bvs\b|compare|comparison|difference/i.test(lower)) return 'comparison';
  if (/buy|purchase|order|checkout/i.test(lower)) return 'purchase_intent';
  if (q.length === 0 && domain) return 'bulk_catalog';
  if (q.length > 0) return 'discovery';
  return 'bulk_catalog';
}

function extractCategories(products: Array<{ domain?: string; metadata?: Record<string, unknown> | null }>): string[] {
  const cats = new Set<string>();
  for (const p of products) {
    if (p.domain) {
      const domain = p.domain.replace('.sg', '').replace('.com', '');
      cats.add(domain);
    }
    if (p.metadata && typeof p.metadata === 'object') {
      const meta = p.metadata as Record<string, unknown>;
      if (typeof meta['category'] === 'string') cats.add(meta['category']);
      if (typeof meta['sub_category'] === 'string') cats.add(meta['sub_category']);
    }
  }
  return Array.from(cats).slice(0, 10);
}

export default router;
