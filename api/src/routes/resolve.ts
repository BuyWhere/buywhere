import { Router, Request, Response } from 'express';
import { db, redis } from '../config';
import { requireApiKey, checkRateLimit } from '../middleware/apiKey';
import { agentDetectMiddleware } from '../middleware/agentDetect';
import { queryLogMiddleware } from '../middleware/queryLog';
import { buildProduct, buildSearchResponse, COUNTRY_CURRENCY } from '../lib/response';
import { preprocessSearchQuery, classifyIntent } from '../lib/queryPreprocessor';

const CACHE_TTL_SECONDS = 60;

const router = Router();

router.post(
  '/',
  agentDetectMiddleware,
  requireApiKey,
  checkRateLimit,
  queryLogMiddleware('resolve'),
  async (req: Request, res: Response) => {
    const t0 = Date.now();
    const body = req.body;
    const rawQuery = ((body?.query as string) || (body?.q as string) || '').trim();
    if (!rawQuery) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const intent = classifyIntent(rawQuery);

    const region = (body?.region as string) || '';
    const countryCode = ((body?.country_code as string) || (body?.country as string) || '').toUpperCase();
    const domain = (body?.domain as string) || '';
    const limit = Math.min(Number(body?.limit) || 20, 100);
    const offset = Number(body?.offset) || 0;
    const compact = body?.compact === true;

    const minPriceParam = body?.min_price != null ? Number(body.min_price) : undefined;
    const maxPriceParam = body?.max_price != null ? Number(body.max_price) : undefined;

    const { cleanedQuery, extractedMinPrice, extractedMaxPrice, sortIntent } = preprocessSearchQuery(
      rawQuery,
      minPriceParam,
      maxPriceParam
    );

    const minPrice = minPriceParam ?? extractedMinPrice;
    const maxPrice = maxPriceParam ?? extractedMaxPrice;
    const effectiveCountry = countryCode || (!region ? 'SG' : '');
    const currency = effectiveCountry ? (COUNTRY_CURRENCY[effectiveCountry] || 'SGD') : 'SGD';

    const baseResponse = {
      intent,
      query: {
        original: rawQuery,
        cleaned: cleanedQuery,
        resolved_min_price: minPrice ?? null,
        resolved_max_price: maxPrice ?? null,
        resolved_sort: sortIntent || null,
      },
      response_time_ms: 0,
    };

    switch (intent) {
      case 'deals': {
        const dealsArgs: Record<string, unknown> = {
          min_discount: body?.min_discount ?? 10,
          currency: body?.currency || currency,
          region,
          country_code: effectiveCountry,
          limit,
          offset,
        };
        const dealsResult = await handleGetDeals(dealsArgs);
        res.json({ ...baseResponse, ...dealsResult, response_time_ms: Date.now() - t0 });
        return;
      }
      case 'categories': {
        const catsResult = await handleListCategories();
        res.json({ ...baseResponse, ...catsResult, response_time_ms: Date.now() - t0 });
        return;
      }
      case 'best_price': {
        const bpResult = await handleFindBestPrice({
          product_name: cleanedQuery || rawQuery,
          category: body?.category,
          country_code: effectiveCountry,
          region,
        });
        res.json({ ...baseResponse, ...bpResult, response_time_ms: Date.now() - t0 });
        return;
      }
      case 'compare': {
        const compResult = await handleSearchProductsCompare({
          q: cleanedQuery || rawQuery,
          domain,
          region,
          country_code: effectiveCountry,
          min_price: minPrice,
          max_price: maxPrice,
          limit,
          offset,
          compact,
          currency,
        });
        res.json({ ...baseResponse, ...compResult, response_time_ms: Date.now() - t0 });
        return;
      }
      default: {
        const searchResult = await handleSearchProductsDefault({
          q: cleanedQuery,
          domain,
          region,
          country_code: effectiveCountry,
          min_price: minPrice,
          max_price: maxPrice,
          limit,
          offset,
          compact,
          currency,
        });
        res.json({ ...baseResponse, ...searchResult, response_time_ms: Date.now() - t0 });
        return;
      }
    }
  }
);

