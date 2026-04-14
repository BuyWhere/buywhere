"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const apiKey_1 = require("../middleware/apiKey");
const agentDetect_1 = require("../middleware/agentDetect");
const posthog_1 = require("../analytics/posthog");
const router = (0, express_1.Router)();
// GET /v1/products/search
// Query params: q, domain, min_price, max_price, currency, limit, offset, source_page
router.get('/search', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, async (req, res) => {
    const start = Date.now();
    const q = req.query.q || '';
    const domain = req.query.domain;
    const minPrice = req.query.min_price ? parseFloat(req.query.min_price) : undefined;
    const maxPrice = req.query.max_price ? parseFloat(req.query.max_price) : undefined;
    const currency = req.query.currency || 'SGD';
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const offset = parseInt(req.query.offset || '0');
    const sourcePage = req.query.source_page;
    const conditions = ['currency = $1'];
    const params = [currency];
    let idx = 2;
    let ftsParamIdx = 0;
    if (q) {
        // Use full-text search via search_vector; ILIKE fallback for short/exact queries
        ftsParamIdx = idx;
        conditions.push(`(search_vector @@ plainto_tsquery('english', $${idx}) OR name ILIKE $${idx + 1})`);
        params.push(q, `%${q}%`);
        idx += 2;
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
    const countQuery = `SELECT COUNT(*) FROM products ${whereClause}`;
    // When FTS query present, rank by ts_rank (uses same $param as WHERE clause)
    const orderBy = ftsParamIdx
        ? `ORDER BY ts_rank(search_vector, plainto_tsquery('english', $${ftsParamIdx})) DESC, updated_at DESC`
        : `ORDER BY updated_at DESC`;
    const dataQuery = `
      SELECT id, sku AS source_id, platform::text AS domain, product_url AS url,
             name AS title, price, currency, image_url, attributes AS metadata, updated_at
      FROM products
      ${whereClause}
      ${orderBy}
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limit, offset);
    const [countResult, dataResult] = await Promise.all([
        config_1.db.query(countQuery, params.slice(0, idx - 1)),
        config_1.db.query(dataQuery, params),
    ]);
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
    res.json({
        data: products,
        meta: {
            total,
            limit,
            offset,
            response_time_ms: responseTimeMs,
        },
    });
});
// GET /v1/products/:id
router.get('/:id', agentDetect_1.agentDetectMiddleware, apiKey_1.requireApiKey, apiKey_1.checkRateLimit, async (req, res) => {
    const start = Date.now();
    const { id } = req.params;
    const result = await config_1.db.query(`SELECT id, source_id, domain, url, title, price, currency, image_url, metadata, updated_at
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
        metadata: row.metadata,
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
