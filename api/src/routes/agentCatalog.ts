import { Router, Request, Response } from 'express';
import { db, redis } from '../config';
import { requireApiKey, checkRateLimit, hashKey } from '../middleware/apiKey';
import { trackApiQuery } from '../analytics/posthog';
import { queryLogMiddleware } from '../middleware/queryLog';

const SEARCH_CACHE_TTL_SECONDS = 60;
const VALID_SORT_KEYS = ['relevance', 'price_asc', 'price_desc', 'rating', 'newest', 'popularity'] as const;
type SortKey = typeof VALID_SORT_KEYS[number];
const VALID_CURRENCIES = ['SGD', 'USD', 'MYR', 'THB', 'VND', 'IDR', 'PHP'];

const router = Router();

interface FacetBucket {
  value: string;
  count: number;
  min?: number | null;
  max?: number | null;
}

function buildWhereClause(params: {
  q?: string;
  category?: string;
  min_price?: number;
  max_price?: number;
  currency?: string;
  brand?: string;
  merchant?: string;
  in_stock?: boolean;
  on_sale?: boolean;
  min_rating?: number;
  has_image?: boolean;
  free_shipping?: boolean;
}): { conditions: string[]; sqlParams: unknown[]; ftsParamIdx: number } {
  const conditions: string[] = [];
  const sqlParams: unknown[] = [];
  let idx = 1;
  let ftsParamIdx = 0;

  if (params.q) {
    ftsParamIdx = idx;
    conditions.push(`name % $${idx}`);
    sqlParams.push(params.q);
    idx++;
  }
  if (params.category) {
    conditions.push(`category_path @> ARRAY[$${idx}]::text[]`);
    sqlParams.push(params.category);
    idx++;
  }
  if (params.min_price !== undefined) {
    conditions.push(`price >= $${idx}::numeric`);
    sqlParams.push(params.min_price);
    idx++;
  }
  if (params.max_price !== undefined) {
    conditions.push(`price <= $${idx}::numeric`);
    sqlParams.push(params.max_price);
    idx++;
  }
  if (params.currency) {
    conditions.push(`LOWER(currency) = LOWER($${idx})`);
    sqlParams.push(params.currency);
    idx++;
  }
  if (params.brand) {
    conditions.push(`LOWER(brand) = LOWER($${idx})`);
    sqlParams.push(params.brand);
    idx++;
  }
  if (params.merchant) {
    conditions.push(`(LOWER(merchant_name) LIKE '%' || LOWER($${idx}) || '%' OR LOWER(platform) LIKE '%' || LOWER($${idx}) || '%')`);
    sqlParams.push(params.merchant);
    idx++;
  }
  if (params.in_stock !== undefined) {
    if (params.in_stock) {
      conditions.push(`availability = 'in_stock'`);
    } else {
      conditions.push(`availability IS DISTINCT FROM 'in_stock'`);
    }
  }
  if (params.on_sale) {
    conditions.push(`COALESCE(discount_percentage, 0) > 0`);
  }
  if (params.min_rating !== undefined) {
    conditions.push(`rating >= $${idx}::numeric`);
    sqlParams.push(params.min_rating);
    idx++;
  }
  if (params.has_image !== undefined) {
    if (params.has_image) {
      conditions.push(`image_url IS NOT NULL`);
    } else {
      conditions.push(`image_url IS NULL`);
    }
  }
  if (params.free_shipping) {
    conditions.push(`shipping_info->>'free' = 'true'`);
  }

  return { conditions, sqlParams, ftsParamIdx };
}