async function handleGetDeals(args: Record<string, unknown>) {
  const t0 = Date.now();
  const minDiscount = Number(args.min_discount) || 10;
  const currency = ((args.currency as string) || 'SGD').toUpperCase();
  const region = (args.region as string) || '';
  const country = ((args.country_code as string) || '').toUpperCase();
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;

  const cacheKey = `resolve_deals:${currency}:${minDiscount}:${region}:${country}:${limit}:${offset}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...parsed, cached: true };
    }
  } catch (_) {}

  const conditions: string[] = [
    `currency = $1`,
    `(metadata->>'original_price')::numeric > price`,
    `(metadata->>'original_price')::numeric < price * 100`,
    `price > 0`,
    `(1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100 >= $2`,
  ];
  const params: unknown[] = [currency, minDiscount];

  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (country) {
    params.push(country.toUpperCase());
    conditions.push(`country_code = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const [countResult, dataResult] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM products WHERE ${whereClause}`, params),
    (() => {
      const dataParams = [...params, limit, offset];
      const limitIdx = dataParams.length - 1;
      const offsetIdx = dataParams.length;
      return db.query(
        `SELECT id, sku AS source, source AS domain, url, title,
                price, (metadata->>'original_price')::numeric AS original_price,
                currency, image_url, metadata, updated_at, region, country_code,
                ROUND((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100) AS discount_pct
         FROM products
         WHERE ${whereClause}
         ORDER BY discount_pct DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
      );
    })(),
  ]);

  const products = dataResult.rows.map((r: Record<string, unknown>) =>
    buildProduct(r, currency, false)
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = buildSearchResponse(products, total, limit, offset, Date.now() - t0, false);
  redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => {});
  return result;
}

async function handleListCategories() {
  const t0 = Date.now();
  const cacheKey = 'categories_resolve:top100';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...parsed, cached: true };
    }
  } catch (_) {}

  const result = await db.query(
    `SELECT category_path[1] AS slug,
            category_path[1] AS name,
            COUNT(*) AS product_count
     FROM products
     WHERE category_path IS NOT NULL AND array_length(category_path, 1) > 0
     GROUP BY 1
     ORDER BY product_count DESC
     LIMIT 100`
  );

  const data = { data: result.rows, meta: { total: result.rows.length, response_time_ms: Date.now() - t0, cached: false } };
  redis.set(cacheKey, JSON.stringify(data), 'EX', 300).catch(() => {});
  return data;
}

async function handleFindBestPrice(args: Record<string, unknown>) {
  const t0 = Date.now();
  const productName = (args.product_name as string) || '';
  if (!productName) return { best_price: null, alternatives: [], meta: { total: 0, response_time_ms: Date.now() - t0 } };

  const country = (((args.country_code as string) || (args.country as string)) || 'SG').toUpperCase();
  const region = (args.region as string) || '';
  const category = (args.category as string) || '';
  const limit = 10;

  const conditions: string[] = ['is_active = true'];
  const params: unknown[] = [];

  params.push(productName);
  conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);

  if (country) {
    params.push(country);
    conditions.push(`country_code = $${params.length}`);
  }
  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (category) {
    params.push(`%${category}%`);
    conditions.push(`category ILIKE $${params.length}`);
  }

  params.push(limit);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await db.query(
    `SELECT id, title, price, currency, source AS domain, url, image_url,
            country_code,
            ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
     FROM products ${where}
     ORDER BY price ASC, rank DESC
     LIMIT $${params.length}`,
    params
  );

  const curr = country ? (COUNTRY_CURRENCY[country] || 'SGD') : 'SGD';
  const CURRENCY_RATES: Record<string, number> = { USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79 };
  const toUsd = CURRENCY_RATES[curr] ?? 1;

  const data = result.rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    title: r.title,
    price: { amount: r.price != null ? parseFloat(r.price as string) : null, currency: r.currency || curr },
    normalized_price_usd: r.price != null ? Math.round(Number(r.price) * toUsd * 100) / 100 : null,
    merchant: r.domain as string,
    url: r.url as string,
    image_url: r.image_url as string,
    country_code: r.country_code as string,
  }));

  return {
    best_price: data[0] ?? null,
    alternatives: data.slice(1),
    meta: { total: data.length, country, response_time_ms: Date.now() - t0 },
  };
}

