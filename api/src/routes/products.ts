import { Router, Request, Response } from 'express';
import { db, redis } from '../config';
import { requireApiKey, checkRateLimit, hashKey } from '../middleware/apiKey';
import { agentDetectMiddleware } from '../middleware/agentDetect';
import { trackApiQuery, trackProductSearch, trackProductView } from '../analytics/posthog';
import { queryLogMiddleware } from '../middleware/queryLog';
import { buildProduct, buildSearchResponse, COUNTRY_CURRENCY } from '../lib/response';
import { buildCompareProductsQuery, UUID_RE } from '../lib/compare-query';

const SEARCH_CACHE_TTL_SECONDS = 120;

// Express 4 doesn't catch async rejections — unhandled errors crash the process.
// This wrapper ensures all async route handlers return 500 instead of crashing.
function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error(`[products] unhandled error on ${req.method} ${req.path}:`, err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  };
}

const router = Router();

// GET /v1/products/search
// Query params: q, domain, region, country, category, category_id, category_path,
//               brand, merchant_id, availability, min_price, max_price,
//               currency, limit, offset, page, fields, sort, sort_by, source_page, compact
router.get(
  '/search',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.search'),
  asyncHandler(async (req: Request, res: Response) => {
    const requestStart = Date.now();
    const q = (req.query.q as string) || '';
    const domain = req.query.domain as string | undefined;
    const region = req.query.region as string | undefined;
    const category = req.query.category as string | undefined;
    const categoryId = req.query.category_id as string | undefined;
    const categoryPath = (req.query.category_path as string) ? (req.query.category_path as string).split(',').map(p => p.trim()).filter(Boolean) : undefined;
    const brand = req.query.brand as string | undefined;
    const merchantId = req.query.merchant_id as string | undefined;
    const availability = req.query.availability as string | undefined;
    const rawFields = (req.query.fields as string) || undefined;
    const fields = rawFields ? rawFields.split(',').map(f => f.trim()).filter(Boolean) : undefined;
    const sort = ((req.query.sort || req.query.sort_by) as string) || undefined;
    // country_code is the canonical param; `country` is kept as a backward-compat alias.
    // Default to SG when neither country nor region is specified (BUY-6598: prevent cross-region accessory pollution).
    const explicitCountry = ((req.query.country_code as string | undefined) || (req.query.country as string | undefined))?.toUpperCase() || undefined;
    const countryCode = explicitCountry || (region ? undefined : 'SG');
    const minPrice = req.query.min_price ? parseFloat(req.query.min_price as string) : undefined;
    const maxPrice = req.query.max_price ? parseFloat(req.query.max_price as string) : undefined;
    // Infer default currency from country_code when not explicitly provided.
    // Price filters (min_price/max_price) apply in this inferred currency.
    const currency = (req.query.currency as string) || (countryCode ? (COUNTRY_CURRENCY[countryCode] || 'SGD') : 'SGD');
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
    const rawPage = parseInt((req.query.page as string) || '0');
    const rawOffset = parseInt((req.query.offset as string) || '0');
    const offset = rawPage > 0 ? (rawPage - 1) * limit : rawOffset;
    const sourcePage = req.query.source_page as string | undefined;
    const compact = req.query.compact === 'true';

    // Check Redis cache for this exact query (60s TTL)
    const cacheKey = `fts:${q}:${domain || ''}:${region || ''}:${countryCode || ''}:${category || ''}:${categoryId || ''}:${categoryPath?.join(',') || ''}:${brand || ''}:${merchantId || ''}:${availability || ''}:${currency}:${minPrice ?? ''}:${maxPrice ?? ''}:${limit}:${offset}:${sort || ''}:${fields?.join(',') || ''}:${compact ? 'c' : 'f'}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        const elapsed = Date.now() - requestStart;
        parsed.cached = true;
        parsed.response_time_ms = elapsed;
        res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
        res.set('X-Cache', 'HIT');
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
      conditions.push(`source = $${idx}`);
      params.push(domain);
      idx++;
    }
    if (region) {
      conditions.push(`region = $${idx}`);
      params.push(region);
      idx++;
    }
    if (countryCode) {
      conditions.push(`country_code = $${idx}`);
      params.push(countryCode);
      idx++;
    }
    if (category) {
      conditions.push(`category ILIKE $${idx}`);
      params.push(`%${category}%`);
      idx++;
    }
    if (brand) {
      conditions.push(`brand ILIKE $${idx}`);
      params.push(`%${brand}%`);
      idx++;
    }
    if (availability) {
      const avail = availability.toLowerCase();
      if (avail === 'in_stock') {
        conditions.push(`(metadata->>'availability' = $${idx} OR (metadata->>'availability' IS NULL AND is_active = true))`);
        params.push(avail);
        idx++;
      } else if (avail === 'out_of_stock') {
        conditions.push(`(metadata->>'availability' = $${idx} OR (metadata->>'availability' IS NULL AND is_active = false))`);
        params.push(avail);
        idx++;
      } else if (avail === 'preorder' || avail === 'discontinued') {
        conditions.push(`metadata->>'availability' = $${idx}`);
        params.push(avail);
        idx++;
      }
    }
    if (categoryId) {
      conditions.push(`category_id = $${idx}`);
      params.push(categoryId);
      idx++;
    }
    if (categoryPath && categoryPath.length > 0) {
      const pathPlaceholders = categoryPath.map((_, i) => `$${idx + i}`).join(',');
      conditions.push(`category_path @> ARRAY[${pathPlaceholders}]::text[]`);
      params.push(...categoryPath);
      idx += categoryPath.length;
    }
    if (merchantId) {
      conditions.push(`merchant_id = $${idx}`);
      params.push(merchantId);
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

    // BUY-31302: raised from 8s — covers cold-cache GIN scan (~10s) until partial
    // country indexes are warmed. Partition routing (products_sg/products_us) means
    // warm-cache queries take 12-40ms; this timeout is just a safety net.
    const SEARCH_STATEMENT_TIMEOUT_MS = 20000;
    // Top-N candidates ranked by ts_rank before joining full rows.
    const CANDIDATE_CAP = 200;

    const specColumns = `created_at, description, brand, mpn, gtin, category_path, category, merchant_id, avg_rating, review_count`;
    const specColumnsJoined = `products.created_at, products.description, products.brand, products.mpn, products.gtin, products.category_path, products.category, products.merchant_id, products.avg_rating, products.review_count`;
    const joinedColumns = `products.id, products.sku AS source_id, products.source AS domain, products.url,
               al.destination_url AS affiliate_url,
               products.title, products.price, products.currency, products.image_url, products.metadata, products.updated_at,
               products.region, products.country_code, ${specColumnsJoined}`;

    const VALID_SORT = new Set(['relevance', 'price_asc', 'price_desc', 'newest', 'highest_rated', 'most_reviewed']);
    const effectiveSort = sort && VALID_SORT.has(sort) ? sort : undefined;
    const useFtsRanking = (!effectiveSort || effectiveSort === 'relevance') && ftsParamIdx;

    function buildSortOrder(): string {
      if (!effectiveSort || effectiveSort === 'relevance') return 'products.updated_at DESC';
      switch (effectiveSort) {
        case 'price_asc': return 'products.price ASC, products.updated_at DESC';
        case 'price_desc': return 'products.price DESC, products.updated_at DESC';
        case 'newest': return 'products.updated_at DESC';
        case 'highest_rated': return 'products.avg_rating DESC NULLS LAST, products.updated_at DESC';
        case 'most_reviewed': return 'products.review_count DESC NULLS LAST, products.updated_at DESC';
        default: return 'products.updated_at DESC';
      }
    }

    // BUY-31302: fix broken search from BUY-28677 (countParams/dataParams/buildDataQuery were
    // never defined, causing ReferenceError → 100% 500 rate).
    // Use LIMIT-pushdown CTE: rank top CANDIDATE_CAP IDs via GIN index, join full rows for
    // only those. Eliminates the separate COUNT query that doubled DB load. Over-fetch by 1
    // to derive has_more without a second scan.
    let dataResult: { rows: Array<Record<string, unknown>> };
    let total: number;
    let hasMore: boolean;

    const dataParams = [...params, limit + 1, offset];

    let dataQuery: string;
    if (useFtsRanking) {
      dataQuery = `
        WITH top_ids AS (
          SELECT id, ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) AS rank
          FROM products
          ${whereClause}
          ORDER BY rank DESC
          LIMIT ${CANDIDATE_CAP}
        )
        SELECT ${joinedColumns}, top_ids.rank AS _fts_rank
        FROM top_ids
        JOIN products ON products.id = top_ids.id
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ORDER BY top_ids.rank DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    } else {
      dataQuery = `
        SELECT ${joinedColumns}
        FROM products
        LEFT JOIN affiliate_links al ON al.product_id = products.id::text AND al.merchant_id = products.merchant_id
        ${whereClause}
        ORDER BY ${buildSortOrder()}
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '${SEARCH_STATEMENT_TIMEOUT_MS}'`);
      dataResult = await client.query(dataQuery, dataParams);
      await client.query('COMMIT');
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      const pgErr = err as { code?: string };
      if (pgErr.code === '57014') {
        client.release();
        res.status(503).json({ error: 'Search query timed out', timeout_ms: SEARCH_STATEMENT_TIMEOUT_MS });
        return;
      }
      client.release();
      throw err;
    }
    client.release();

    hasMore = dataResult.rows.length > limit;
    if (hasMore) dataResult.rows.pop();
    total = offset + dataResult.rows.length + (hasMore ? 1 : 0);

    const responseTimeMs = Date.now() - requestStart;

    const products = dataResult.rows.map((row) =>
      buildProduct(row as Record<string, unknown>, currency, compact)
    );

    // Apply field selection if `fields` param is specified
    let filteredProducts = products;
    if (fields && fields.length > 0) {
      const VALID_FIELDS = new Set([
        'id', 'name', 'price', 'url', 'merchant', 'category', 'country',
        'ingested_at', 'updated_at', 'description', 'image_url', 'images',
        'brand', 'sku', 'mpn', 'gtin', 'availability', 'compare_at_price',
        'rating', 'title', 'country_code', 'region',
        'canonical_id', 'normalized_price_usd', 'structured_specs',
        'comparison_attributes', 'metadata', 'original_price', 'discount_pct',
      ]);
      const requested = fields.filter(f => VALID_FIELDS.has(f));
      if (requested.length > 0) {
        filteredProducts = products.map(p => {
          const picked: Record<string, unknown> = {};
          for (const f of requested) {
            if (f in (p as unknown as Record<string, unknown>)) {
              picked[f] = (p as unknown as Record<string, unknown>)[f];
            }
          }
          return picked as unknown as typeof p;
        });
      }
    }

    const responseBody = buildSearchResponse(
      filteredProducts, total, limit, offset, responseTimeMs, hasMore
    );

    // Cache result in Redis (fire-and-forget)
    redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => {});

    // Extract categories from results for analytics
    const categories = extractCategories(products);

    // PostHog event (fire-and-forget)
    if (req.apiKeyRecord) {
      trackApiQuery({
        apiKey: hashKey(req.apiKeyRecord.key),
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
      trackProductSearch({
        apiKey: hashKey(req.apiKeyRecord.key),
        queryText: q,
        resultCount: products.length,
        responseTimeMs,
      });
    }

    res.json(responseBody);
  })
);

