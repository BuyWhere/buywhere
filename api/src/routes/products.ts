import { Router, Request, Response } from 'express';
import { db, redis } from '../config';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { agentDetectMiddleware } from '../middleware/agentDetect';
import { trackApiQuery } from '../analytics/posthog';
import { queryLogMiddleware } from '../middleware/queryLog';

const SEARCH_CACHE_TTL_SECONDS = 60;

const router = Router();

// GET /v1/products/search
// Query params: q, domain, region, country, min_price, max_price, currency, limit, offset, source_page
router.get(
  '/search',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.search'),
  async (req: Request, res: Response) => {
    const start = Date.now();

    const q = (req.query.q as string) || '';
    const domain = req.query.domain as string | undefined;
    const region = req.query.region as string | undefined;
    const country = req.query.country as string | undefined;
    const minPrice = req.query.min_price ? parseFloat(req.query.min_price as string) : undefined;
    const maxPrice = req.query.max_price ? parseFloat(req.query.max_price as string) : undefined;
    const currency = (req.query.currency as string) || 'SGD';
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
    const offset = parseInt((req.query.offset as string) || '0');
    const sourcePage = req.query.source_page as string | undefined;

    // Check Redis cache for this exact query (60s TTL)
    const cacheKey = `fts:${q}:${domain || ''}:${region || ''}:${country || ''}:${currency}:${minPrice ?? ''}:${maxPrice ?? ''}:${limit}:${offset}`;
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
    if (region) {
      conditions.push(`region = $${idx}`);
      params.push(region);
      idx++;
    }
    if (country) {
      conditions.push(`country_code = $${idx}`);
      params.push(country.toUpperCase());
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

    // For large result sets (>1000 rows), computing ts_rank over all matches is expensive.
    // Instead, let the GIN index fetch up to CANDIDATE_LIMIT rows, rank those by ts_rank,
    // then return the top N. This gives relevance ordering at a fraction of the cost.
    // For small result sets (<= 1000 rows), ts_rank over all matches is fast.
    const CANDIDATE_LIMIT = Math.max(500, (limit + offset) * 10);
    let dataQuery: string;
    if (ftsParamIdx && approxCount <= 1000) {
      // Small result set: ts_rank over all matches is fast, gives best relevance
      dataQuery = `
        SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
               name AS title, price, currency, image_url, attributes AS metadata, updated_at,
               region, country_code
        FROM products
        ${whereClause}
        ORDER BY ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) DESC, updated_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    } else if (ftsParamIdx) {
      // Large result set: GIN index fetches CANDIDATE_LIMIT rows using bitmap scan, then ranks.
      // No ORDER BY in the inner query — this lets PostgreSQL stop the heap scan after
      // CANDIDATE_LIMIT rows (vs scanning all 25k+ matching rows to sort by rank first).
      // 12x faster for broad queries (14ms vs 170ms for "headphones" on 2M product corpus).
      dataQuery = `
        SELECT id, source_id, domain, url, title, price, currency, image_url, metadata, updated_at, region, country_code
        FROM (
          SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
                 name AS title, price, currency, image_url, attributes AS metadata, updated_at,
                 region, country_code,
                 ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) AS rank
          FROM products
          ${whereClause}
          LIMIT ${CANDIDATE_LIMIT}
        ) _candidates
        ORDER BY rank DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    } else {
      // No FTS query (e.g. filter-only) — sort by recency
      dataQuery = `
        SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
               name AS title, price, currency, image_url, attributes AS metadata, updated_at,
               region, country_code
        FROM products
        ${whereClause}
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
      region: row.region || null,
      country_code: row.country_code || null,
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
  queryLogMiddleware('products.deals'),
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
                region, country_code,
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
      region: row.region || null,
      country_code: row.country_code || null,
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
  queryLogMiddleware('products.compare'),
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
              category_path, brand, rating, review_count, updated_at, region, country_code
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
      region: row.region || null,
      country_code: row.country_code || null,
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
  queryLogMiddleware('products.prices'),
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
  queryLogMiddleware('products.get'),
  async (req: Request, res: Response) => {
    const start = Date.now();
    const { id } = req.params;

    const result = await db.query(
      `SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
              name AS title, price, currency, image_url, attributes AS metadata, updated_at,
              region, country_code
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
      region: row.region || null,
      country_code: row.country_code || null,
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

// POST /v1/products/ingest
// Bulk ingest products from scraper agents. Requires API key auth.
// Upserts on (platform, platform_id) — safe to re-run.
router.post(
  '/ingest',
  requireApiKey,
  async (req: Request, res: Response) => {
    const start = Date.now();
    const items = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Body must be a non-empty array of products' });
      return;
    }

    if (items.length > 500) {
      res.status(400).json({ error: 'Maximum 500 products per request' });
      return;
    }

    const VALID_PLATFORMS = new Set([
      'amazon_sg','asos','audiohouse','bestdenki','books_com_tw','bukalapak',
      'carousell','castlery','challenger','coldstorage','coupang','courts',
      'decathlon','ezbuy','fairprice','flipkart','fortytwo','gaincity','giant',
      'guardian','harvey_norman','hipvan','iherb','ikea','ishopchangi','kohepets',
      'lazada','lovebonito','maybelline','merchant_direct','metro','mothercare',
      'mustafa','myntra','nike','petloverscentre','popular','qoo10','rakuten',
      'redmart','robinsons','sasa','sephora','shein','shengsiong','shopee',
      'stereo','tangs','tiki','tokopedia','toysrus','uniqlo','vuori','watsons','zalora',
    ]);

    const rows: Array<{
      id: string; platform: string; platformId: string; sku: string; name: string;
      price: number; currency: string; productUrl: string; merchantId: string;
      merchantName: string; originalPrice?: number; brand?: string;
      description?: string; imageUrl?: string; images?: string[];
      categoryPath: string[]; availability: string;
      region?: string; countryCode?: string;
    }> = [];

    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p || typeof p !== 'object') { errors.push(`[${i}] not an object`); continue; }
      if (!p.platform || !VALID_PLATFORMS.has(p.platform)) { errors.push(`[${i}] invalid or missing platform`); continue; }
      if (!p.name || typeof p.name !== 'string') { errors.push(`[${i}] missing name`); continue; }
      if (!p.price || isNaN(parseFloat(p.price))) { errors.push(`[${i}] missing or invalid price`); continue; }
      if (!p.product_url && !p.productUrl) { errors.push(`[${i}] missing product_url`); continue; }

      const platformId = p.platform_id || p.platformId || p.product_id || p.id || '';
      const sku = p.sku || platformId || `${p.platform}-${i}`;

      rows.push({
        id: require('crypto').randomUUID(),
        platform: p.platform,
        platformId,
        sku,
        name: String(p.name).slice(0, 1000),
        price: parseFloat(p.price),
        currency: p.currency || 'SGD',
        productUrl: p.product_url || p.productUrl,
        merchantId: p.merchant_id || p.merchantId || p.platform,
        merchantName: p.merchant_name || p.merchantName || p.platform,
        originalPrice: p.original_price || p.originalPrice ? parseFloat(p.original_price || p.originalPrice) : undefined,
        brand: p.brand ? String(p.brand).slice(0, 200) : undefined,
        description: p.description ? String(p.description).slice(0, 5000) : undefined,
        imageUrl: p.image_url || p.imageUrl || undefined,
        images: Array.isArray(p.images) ? p.images.slice(0, 20) : undefined,
        categoryPath: Array.isArray(p.category_path || p.categoryPath)
          ? (p.category_path || p.categoryPath).slice(0, 10)
          : [],
        availability: p.availability || 'in_stock',
        region: p.region || undefined,
        countryCode: p.country_code || p.countryCode || undefined,
      });
    }

    if (rows.length === 0) {
      res.status(400).json({ error: 'No valid products', validation_errors: errors });
      return;
    }

    let inserted = 0;
    let updated = 0;

    for (const r of rows) {
      const result = await db.query(
        `INSERT INTO products
           (id, platform, platform_id, sku, name, price, currency, product_url,
            merchant_id, merchant_name, original_price, brand, description,
            image_url, images, category_path, availability, is_deal, indexed_at, updated_at,
            region, country_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,false,NOW(),NOW(),$18,$19)
         ON CONFLICT (platform, sku)
         DO UPDATE SET
           name = EXCLUDED.name,
           price = EXCLUDED.price,
           original_price = EXCLUDED.original_price,
           image_url = EXCLUDED.image_url,
           images = EXCLUDED.images,
           availability = EXCLUDED.availability,
           region = COALESCE(EXCLUDED.region, products.region),
           country_code = COALESCE(EXCLUDED.country_code, products.country_code),
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [
          r.id, r.platform, r.platformId || null, r.sku, r.name, r.price, r.currency,
          r.productUrl, r.merchantId, r.merchantName, r.originalPrice || null,
          r.brand || null, r.description || null, r.imageUrl || null,
          r.images ? `{${r.images.map(u => `"${u.replace(/"/g, '\\"')}"`).join(',')}}` : null,
          r.categoryPath.length ? `{${r.categoryPath.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}` : '{}',
          r.availability,
          r.region || null, r.countryCode || null,
        ]
      ).catch(() => null);

      if (result && result.rows[0]) {
        if (result.rows[0].is_insert) inserted++; else updated++;
      }
    }

    res.status(207).json({
      accepted: rows.length,
      inserted,
      updated,
      skipped: items.length - rows.length,
      validation_errors: errors.length > 0 ? errors : undefined,
      duration_ms: Date.now() - start,
    });
  }
);

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