async function handleSearchProductsCompare(args: Record<string, unknown>) {
  const t0 = Date.now();
  const q = (args.q as string) || '';
  const domain = (args.domain as string) || '';
  const region = (args.region as string) || '';
  const country = (args.country_code as string) || '';
  const minPrice = args.min_price != null ? Number(args.min_price) : null;
  const maxPrice = args.max_price != null ? Number(args.max_price) : null;
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;
  const compact = args.compact === true;
  const currency = (args.currency as string) || 'SGD';

  const cacheKey = `resolve_compare:${q}:${domain}:${region}:${country}:${minPrice ?? ''}:${maxPrice ?? ''}:${limit}:${offset}:${compact ? 'c' : 'f'}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...parsed, cached: true };
    }
  } catch (_) {}

  const conditions: string[] = ['is_active = true'];
  const params: unknown[] = [];

  if (q) {
    params.push(q);
    conditions.push(`search_vector @@ plainto_tsquery('english', $${params.length})`);
  }
  if (domain) {
    params.push(domain);
    conditions.push(`source = $${params.length}`);
  }
  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  }
  if (country) {
    params.push(country.toUpperCase());
    conditions.push(`country_code = $${params.length}`);
  }
  if (minPrice != null) {
    params.push(minPrice);
    conditions.push(`price >= $${params.length}`);
  }
  if (maxPrice != null) {
    params.push(maxPrice);
    conditions.push(`price <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);
  const dataResult = await db.query(
    `SELECT id, sku AS source_id, source AS domain, url, title,
            price, currency, image_url, metadata, updated_at,
            region, country_code, created_at, description, brand, mpn, gtin,
            category_path, category, merchant_id, avg_rating, review_count,
            ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
     FROM products ${where}
     ORDER BY rank DESC, avg_rating DESC NULLS LAST, updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const countResult = await db.query(
    `SELECT COUNT(*) FROM (SELECT 1 FROM products ${where} LIMIT 1001) _sub`,
    params.slice(0, params.length - 2)
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const products = dataResult.rows.map((r: Record<string, unknown>) =>
    buildProduct(r, currency, compact)
  );

  const result = buildSearchResponse(products, total, limit, offset, Date.now() - t0, false);
  redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => {});
  return result;
}

async function handleSearchProductsDefault(args: Record<string, unknown>) {
  const t0 = Date.now();
  const q = (args.q as string) || '';
  const domain = (args.domain as string) || '';
  const region = (args.region as string) || '';
  const country = (args.country_code as string) || '';
  const minPrice = args.min_price != null ? Number(args.min_price) : null;
  const maxPrice = args.max_price != null ? Number(args.max_price) : null;
  const limit = Math.min(Number(args.limit) || 20, 100);
  const offset = Number(args.offset) || 0;
  const compact = args.compact === true;
  const currency = (args.currency as string) || 'SGD';

  const cacheKey = `resolve_search:${q}:${domain}:${region}:${country}:${minPrice ?? ''}:${maxPrice ?? ''}:${limit}:${offset}:${compact ? 'c' : 'f'}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...parsed, cached: true };
    }
  } catch (_) {}

  const conditions: string[] = ['is_active = true'];
  const params: unknown[] = [];
  let idx = 1;

  if (q) {
    params.push(q);
    conditions.push(`search_vector @@ plainto_tsquery('english', $${idx})`);
    idx++;
  }
  if (domain) {
    params.push(domain);
    conditions.push(`source = $${idx}`);
    idx++;
  }
  if (region) {
    params.push(region);
    conditions.push(`region = $${idx}`);
    idx++;
  }
  if (country) {
    params.push(country.toUpperCase());
    conditions.push(`country_code = $${idx}`);
    idx++;
  }
  if (minPrice != null) {
    params.push(minPrice);
    conditions.push(`price >= $${idx}`);
    idx++;
  }
  if (maxPrice != null) {
    params.push(maxPrice);
    conditions.push(`price <= $${idx}`);
    idx++;
  }

  const whereClause = conditions.join(' AND ');

  params.push(limit, offset);
  const dataResult = await db.query(
    `SELECT id, sku AS source_id, source AS domain, url, title,
            price, currency, image_url, metadata, updated_at,
            region, country_code, created_at, description, brand, mpn, gtin,
            category_path, category, merchant_id, avg_rating, review_count,
            ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
     FROM products ${whereClause}
     ORDER BY rank DESC, updated_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );

  const countResult = await db.query(
    `SELECT COUNT(*) FROM (SELECT 1 FROM products ${whereClause} LIMIT 1001) _sub`,
    params.slice(0, idx - 1)
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const products = dataResult.rows.map((r: Record<string, unknown>) =>
    buildProduct(r, currency, compact)
  );

  const result = buildSearchResponse(products, total, limit, offset, Date.now() - t0, false);
  redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => {});
  return result;
}

export default router;