function buildOrderBy(sort: SortKey, ftsParamIdx: number): string {
  switch (sort) {
    case 'relevance':
      return ftsParamIdx > 0
        ? `similarity(name, $${ftsParamIdx}) DESC, updated_at DESC NULLS LAST`
        : `updated_at DESC NULLS LAST`;
    case 'price_asc':
      return `price ASC, id ASC`;
    case 'price_desc':
      return `price DESC, id ASC`;
    case 'rating':
      return `rating DESC NULLS LAST, review_count DESC NULLS LAST, id ASC`;
    case 'newest':
      return `updated_at DESC NULLS LAST, id ASC`;
    case 'popularity':
      return `review_count DESC NULLS LAST, rating DESC NULLS LAST, id ASC`;
    default:
      return `updated_at DESC NULLS LAST`;
  }
}

async function computeFacets(
  conditions: string[],
  sqlParams: unknown[],
  baseParamsLength: number
): Promise<{
  categories: FacetBucket[];
  brands: FacetBucket[];
  merchants: FacetBucket[];
  price_ranges: FacetBucket[];
}> {
  const params = sqlParams.slice(0, baseParamsLength);
  const facetPrefix = conditions.length > 0 ? `${conditions.join(' AND ')} AND ` : '';

  // Categories facet
  const catResult = await db.query(
    `SELECT category_path[1] AS value, COUNT(*)::int AS count
     FROM products
     WHERE ${facetPrefix}category_path IS NOT NULL AND array_length(category_path, 1) >= 1
     GROUP BY value
     ORDER BY count DESC
     LIMIT 10`,
    params
  );

  // Brands facet
  const brandResult = await db.query(
    `SELECT brand AS value, COUNT(*)::int AS count
     FROM products
     WHERE ${facetPrefix}brand IS NOT NULL AND brand != ''
     GROUP BY brand
     ORDER BY count DESC
     LIMIT 10`,
    params
  );

  // Merchants facet
  const merchantResult = await db.query(
    `SELECT COALESCE(merchant_name, platform, 'unknown') AS value, COUNT(*)::int AS count
     FROM products
     WHERE ${facetPrefix}1=1
     GROUP BY value
     ORDER BY count DESC
     LIMIT 10`,
    params
  );

  // Price ranges facet
  const priceResult = await db.query(
    `SELECT
       CASE
         WHEN price < 50 THEN '0-50'
         WHEN price < 200 THEN '50-200'
         WHEN price < 1000 THEN '200-1000'
         ELSE '1000+'
       END AS bucket,
       COUNT(*)::int AS count,
       MIN(price)::float8 AS min_price,
       MAX(price)::float8 AS max_price
     FROM products
     WHERE ${facetPrefix}price IS NOT NULL AND price >= 0
     GROUP BY bucket
     ORDER BY MIN(price) ASC`,
    params
  );

  const rangeMapping: Record<string, { min: number | null; max: number | null }> = {
    '0-50': { min: 0, max: 50 },
    '50-200': { min: 50, max: 200 },
    '200-1000': { min: 200, max: 1000 },
    '1000+': { min: 1000, max: null },
  };

  const price_ranges = priceResult.rows.map((r: any) => ({
    value: r.bucket,
    count: parseInt(r.count, 10),
    min: rangeMapping[r.bucket]?.min ?? null,
    max: rangeMapping[r.bucket]?.max ?? null,
  }));

  return {
    categories: catResult.rows.map((r: any) => ({ value: r.value, count: parseInt(r.count, 10) })),
    brands: brandResult.rows.map((r: any) => ({ value: r.value, count: parseInt(r.count, 10) })),
    merchants: merchantResult.rows.map((r: any) => ({ value: r.value, count: parseInt(r.count, 10) })),
    price_ranges,
  };
}