// GET /v1/products/deals
// Returns products on sale (original_price > price), sorted by discount %
router.get(
  '/deals',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.deals'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const currency = (req.query.currency as string) || 'SGD';
    const countryCode = ((req.query.country_code as string | undefined) || (req.query.country as string | undefined))?.toUpperCase() || undefined;
    const minDiscount = parseFloat((req.query.min_discount as string) || '10');
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
    const offset = parseInt((req.query.offset as string) || '0');

    const cacheKey = `deals:${currency}:${countryCode || ''}:${minDiscount}:${limit}:${offset}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        parsed.cached = true;
        parsed.response_time_ms = Date.now() - start;
        return res.json(parsed);
      }
    } catch (_) {}

    // Deals: prefer discount_pct generated column (BUY-14332), fall back to inline
    // computation if the column doesn't exist yet (migration may not have run).
    const dealConditions: string[] = ['currency = $1', 'price > 0'];
    const dealParams: unknown[] = [currency];
    let dealIdx = 2;
    let useDiscountCol = true;

    // Probe whether discount_pct column exists as GENERATED (cached per-process)
    // BUY-22324: must verify is_generated = 'ALWAYS'; a plain column is 100% NULL
    // and produces wrong results (get_deals returns total: 0).
    if (typeof (router as any)._hasDiscountPct === 'undefined') {
      try {
        const probe = await db.query(
          `SELECT is_generated FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'discount_pct' LIMIT 1`
        );
        (router as any)._hasDiscountPct = probe.rows.length > 0 && probe.rows[0].is_generated === 'ALWAYS';
      } catch {
        (router as any)._hasDiscountPct = false;
      }
    }
    useDiscountCol = (router as any)._hasDiscountPct;

    if (useDiscountCol) {
      dealConditions.push(`discount_pct >= $${dealIdx}`);
    } else {
      dealConditions.push(`(metadata->>'original_price')::numeric > price`);
      dealConditions.push(`((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100) >= $${dealIdx}`);
    }
    dealParams.push(minDiscount);
    dealIdx++;

    if (countryCode) {
      dealConditions.push(`country_code = $${dealIdx}`);
      dealParams.push(countryCode);
      dealIdx++;
    }

    const dealWhere = dealConditions.join(' AND ');

    const discountSelect = useDiscountCol
      ? 'discount_pct'
      : `ROUND(((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)::numeric, 1) AS discount_pct`;
    const discountOrder = useDiscountCol
      ? 'discount_pct DESC'
      : `(1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) DESC`;

    const COUNT_CAP = 1001;
    const [countResult, dataResult] = await Promise.all([
      db.query(
        `SELECT COUNT(*) FROM (SELECT 1 FROM products WHERE ${dealWhere} LIMIT ${COUNT_CAP}) _sub`,
        dealParams
      ),
      db.query(
        `SELECT id, sku AS source_id, source AS domain, url,
                title, price, (metadata->>'original_price')::numeric AS original_price,
                currency, image_url, metadata, updated_at,
                region, country_code, created_at, description, brand, mpn, gtin,
                category_path, category, merchant_id, avg_rating, review_count,
                ${discountSelect}
         FROM products
         WHERE ${dealWhere}
         ORDER BY ${discountOrder}, updated_at DESC
         LIMIT $${dealIdx} OFFSET $${dealIdx + 1}`,
        [...dealParams, limit, offset]
      ),
    ]);

    const deals = dataResult.rows.map((row) =>
      buildProduct(row as Record<string, unknown>, currency, false)
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const responseBody = buildSearchResponse(deals, total, limit, offset, Date.now() - start, false);
    redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => {});
    res.json(responseBody);
  })
);

// GET /v1/products/compare?ids=id1,id2,id3
router.get(
  '/compare',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.compare'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const ids = ((req.query.ids as string) || '').split(',').filter(Boolean).slice(0, 10);
    if (ids.length < 2) {
      res.status(400).json({ error: 'Provide at least 2 product IDs via ?ids=id1,id2' });
      return;
    }

    const invalidIds = ids.filter((id) => !UUID_RE.test(id.trim()));
    if (invalidIds.length > 0) {
      res.status(400).json({ error: `Invalid product ID(s): ${invalidIds.join(', ')}` });
      return;
    }

    const { text, values } = buildCompareProductsQuery(ids);
    const result = await db.query(text, values);

    const products = result.rows.map((row) =>
      buildProduct(row as Record<string, unknown>, 'SGD', false)
    );

    const uniqueCurrencies = [...new Set(products.map((p) => p.price.currency).filter(Boolean))];
    const currenciesMixed = uniqueCurrencies.length > 1;

    const responseBody = buildSearchResponse(products, products.length, ids.length, 0, Date.now() - start, false);
    res.json({
      ...responseBody,
      currencies_mixed: currenciesMixed,
      ...(currenciesMixed && {
        currency_warning: `Products span multiple currencies (${uniqueCurrencies.join(', ')}). Prices are not comparable across currencies — do not aggregate or rank by price in comparison_summary.`,
      }),
    });
  })
);

// GET /v1/products/:id/price-history — daily aggregated price history (BUY-2345)
// Query params: days (30|90|180, default 30)
router.get(
  '/:id/price-history',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.price-history'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const { id } = req.params;
    const days = Math.min(parseInt((req.query.days as string) || '30'), 180);

    const [productResult, historyResult] = await Promise.all([
      db.query(`SELECT id, title, price, currency FROM products WHERE id = $1`, [id]),
      db.query(
        `SELECT
           DATE(recorded_at AT TIME ZONE 'UTC') AS day,
           currency,
           MIN(price)::float AS min_price,
           MAX(price)::float AS max_price,
           ROUND(AVG(price)::numeric, 2)::float AS avg_price,
           COUNT(*) AS data_points
         FROM price_history
         WHERE product_id = $1
           AND recorded_at >= NOW() - ($2 || ' days')::interval
         GROUP BY DATE(recorded_at AT TIME ZONE 'UTC'), currency
         ORDER BY day ASC`,
        [id, days]
      ),
    ]);

    if (productResult.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const p = productResult.rows[0];
    const daily = historyResult.rows.map((row) => ({
      day: row.day,
      currency: row.currency,
      min: row.min_price,
      max: row.max_price,
      avg: row.avg_price,
      data_points: parseInt(row.data_points, 10),
    }));

    const allPrices = daily.length
      ? { min: Math.min(...daily.map((d) => d.min)), max: Math.max(...daily.map((d) => d.max)), avg: +(daily.reduce((a, d) => a + d.avg, 0) / daily.length).toFixed(2) }
      : null;

    res.json({
      data: {
        product_id: p.id,
        title: p.title,
        current_price: p.price ? parseFloat(p.price) : null,
        currency: p.currency,
        daily,
        stats: allPrices,
      },
      meta: { days, response_time_ms: Date.now() - start },
    });
  })
);

// GET /v1/products/:id/prices — price history from price_snapshots
router.get(
  '/:id/prices',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.prices'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const { id } = req.params;
    const days = Math.min(parseInt((req.query.days as string) || '30'), 90);

    const [productResult, historyResult] = await Promise.all([
      db.query(
        `SELECT id, title, price, currency FROM products WHERE id = $1`,
        [id]
      ),
      db.query(
        `SELECT price, currency, recorded_at AS scraped_at
         FROM price_history
         WHERE product_id = $1 AND recorded_at >= NOW() - ($2 || ' days')::interval
         ORDER BY recorded_at ASC`,
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
        currency: p.currency,
        history,
        stats: prices.length
          ? { min: Math.min(...prices), max: Math.max(...prices), avg: +(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2), data_points: prices.length }
          : null,
      },
      meta: { days, response_time_ms: Date.now() - start },
    });
  })
);

// GET /v1/products/:id/similar — return up to 8 similar products for 'related products' widget
// Strategy: same brand+category first (fast index lookup), then FTS title fallback to pad to 8.
// Target: <50ms p99 — both paths use GIN/B-tree indexes only.
router.get(
  '/:id/similar',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.similar'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const { id } = req.params;
    const limit = Math.min(parseInt((req.query.limit as string) || '8'), 20);

    // Fetch the source product
    const srcResult = await db.query(
      `SELECT id, title, brand, category_path, currency, country_code, search_vector
       FROM products WHERE id = $1`,
      [id]
    );
    if (srcResult.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    const src = srcResult.rows[0];
    const currency = src.currency || 'SGD';
    const sourceCountry = src.country_code || null;

    // Phase 1: same brand + same first category element (indexed columns)
    const brand = src.brand || null;
    const topCategory = src.category_path?.[0] || null;

    let similar: unknown[] = [];

    if (brand && topCategory) {
      const brandCatParams: unknown[] = [id, brand, topCategory, currency];
      let brandCatWhere = `id != $1 AND brand = $2 AND category_path[1] = $3 AND currency = $4`;
      if (sourceCountry) {
        brandCatWhere += ` AND country_code = $5`;
        brandCatParams.push(sourceCountry);
      }
      brandCatParams.push(limit);
      const brandCatResult = await db.query(
        `SELECT id, sku AS source_id, source AS domain, url, title, price, currency,
                image_url, brand, category_path, region, country_code
         FROM products
         WHERE ${brandCatWhere}
         ORDER BY updated_at DESC
         LIMIT $${brandCatParams.length}`,
        brandCatParams
      );
      similar = brandCatResult.rows;
    }

    // Phase 2: FTS on title to pad remaining slots (if < limit results so far)
    if (similar.length < limit && src.title) {
      const needed = limit - similar.length;
      const existingIds = [id, ...(similar as Array<{ id: string }>).map((r) => r.id)];
      const placeholders = existingIds.map((_, i) => `$${i + 1}`).join(',');
      let ftsIdx = existingIds.length + 1;
      let ftsWhere = `id NOT IN (${placeholders}) AND currency = $${ftsIdx}`;
      const ftsParams: unknown[] = [...existingIds, currency];
      ftsIdx++;
      ftsWhere += ` AND search_vector @@ plainto_tsquery('english', $${ftsIdx})`;
      ftsParams.push(src.title);
      ftsIdx++;
      if (sourceCountry) {
        ftsWhere += ` AND country_code = $${ftsIdx}`;
        ftsParams.push(sourceCountry);
        ftsIdx++;
      }
      ftsParams.push(needed);
      const ftsResult = await db.query(
        `SELECT id, sku AS source_id, source AS domain, url, title, price, currency,
                image_url, brand, category_path, region, country_code
         FROM products
         WHERE ${ftsWhere}
         ORDER BY ts_rank(search_vector, plainto_tsquery('english', $${existingIds.length + 2})) DESC,
                  updated_at DESC
         LIMIT $${ftsParams.length}`,
        ftsParams
      );
      similar = [...similar, ...ftsResult.rows];
    }

    const data = (similar as Array<Record<string, unknown>>).map((row) => ({
      id: row.id,
      source: row.source_id,
      domain: row.domain,
      url: row.url,
      title: row.title,
      price: row.price ? parseFloat(row.price as string) : null,
      currency: row.currency,
      image_url: row.image_url || null,
      brand: row.brand || null,
      category_path: row.category_path || null,
      region: row.region || null,
      country_code: row.country_code || null,
    }));

    res.json({ data, meta: { source_id: id, count: data.length, response_time_ms: Date.now() - start } });
  })
);

// GET /v1/products/:id
router.get(
  '/:id',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('products.get'),
  asyncHandler(async (req: Request, res: Response) => {
    const start = Date.now();
    const { id } = req.params;

    let result;
    try {
      result = await db.query(
        `SELECT id, sku AS source_id, source AS domain, url,
                title, price, currency, image_url, metadata, updated_at,
                region, country_code, created_at, description, brand, mpn, gtin,
                category_path, category, merchant_id, avg_rating, review_count
         FROM products WHERE id = $1`,
        [id]
      );
    } catch (err: unknown) {
      console.error('[products/:id] db query error:', err);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const row = result.rows[0];
    const product = buildProduct(row as Record<string, unknown>, 'SGD', false);

    if (req.apiKeyRecord) {
      trackApiQuery({
        apiKey: hashKey(req.apiKeyRecord.key),
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
      trackProductView({
        apiKey: hashKey(req.apiKeyRecord.key),
        productId: row.id,
        retailer: row.domain,
        category: (Array.isArray(row.category_path) ? row.category_path[0] : (typeof row.category_path === 'string' ? row.category_path.split(' > ')[0] : null)) as string | null,
      });
    }

    const responseBody = buildSearchResponse([product], 1, 1, 0, Date.now() - start, false);
    res.json(responseBody);
  })
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
  asyncHandler(async (req: Request, res: Response) => {
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
      'amazon_sg','amazon_uk','amazon_us','asos','audiohouse','bestdenki','books_com_tw','bukalapak',
      'carousell','castlery','challenger','coldstorage','coupang','courts',
      'decathlon','ezbuy','fairprice','flipkart','fortytwo','gaincity','giant',
      'guardian','harvey_norman','hengfohtong','hipvan','iherb','ikea','ishopchangi','kohepets',
      'lazada','lovebonito','maybelline','merchant_direct','metro','mothercare','motherswork',
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
      gtin?: string; mpn?: string;
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
        currency: p.currency || (p.country_code ? COUNTRY_CURRENCY[(p.country_code as string).toUpperCase()] : null) || (p.countryCode ? COUNTRY_CURRENCY[(p.countryCode as string).toUpperCase()] : null) || 'SGD',
        gtin: p.gtin ? String(p.gtin).slice(0, 14) : undefined,
        mpn: p.mpn ? String(p.mpn).slice(0, 100) : undefined,
        productUrl: p.product_url || p.productUrl,
        merchantId: p.merchant_id || p.merchantId || p.platform,
        merchantName: p.merchant_name || p.merchantName || p.platform,
        originalPrice: p.original_price || p.originalPrice
          ? (() => {
              const op = parseFloat(p.original_price || p.originalPrice);
              const cp = parseFloat(p.price);
              return !isNaN(op) && !isNaN(cp) && op > cp && op <= cp * 10 ? op : undefined;
            })()
          : undefined,
        brand: p.brand ? String(p.brand).slice(0, 200) : undefined,
        description: p.description ? String(p.description).slice(0, 5000) : undefined,
        imageUrl: p.image_url || p.imageUrl || undefined,
        images: Array.isArray(p.images) ? p.images.slice(0, 20) : undefined,
        categoryPath: Array.isArray(p.category_path || p.categoryPath)
          ? (p.category_path || p.categoryPath).slice(0, 10)
          : ['Uncategorized'],
        availability: p.availability || 'in_stock',
        region: p.region || undefined,
        countryCode: p.country_code || p.countryCode || undefined,
      });
    }

    if (rows.length === 0) {
      res.status(400).json({ error: 'No valid products', validation_errors: errors });
      return;
    }

    // Auto-create merchant records for any new merchant IDs (BUY-8788)
    const uniqueMerchants = new Map<string, { name: string; source: string; country: string }>();
    for (const r of rows) {
      if (!uniqueMerchants.has(r.merchantId)) {
        uniqueMerchants.set(r.merchantId, {
          name: r.merchantName,
          source: r.platform,
          country: r.countryCode || 'SG',
        });
      }
    }
    for (const [mid, info] of uniqueMerchants) {
      await db.query(
        `INSERT INTO merchants (id, name, source, country, is_active, onboarding_stage)
         VALUES ($1, $2, $3, $4, true, 'active')
         ON CONFLICT (id) DO NOTHING`,
        [mid, info.name, info.source, info.country]
      ).catch(() => {});
    }

    let inserted = 0;
    let updated = 0;

    for (const r of rows) {
      const result = await db.query(
        `INSERT INTO products
           (sku, source, merchant_id, title, description, price, currency, url,
            image_url, category_path, brand, metadata, is_active, region, country_code, gtin, mpn,
            search_vector)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15,$16,
                 to_tsvector('english',
                   COALESCE($4,'') || ' ' ||
                   COALESCE($11,'') || ' ' ||
                   COALESCE(array_to_string($10::text[],' '),'')
                 ))
         ON CONFLICT (sku, source)
         DO UPDATE SET
           title = EXCLUDED.title,
           price = EXCLUDED.price,
           currency = EXCLUDED.currency,
           image_url = EXCLUDED.image_url,
           metadata = products.metadata || EXCLUDED.metadata,
           region = COALESCE(EXCLUDED.region, products.region),
           country_code = COALESCE(EXCLUDED.country_code, products.country_code),
           gtin = COALESCE(EXCLUDED.gtin, products.gtin),
           mpn = COALESCE(EXCLUDED.mpn, products.mpn),
           search_vector = to_tsvector('english',
             COALESCE(EXCLUDED.title,'') || ' ' ||
             COALESCE(EXCLUDED.brand,'') || ' ' ||
             COALESCE(array_to_string(EXCLUDED.category_path,' '),'')
           ),
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [
          r.sku, r.platform, r.merchantId, r.name, r.description || null,
          r.price, r.currency, r.productUrl, r.imageUrl || null,
          r.categoryPath.length ? `{${r.categoryPath.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}` : '{}',
          r.brand || null,
          JSON.stringify({ original_price: r.originalPrice, merchant_name: r.merchantName, availability: r.availability }),
          r.region || null, r.countryCode || null,
          r.gtin || null, r.mpn || null,
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
  })
);

function extractCategories(products: Array<{ domain?: string; merchant?: string | { id: string; name: string | null; domain: string }; metadata?: Record<string, unknown> | null }>): string[] {
  const cats = new Set<string>();
  for (const p of products) {
    const source = p.domain || (typeof p.merchant === 'object' ? p.merchant?.domain : p.merchant) || '';
    if (source) {
      const domainName = source.replace('.sg', '').replace('.com', '');
      cats.add(domainName);
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
