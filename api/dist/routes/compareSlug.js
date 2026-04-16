"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const posthog_1 = require("../analytics/posthog");
const router = (0, express_1.Router)();
const CACHE_TTL_SECONDS = 300; // 5 min
// Slug validation: kebab-case ASCII, ≤70 chars
function isValidSlug(slug) {
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 70;
}
function buildStructuredData(page, prices, base) {
    const product = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: page.title,
        description: page.description,
        image: page.hero_image_url || page.image_url,
        brand: page.brand ? { '@type': 'Brand', name: page.brand } : undefined,
        gtin: page.gtin || undefined,
        offers: prices.length > 0 ? {
            '@type': 'AggregateOffer',
            priceCurrency: 'SGD',
            lowPrice: prices.length ? prices[0].price_sgd : undefined,
            highPrice: prices.length ? prices[prices.length - 1].price_sgd : undefined,
            offerCount: prices.length,
            offers: prices.map((p) => ({
                '@type': 'Offer',
                priceCurrency: 'SGD',
                price: p.price_sgd,
                availability: p.availability === 'out_of_stock'
                    ? 'https://schema.org/OutOfStock'
                    : p.availability === 'preorder'
                        ? 'https://schema.org/PreOrder'
                        : 'https://schema.org/InStock',
                url: p.affiliate_url || p.url,
                seller: { '@type': 'Organization', name: p.retailer_name, url: p.retailer_domain ? `https://${p.retailer_domain}` : undefined },
            })),
        } : undefined,
    };
    const breadcrumb = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: base },
            { '@type': 'ListItem', position: 2, name: 'Compare', item: `${base}/compare` },
            { '@type': 'ListItem', position: 3, name: String(page.category_label || page.category), item: `${base}/compare?category=${page.category}` },
            { '@type': 'ListItem', position: 4, name: String(page.title) },
        ],
    };
    const ld = [product, breadcrumb];
    const metadata = page.metadata;
    if (metadata?.faq && Array.isArray(metadata.faq)) {
        ld.push({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: metadata.faq.map((item) => ({
                '@type': 'Question',
                name: item.q,
                acceptedAnswer: { '@type': 'Answer', text: item.a },
            })),
        });
    }
    return ld;
}
// GET /v1/compare/:slug — public comparison page payload
// 5-min Redis cache; 404 on draft/archived/missing
router.get('/:slug', async (req, res) => {
    const { slug } = req.params;
    if (!isValidSlug(slug)) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const cacheKey = `compare:slug:${slug}`;
    // Try Redis cache first
    try {
        const cached = await config_1.redis.get(cacheKey);
        if (cached) {
            res.set('X-Cache', 'HIT');
            res.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`);
            res.set('X-Robots-Tag', 'ai-index');
            res.json(JSON.parse(cached));
            return;
        }
    }
    catch (_err) {
        // Redis unavailable — proceed without cache
    }
    // Fetch comparison page joined with product
    const pageResult = await config_1.db.query(`SELECT
       cp.id, cp.slug, cp.category, cp.status, cp.expert_summary,
       cp.hero_image_url, cp.published_at, cp.metadata, cp.product_id,
       p.name AS title, p.brand, p.gtin, p.image_url, p.description,
       p.category_path, p.metadata AS product_metadata
     FROM comparison_pages cp
     JOIN products p ON p.id = cp.product_id
     WHERE cp.slug = $1 AND cp.status = 'published'`, [slug]).catch(() => null);
    if (!pageResult || pageResult.rows.length === 0) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const page = pageResult.rows[0];
    // Fetch non-OOS retailer prices first, fall back to all if all are OOS
    let pricesResult = await config_1.db.query(`SELECT
       rp.price_sgd, rp.availability, rp.url, rp.captured_at,
       r.name AS retailer_name, r.logo_url AS retailer_logo, r.domain AS retailer_domain,
       al.affiliate_url
     FROM retailer_prices rp
     JOIN retailers r ON r.id = rp.retailer_id
     LEFT JOIN affiliate_links al ON al.retailer_id = rp.retailer_id AND al.product_id = rp.product_id
     WHERE rp.product_id = $1 AND rp.availability != 'out_of_stock'
     ORDER BY rp.price_sgd ASC`, [page.product_id]).catch(() => null);
    // If no in-stock prices, include OOS as fallback
    if (!pricesResult || pricesResult.rows.length === 0) {
        pricesResult = await config_1.db.query(`SELECT
         rp.price_sgd, rp.availability, rp.url, rp.captured_at,
         r.name AS retailer_name, r.logo_url AS retailer_logo, r.domain AS retailer_domain,
         al.affiliate_url
       FROM retailer_prices rp
       JOIN retailers r ON r.id = rp.retailer_id
       LEFT JOIN affiliate_links al ON al.retailer_id = rp.retailer_id AND al.product_id = rp.product_id
       WHERE rp.product_id = $1
       ORDER BY rp.price_sgd ASC`, [page.product_id]).catch(() => null);
    }
    const prices = pricesResult?.rows ?? [];
    const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.get('host') || '';
    const base = `${proto}://${host}`;
    const lowestPrice = prices.length > 0 ? prices[0] : null;
    const payload = {
        slug: page.slug,
        category: page.category,
        product: {
            id: page.product_id,
            title: page.title,
            brand: page.brand,
            gtin: page.gtin,
            description: page.description,
            image_url: page.hero_image_url || page.image_url,
            category_path: page.category_path,
            specs: page.product_metadata?.specs ?? null,
        },
        expert_summary: page.expert_summary,
        published_at: page.published_at,
        prices: prices.map((p) => ({
            retailer: p.retailer_name,
            retailer_logo: p.retailer_logo,
            retailer_domain: p.retailer_domain,
            price_sgd: p.price_sgd ? parseFloat(String(p.price_sgd)) : null,
            availability: p.availability,
            url: p.affiliate_url || p.url,
            captured_at: p.captured_at,
        })),
        lowest_price: lowestPrice ? {
            retailer: lowestPrice.retailer_name,
            price_sgd: lowestPrice.price_sgd ? parseFloat(String(lowestPrice.price_sgd)) : null,
        } : null,
        metadata: page.metadata,
        structured_data: buildStructuredData(page, prices, base),
        seo: {
            title: `Compare ${page.brand ? `${page.brand} ` : ''}${page.title} prices across ${prices.length} Singapore retailers — BuyWhere`,
            description: `Find the best price for ${page.title} in Singapore. Compare live prices${prices.length > 0 ? ` from ${prices.slice(0, 3).map((p) => p.retailer_name).join(', ')}` : ''}. Updated ${new Date(page.published_at).toISOString().slice(0, 10)}.`.slice(0, 155),
            canonical: `${base}/compare/${slug}`,
        },
    };
    // Cache in Redis
    try {
        await config_1.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(payload));
    }
    catch (_err) {
        // Non-fatal
    }
    // PostHog: fire-and-forget page view
    (0, posthog_1.trackComparePageView)({
        slug: String(page.slug),
        productId: String(page.product_id),
        category: String(page.category),
        retailerCount: prices.length,
        lowestPrice: lowestPrice?.price_sgd ? parseFloat(String(lowestPrice.price_sgd)) : null,
    });
    res.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`);
    res.set('X-Cache', 'MISS');
    res.set('X-Robots-Tag', 'ai-index');
    res.json(payload);
});
// POST /v1/compare/:slug/click — record a retailer click for PostHog analytics.
// Body: { retailer: string, price: number|null, rank: number }
// Falls back gracefully if PostHog is not configured.
router.post('/:slug/click', (req, res) => {
    const { slug } = req.params;
    const { retailer, price, rank } = req.body;
    if (!isValidSlug(slug) || typeof retailer !== 'string' || typeof rank !== 'number') {
        res.status(400).json({ error: 'Missing required fields: retailer (string), rank (number)' });
        return;
    }
    (0, posthog_1.trackCompareRetailerClick)({
        slug,
        retailer,
        price: price ?? null,
        rank,
    });
    res.json({ ok: true });
});
exports.default = router;