router.get(
  '/search',
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('agent_catalog.search'),
  async (req: Request, res: Response) => {
    const requestStart = Date.now();

    // Parse and validate sort
    const sortParam = (req.query.sort as string) || 'relevance';
    if (!VALID_SORT_KEYS.includes(sortParam as SortKey)) {
      res.status(400).json({
        error: `Invalid sort key. Must be one of: ${VALID_SORT_KEYS.join(', ')}`,
        code: 'INVALID_FILTER_VALUE',
      });
      return;
    }
    const sort = sortParam as SortKey;

    // Parse filter params
    const q = (req.query.q as string) || undefined;
    const category = req.query.category as string | undefined;
    const currency = req.query.currency as string | undefined;

    if (currency && !VALID_CURRENCIES.includes(currency.toUpperCase())) {
      res.status(400).json({
        error: `Unsupported currency. Supported: ${VALID_CURRENCIES.join(', ')}`,
        code: 'INVALID_FILTER_VALUE',
      });
      return;
    }

    let minPrice: number | undefined;
    if (req.query.min_price !== undefined) {
      minPrice = parseFloat(req.query.min_price as string);
      if (isNaN(minPrice) || minPrice < 0) {
        res.status(400).json({
          error: 'min_price must be a non-negative number',
          code: 'INVALID_FILTER_VALUE',
        });
        return;
      }
    }

    let maxPrice: number | undefined;
    if (req.query.max_price !== undefined) {
      maxPrice = parseFloat(req.query.max_price as string);
      if (isNaN(maxPrice) || maxPrice < 0) {
        res.status(400).json({
          error: 'max_price must be a non-negative number',
          code: 'INVALID_FILTER_VALUE',
        });
        return;
      }
    }

    // Swap min/max if inverted
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      [minPrice, maxPrice] = [maxPrice, minPrice];
    }

    const brand = req.query.brand as string | undefined;
    const merchant = req.query.merchant as string | undefined;

    let inStock: boolean | undefined;
    if (req.query.in_stock !== undefined) {
      if (req.query.in_stock !== 'true' && req.query.in_stock !== 'false') {
        res.status(400).json({
          error: 'in_stock must be a boolean (true/false)',
          code: 'INVALID_FILTER_VALUE',
        });
        return;
      }
      inStock = req.query.in_stock === 'true';
    }

    let onSale: boolean | undefined;
    if (req.query.on_sale !== undefined) {
      if (req.query.on_sale !== 'true' && req.query.on_sale !== 'false') {
        res.status(400).json({
          error: 'on_sale must be a boolean (true/false)',
          code: 'INVALID_FILTER_VALUE',
        });
        return;
      }
      onSale = req.query.on_sale === 'true';
    }

    let minRating: number | undefined;
    if (req.query.min_rating !== undefined) {
      minRating = parseFloat(req.query.min_rating as string);
      if (isNaN(minRating) || minRating < 0 || minRating > 5) {
        res.status(400).json({
          error: 'min_rating must be a number between 0 and 5',
          code: 'INVALID_FILTER_VALUE',
        });
        return;
      }
    }

    let hasImage: boolean | undefined;
    if (req.query.has_image !== undefined) {
      if (req.query.has_image !== 'true' && req.query.has_image !== 'false') {
        res.status(400).json({
          error: 'has_image must be a boolean (true/false)',
          code: 'INVALID_FILTER_VALUE',
        });
        return;
      }
      hasImage = req.query.has_image === 'true';
    }

    let freeShipping: boolean | undefined;
    if (req.query.free_shipping !== undefined) {
      if (req.query.free_shipping !== 'true' && req.query.free_shipping !== 'false') {
        res.status(400).json({
          error: 'free_shipping must be a boolean (true/false)',
          code: 'INVALID_FILTER_VALUE',
        });
        return;
      }
      freeShipping = req.query.free_shipping === 'true';
    }

    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);
    const offset = parseInt((req.query.offset as string) || '0');

    // Build query
    const { conditions, sqlParams, ftsParamIdx } = buildWhereClause({
      q, category, min_price: minPrice, max_price: maxPrice,
      currency, brand, merchant, in_stock: inStock,
      on_sale: onSale, min_rating: minRating,
      has_image: hasImage, free_shipping: freeShipping,
    });

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Redis cache key
    const cacheKey = `agent-catalog:search:${JSON.stringify({ q, category, minPrice, maxPrice, currency, brand, merchant, inStock, onSale, minRating, hasImage, freeShipping, sort, limit, offset })}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        parsed.response_time_ms = Date.now() - requestStart;
        parsed.cached = true;
        return res.json(parsed);
      }
    } catch {
      // Cache miss — continue
    }

    try {
      // Set trigram similarity threshold for fuzzy matching
      if (q) {
        await db.query(`SELECT set_limit(0.3)`);
      }

      // Count query — pass all filter params (slice to exclude limit/offset which aren't pushed yet)
      const countResult = await db.query(
        `SELECT COUNT(*) FROM products ${whereClause}`,
        sqlParams
      );
      const total = parseInt(countResult.rows[0].count, 10);

      // Data query
      const orderBy = buildOrderBy(sort, ftsParamIdx);
      sqlParams.push(limit, offset);
      const dataParamIdx = sqlParams.length - 1;

      const dataQuery = q
        ? `
          SELECT id, sku AS source_id, source AS domain, url,
                 name AS title, price, currency, image_url, metadata, updated_at,
                 region, country_code, brand, merchant_name, platform,
                 availability, discount_percentage, rating, review_count,
                 shipping_info, category_path,
                 similarity(name, $${ftsParamIdx}) AS _similarity
          FROM products
          ${whereClause}
          ORDER BY ${orderBy}
          LIMIT $${dataParamIdx - 1} OFFSET $${dataParamIdx}`
        : `
          SELECT id, sku AS source_id, source AS domain, url,
                 name AS title, price, currency, image_url, metadata, updated_at,
                 region, country_code, brand, merchant_name, platform,
                 availability, discount_percentage, rating, review_count,
                 shipping_info, category_path
          FROM products
          ${whereClause}
          ORDER BY ${orderBy}
          LIMIT $${dataParamIdx - 1} OFFSET $${dataParamIdx}`;

      const dataResult = await db.query(dataQuery, sqlParams);

      // Compute facets
      const facets = await computeFacets(conditions, sqlParams, sqlParams.length - 2);

      const products = dataResult.rows.map((row: any) => ({
        id: row.id,
        source_id: row.source_id || row.sku,
        domain: row.domain || row.source,
        url: row.url,
        title: row.title,
        price: row.price ? parseFloat(row.price) : null,
        currency: row.currency,
        image_url: row.image_url,
        brand: row.brand || null,
        merchant: row.merchant_name || row.platform || null,
        availability: row.availability || null,
        discount_percentage: row.discount_percentage ? parseFloat(row.discount_percentage) : null,
        rating: row.rating ? parseFloat(row.rating) : null,
        review_count: row.review_count ? parseInt(row.review_count, 10) : 0,
        free_shipping: row.shipping_info?.free === 'true',
        region: row.region || null,
        country_code: row.country_code || null,
        category_path: row.category_path || [],
        _similarity: row._similarity ? parseFloat(row._similarity) : undefined,
      }));

      const responseBody = {
        data: products,
        facets,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + limit < total,
        },
        response_time_ms: Date.now() - requestStart,
        cached: false,
      };

      // Cache result
      redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => {});

      // Track query
      if (req.apiKeyRecord) {
        trackApiQuery({
          apiKey: hashKey(req.apiKeyRecord.key),
          agentFramework: (req as any).agentInfo?.framework || 'unknown',
          agentVersion: (req as any).agentInfo?.version || '',
          sdkLanguage: (req as any).agentInfo?.sdkLanguage || 'unknown',
          queryIntent: q || 'browse',
          productCategories: [],
          resultCount: products.length,
          responseTimeMs: responseBody.response_time_ms,
          signupChannel: req.apiKeyRecord.signupChannel,
          sourcePage: null,
          endpoint: 'agent_catalog.search',
        });
      }

      res.json(responseBody);
    } catch (err) {
      console.error('[agent-catalog/search] DB error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
