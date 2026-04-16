"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const apiKey_1 = require("../middleware/apiKey");
const agentDetect_1 = require("../middleware/agentDetect");
const posthog_1 = require("../analytics/posthog");
const queryLog_1 = require("../middleware/queryLog");
const SEARCH_CACHE_TTL_SECONDS = 60;
// Maps ISO country code to native currency — used for both query inference and ingest defaults.
const COUNTRY_CURRENCY = { SG: 'SGD', US: 'USD', VN: 'VND', TH: 'THB', MY: 'MYR' };
const router = (0, express_1.Router)();
// GET /v1/products/search
// Query params: q, domain, region, country, min_price, max_price, currency, limit, offset, source_page
router.get('/search', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.search'), async (req, res) => {
    const start = Date.now();
    const q = req.query.q || '';
    const domain = req.query.domain;
    const region = req.query.region;
    // country_code is the canonical param; `country` is kept as a backward-compat alias
    const countryCode = (req.query.country_code || req.query.country)?.toUpperCase() || undefined;
    const minPrice = req.query.min_price ? parseFloat(req.query.min_price) : undefined;
    const maxPrice = req.query.max_price ? parseFloat(req.query.max_price) : undefined;
    // Infer default currency from country_code when not explicitly provided.
    // Price filters (min_price/max_price) apply in this inferred currency.
    const currency = req.query.currency || (countryCode ? (COUNTRY_CURRENCY[countryCode] || 'SGD') : 'SGD');
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const offset = parseInt(req.query.offset || '0');
    const sourcePage = req.query.source_page;
    const compact = req.query.compact === 'true';
    // Check Redis cache for this exact query (60s TTL)
    const cacheKey = `fts:${q}:${domain || ''}:${region || ''}:${countryCode || ''}:${currency}:${minPrice ?? ''}:${maxPrice ?? ''}:${limit}:${offset}:${compact ? 'c' : 'f'}`;
    try {
        const cached = await config_1.redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            parsed.meta.cached = true;
            parsed.meta.response_time_ms = Date.now() - start;
            return res.json(parsed);
        }
    }
    catch (_) {
        // Redis miss or error — fall through to DB
    }
    const conditions = ['currency = $1'];
    const params = [currency];
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
    const countResult = await config_1.db.query(countQuery, params.slice(0, idx - 1));
    const approxCount = parseInt(countResult.rows[0].count, 10);
    // For large result sets (>1000 rows), computing ts_rank over all matches is expensive.
    // Instead, let the GIN index fetch up to CANDIDATE_LIMIT rows, rank those by ts_rank,
    // then return the top N. This gives relevance ordering at a fraction of the cost.
    // For small result sets (<= 1000 rows), ts_rank over all matches is fast.
    const CANDIDATE_LIMIT = Math.max(500, (limit + offset) * 10);
    let dataQuery;
    if (ftsParamIdx && approxCount <= 1000) {
        // Small result set: ts_rank over all matches is fast, gives best relevance
        dataQuery = `
        SELECT id, sku AS source_id, source AS domain, url,
               title, price, currency, image_url, metadata, updated_at,
               region, country_code
        FROM products
        ${whereClause}
        ORDER BY ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) DESC, updated_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    }
    else if (ftsParamIdx) {
        // Large result set: GIN index fetches CANDIDATE_LIMIT rows using bitmap scan, then ranks.
        // No ORDER BY in the inner query — this lets PostgreSQL stop the heap scan after
        // CANDIDATE_LIMIT rows (vs scanning all 25k+ matching rows to sort by rank first).
        // 12x faster for broad queries (14ms vs 170ms for "headphones" on 2M product corpus).
        dataQuery = `
        SELECT id, source_id, domain, url, title, price, currency, image_url, metadata, updated_at, region, country_code
        FROM (
          SELECT id, sku AS source_id, source AS domain, url,
                 title, price, currency, image_url, metadata, updated_at,
                 region, country_code,
                 ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) AS rank
          FROM products
          ${whereClause}
          LIMIT ${CANDIDATE_LIMIT}
        ) _candidates
        ORDER BY rank DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    }
    else {
        // No FTS query (e.g. filter-only) — sort by recency
        dataQuery = `
        SELECT id, sku AS source_id, source AS domain, url,
               title, price, currency, image_url, metadata, updated_at,
               region, country_code
        FROM products
        ${whereClause}
        ORDER BY updated_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `;
    }
    params.push(limit, offset);
    const dataResult = await config_1.db.query(dataQuery, params);
    const products = dataResult.rows.map((row) => {
        if (compact) {
            // Compact format for AI agents: minimal payload, normalized specs
            const meta = row.metadata;
            const specs = {
                brand: meta?.brand ?? null,
                category: meta?.category ?? null,
                model: meta?.model ?? null,
            };
            if (meta?.size != null)
                specs.size = meta.size;
            if (meta?.color != null)
                specs.color = meta.color;
            return {
                id: row.id,
                canonical_id: row.id,
                title: row.title,
                price: row.price ? parseFloat(row.price) : null,
                currency: row.currency,
                url: row.url,
                source: row.source_id,
                region: row.region || null,
                country_code: row.country_code || null,
                specs,
            };
        }
        return {
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
    });
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
    config_1.redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => { });
    // Extract categories from results for analytics
    const categories = extractCategories(products);
    // PostHog event (fire-and-forget)
    if (req.apiKeyRecord) {
        (0, posthog_1.trackApiQuery)({
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
});
// GET /v1/products/deals
// Returns products on sale (original_price > price), sorted by discount %
router.get('/deals', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.deals'), async (req, res) => {
    const start = Date.now();
    const currency = req.query.currency || 'SGD';
    const minDiscount = parseFloat(req.query.min_discount || '10');
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const offset = parseInt(req.query.offset || '0');
    const cacheKey = `deals:${currency}:${minDiscount}:${limit}:${offset}`;
    try {
        const cached = await config_1.redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            parsed.meta.cached = true;
            parsed.meta.response_time_ms = Date.now() - start;
            return res.json(parsed);
        }
    }
    catch (_) { }
    // Deals: use metadata->'original_price' if available, or price_sgd comparison
    const [countResult, dataResult] = await Promise.all([
        config_1.db.query(`SELECT COUNT(*) FROM products
         WHERE currency = $1
           AND (metadata->>'original_price')::numeric > price
           AND (((metadata->>'original_price')::numeric - price) / (metadata->>'original_price')::numeric * 100) >= $2`, [currency, minDiscount]),
        config_1.db.query(`SELECT id, sku AS source_id, source AS domain, url,
                title, price, (metadata->>'original_price')::numeric AS original_price,
                currency, image_url, metadata, updated_at,
                region, country_code,
                ROUND((((metadata->>'original_price')::numeric - price) / (metadata->>'original_price')::numeric * 100)::numeric, 1) AS discount_pct
         FROM products
         WHERE currency = $1
           AND (metadata->>'original_price')::numeric > price
           AND (((metadata->>'original_price')::numeric - price) / (metadata->>'original_price')::numeric * 100) >= $2
         ORDER BY (((metadata->>'original_price')::numeric - price) / (metadata->>'original_price')::numeric) DESC, updated_at DESC
         LIMIT $3 OFFSET $4`, [currency, minDiscount, limit, offset]),
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
    config_1.redis.set(cacheKey, JSON.stringify(responseBody), 'EX', SEARCH_CACHE_TTL_SECONDS).catch(() => { });
    res.json(responseBody);
});
// GET /v1/products/compare?ids=id1,id2,id3
router.get('/compare', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.compare'), async (req, res) => {
    const start = Date.now();
    const ids = (req.query.ids || '').split(',').filter(Boolean).slice(0, 10);
    if (ids.length < 2) {
        res.status(400).json({ error: 'Provide at least 2 product IDs via ?ids=id1,id2' });
        return;
    }
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await config_1.db.query(`SELECT id, sku AS source_id, source AS domain, url,
              title, price, currency, image_url, metadata,
              category_path, brand, avg_rating AS rating, review_count, updated_at, region, country_code
       FROM products WHERE id IN (${placeholders})`, ids);
    const products = result.rows.map((row) => ({
        id: row.id,
        source: row.source_id,
        domain: row.domain,
        url: row.url,
        title: row.title,
        price: row.price ? parseFloat(row.price) : null,
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
    const uniqueCurrencies = [...new Set(products.map((p) => p.currency).filter(Boolean))];
    const currenciesMixed = uniqueCurrencies.length > 1;
    res.json({
        data: products,
        meta: {
            count: products.length,
            response_time_ms: Date.now() - start,
            currencies_mixed: currenciesMixed,
            ...(currenciesMixed && {
                currency_warning: `Products span multiple currencies (${uniqueCurrencies.join(', ')}). Prices are not comparable across currencies — do not aggregate or rank by price in comparison_summary.`,
            }),
        },
    });
});
// GET /v1/products/:id/price-history — daily aggregated price history (BUY-2345)
// Query params: days (30|90|180, default 30)
router.get('/:id/price-history', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.price-history'), async (req, res) => {
    const start = Date.now();
    const { id } = req.params;
    const days = Math.min(parseInt(req.query.days || '30'), 180);
    const [productResult, historyResult] = await Promise.all([
        config_1.db.query(`SELECT id, title, price, currency FROM products WHERE id = $1`, [id]),
        config_1.db.query(`SELECT
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
         ORDER BY day ASC`, [id, days]),
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
});
// GET /v1/products/:id/prices — price history from price_snapshots
router.get('/:id/prices', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.prices'), async (req, res) => {
    const start = Date.now();
    const { id } = req.params;
    const days = Math.min(parseInt(req.query.days || '30'), 90);
    const [productResult, historyResult] = await Promise.all([
        config_1.db.query(`SELECT id, title, price, currency FROM products WHERE id = $1`, [id]),
        config_1.db.query(`SELECT price, currency, recorded_at AS scraped_at
         FROM price_history
         WHERE product_id = $1 AND recorded_at >= NOW() - ($2 || ' days')::interval
         ORDER BY recorded_at ASC`, [id, days]),
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
});
// GET /v1/products/:id/similar — return up to 8 similar products for 'related products' widget
// Strategy: same brand+category first (fast index lookup), then FTS title fallback to pad to 8.
// Target: <50ms p99 — both paths use GIN/B-tree indexes only.
router.get('/:id/similar', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.similar'), async (req, res) => {
    const start = Date.now();
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '8'), 20);
    // Fetch the source product
    const srcResult = await config_1.db.query(`SELECT id, title, brand, category_path, currency, search_vector
       FROM products WHERE id = $1`, [id]);
    if (srcResult.rows.length === 0) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    const src = srcResult.rows[0];
    const currency = src.currency || 'SGD';
    // Phase 1: same brand + same first category element (indexed columns)
    const brand = src.brand || null;
    const topCategory = src.category_path?.[0] || null;
    let similar = [];
    if (brand && topCategory) {
        const brandCatResult = await config_1.db.query(`SELECT id, sku AS source_id, source AS domain, url, title, price, currency,
                image_url, brand, category_path, region, country_code
         FROM products
         WHERE id != $1
           AND brand = $2
           AND category_path[1] = $3
           AND currency = $4
         ORDER BY updated_at DESC
         LIMIT $5`, [id, brand, topCategory, currency, limit]);
        similar = brandCatResult.rows;
    }
    // Phase 2: FTS on title to pad remaining slots (if < limit results so far)
    if (similar.length < limit && src.title) {
        const needed = limit - similar.length;
        const existingIds = [id, ...similar.map((r) => r.id)];
        const placeholders = existingIds.map((_, i) => `$${i + 1}`).join(',');
        const ftsResult = await config_1.db.query(`SELECT id, sku AS source_id, source AS domain, url, title, price, currency,
                image_url, brand, category_path, region, country_code
         FROM products
         WHERE id NOT IN (${placeholders})
           AND currency = $${existingIds.length + 1}
           AND search_vector @@ plainto_tsquery('english', $${existingIds.length + 2})
         ORDER BY ts_rank(search_vector, plainto_tsquery('english', $${existingIds.length + 2})) DESC,
                  updated_at DESC
         LIMIT $${existingIds.length + 3}`, [...existingIds, currency, src.title, needed]);
        similar = [...similar, ...ftsResult.rows];
    }
    const data = similar.map((row) => ({
        id: row.id,
        source: row.source_id,
        domain: row.domain,
        url: row.url,
        title: row.title,
        price: row.price ? parseFloat(row.price) : null,
        currency: row.currency,
        image_url: row.image_url || null,
        brand: row.brand || null,
        category_path: row.category_path || null,
        region: row.region || null,
        country_code: row.country_code || null,
    }));
    res.json({ data, meta: { source_id: id, count: data.length, response_time_ms: Date.now() - start } });
});
// GET /v1/products/:id
router.get('/:id', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, (0, queryLog_1.queryLogMiddleware)('products.get'), async (req, res) => {
    const start = Date.now();
    const { id } = req.params;
    const result = await config_1.db.query(`SELECT id, sku AS source_id, source AS domain, url,
              title, price, currency, image_url, metadata, updated_at,
              region, country_code, brand, category_path, avg_rating AS rating, review_count
       FROM products WHERE id = $1`, [id]);
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
        brand: row.brand || null,
        category_path: row.category_path || null,
        rating: row.rating ? parseFloat(row.rating) : null,
        review_count: row.review_count || null,
        metadata: row.metadata,
        region: row.region || null,
        country_code: row.country_code || null,
        updated_at: row.updated_at,
    };
    if (req.apiKeyRecord) {
        (0, posthog_1.trackApiQuery)({
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
});
function inferQueryIntent(q, domain, minPrice, maxPrice) {
    const lower = q.toLowerCase();
    if (minPrice !== undefined && maxPrice !== undefined)
        return 'price_check';
    if (/\bvs\b|compare|comparison|difference/i.test(lower))
        return 'comparison';
    if (/buy|purchase|order|checkout/i.test(lower))
        return 'purchase_intent';
    if (q.length === 0 && domain)
        return 'bulk_catalog';
    if (q.length > 0)
        return 'discovery';
    return 'bulk_catalog';
}
// POST /v1/products/ingest
// Bulk ingest products from scraper agents. Requires API key auth.
// Upserts on (platform, platform_id) — safe to re-run.
router.post('/ingest', apiKey_1.requireApiKey, async (req, res) => {
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
        'amazon_sg', 'asos', 'audiohouse', 'bestdenki', 'books_com_tw', 'bukalapak',
        'carousell', 'castlery', 'challenger', 'coldstorage', 'coupang', 'courts',
        'decathlon', 'ezbuy', 'fairprice', 'flipkart', 'fortytwo', 'gaincity', 'giant',
        'guardian', 'harvey_norman', 'hipvan', 'iherb', 'ikea', 'ishopchangi', 'kohepets',
        'lazada', 'lovebonito', 'maybelline', 'merchant_direct', 'metro', 'mothercare',
        'mustafa', 'myntra', 'nike', 'petloverscentre', 'popular', 'qoo10', 'rakuten',
        'redmart', 'robinsons', 'sasa', 'sephora', 'shein', 'shengsiong', 'shopee',
        'stereo', 'tangs', 'tiki', 'tokopedia', 'toysrus', 'uniqlo', 'vuori', 'watsons', 'zalora',
    ]);
    const rows = [];
    const errors = [];
    for (let i = 0; i < items.length; i++) {
        const p = items[i];
        if (!p || typeof p !== 'object') {
            errors.push(`[${i}] not an object`);
            continue;
        }
        if (!p.platform || !VALID_PLATFORMS.has(p.platform)) {
            errors.push(`[${i}] invalid or missing platform`);
            continue;
        }
        if (!p.name || typeof p.name !== 'string') {
            errors.push(`[${i}] missing name`);
            continue;
        }
        if (!p.price || isNaN(parseFloat(p.price))) {
            errors.push(`[${i}] missing or invalid price`);
            continue;
        }
        if (!p.product_url && !p.productUrl) {
            errors.push(`[${i}] missing product_url`);
            continue;
        }
        const platformId = p.platform_id || p.platformId || p.product_id || p.id || '';
        const sku = p.sku || platformId || `${p.platform}-${i}`;
        rows.push({
            id: require('crypto').randomUUID(),
            platform: p.platform,
            platformId,
            sku,
            name: String(p.name).slice(0, 1000),
            price: parseFloat(p.price),
            currency: p.currency || (p.country_code ? COUNTRY_CURRENCY[p.country_code.toUpperCase()] : null) || (p.countryCode ? COUNTRY_CURRENCY[p.countryCode.toUpperCase()] : null) || 'SGD',
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
        const result = await config_1.db.query(`INSERT INTO products
           (sku, source, merchant_id, title, description, price, currency, url,
            image_url, category_path, brand, metadata, is_active, region, country_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14)
         ON CONFLICT (sku, source)
         DO UPDATE SET
           title = EXCLUDED.title,
           price = EXCLUDED.price,
           currency = EXCLUDED.currency,
           image_url = EXCLUDED.image_url,
           region = COALESCE(EXCLUDED.region, products.region),
           country_code = COALESCE(EXCLUDED.country_code, products.country_code),
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert`, [
            r.sku, r.platform, r.merchantId, r.name, r.description || null,
            r.price, r.currency, r.productUrl, r.imageUrl || null,
            r.categoryPath.length ? `{${r.categoryPath.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}` : '{}',
            r.brand || null,
            JSON.stringify({ original_price: r.originalPrice, merchant_name: r.merchantName, availability: r.availability }),
            r.region || null, r.countryCode || null,
        ]).catch(() => null);
        if (result && result.rows[0]) {
            if (result.rows[0].is_insert)
                inserted++;
            else
                updated++;
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
});
function extractCategories(products) {
    const cats = new Set();
    for (const p of products) {
        if (p.domain) {
            const domain = p.domain.replace('.sg', '').replace('.com', '');
            cats.add(domain);
        }
        if (p.metadata && typeof p.metadata === 'object') {
            const meta = p.metadata;
            if (typeof meta['category'] === 'string')
                cats.add(meta['category']);
            if (typeof meta['sub_category'] === 'string')
                cats.add(meta['sub_category']);
        }
    }
    return Array.from(cats).slice(0, 10);
}
exports.default = router;
