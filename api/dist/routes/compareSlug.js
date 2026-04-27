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
            lowPrice: prices.length ? prices[0].price : undefined,
            highPrice: prices.length ? prices[prices.length - 1].price : undefined,
            offerCount: prices.length,
            offers: prices.map((p) => ({
                '@type': 'Offer',
                priceCurrency: 'SGD',
                price: p.price,
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
// Maps product.source strings to display name, domain, and region.
function retailerMeta(source) {
    const s = (source || '').toLowerCase();
    if (s.includes('fairprice'))
        return { name: 'FairPrice', domain: 'fairprice.com.sg', region: 'SG' };
    if (s.includes('challenger'))
        return { name: 'Challenger', domain: 'challenger.com.sg', region: 'SG' };
    if (s.includes('lazada'))
        return { name: 'Lazada', domain: 'lazada.sg', region: 'SG' };
    if (s === 'amazon_sg')
        return { name: 'Amazon SG', domain: 'amazon.sg', region: 'SG' };
    if (s === 'amazon_us' || s === 'amazon')
        return { name: 'Amazon US', domain: 'amazon.com', region: 'US' };
    if (s.includes('shopee'))
        return { name: 'Shopee', domain: 'shopee.sg', region: 'SG' };
    if (s.includes('bestdenki') || s.includes('best_denki'))
        return { name: 'Best Denki', domain: 'bestdenki.com.sg', region: 'SG' };
    if (s.includes('popular'))
        return { name: 'Popular', domain: 'popular.com.sg', region: 'SG' };
    if (s.includes('courts'))
        return { name: 'Courts', domain: 'courts.com.sg', region: 'SG' };
    if (s.includes('_vn') || s.includes('vn_'))
        return { name: source, domain: source, region: 'VN' };
    if (s.includes('_th') || s.includes('th_'))
        return { name: source, domain: source, region: 'TH' };
    if (s.includes('_my') || s.includes('my_'))
        return { name: source, domain: source, region: 'MY' };
    return { name: source, domain: source, region: 'SG' };
}
function formatPrice(price) {
    return `S$${price.toFixed(2)}`;
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
    // Fetch comparison page
    const pageResult = await config_1.db.query(`SELECT id, slug, category, status, expert_summary, hero_image_url,
            published_at, metadata, product_ids
     FROM comparison_pages
     WHERE slug = $1 AND status = 'published'`, [slug]).catch(() => null);
    if (!pageResult || pageResult.rows.length === 0) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const page = pageResult.rows[0];
    const productIds = (page.product_ids || []).filter((id) => typeof id === 'string' && id.length > 0);
    if (productIds.length === 0) {
        res.status(404).json({ error: 'No products linked' });
        return;
    }
    // Fetch all products in this comparison group, ordered by SGD price ascending
    const productsResult = await config_1.db.query(`SELECT id, title, brand, image_url, description, category_path,
            price, currency, url, source, is_active, updated_at
     FROM products
     WHERE id = ANY($1::uuid[]) AND url IS NOT NULL
     ORDER BY price::numeric ASC NULLS LAST`, [productIds]).catch(() => null);
    const rows = productsResult?.rows ?? [];
    const canonical = rows[0]; // used for product card (first/cheapest row)
    const proto = (req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.get('host') || '';
    const base = `${proto}://${host}`;
    // Build retailers array matching Frame's RetailerPrice type
    const retailers = rows.map((p, i) => {
        const priceNum = p.price ? parseFloat(p.price) : null;
        const lowestPriceNum = rows[0]?.price ? parseFloat(rows[0].price) : null;
        const meta = retailerMeta(p.source);
        const avail = (p.is_active === false) ? 'out_of_stock' : 'in_stock';
        return {
            retailer_id: p.source,
            retailer_name: meta.name,
            retailer_logo_url: `https://logo.clearbit.com/${meta.domain}`,
            retailer_domain: meta.domain,
            region: meta.region,
            price: priceNum,
            price_formatted: priceNum !== null ? formatPrice(priceNum) : 'N/A',
            availability: avail,
            availability_label: avail === 'in_stock' ? 'In Stock' : 'Out of Stock',
            url: p.url,
            delta_vs_lowest: (priceNum !== null && lowestPriceNum !== null && i > 0)
                ? parseFloat((priceNum - lowestPriceNum).toFixed(2))
                : 0,
        };
    });
    const lowestRetailer = retailers[0] ?? null;
    const lowestPriceNum = lowestRetailer?.price ?? null;
    const meta = page.metadata;
    const faq = Array.isArray(meta?.faq)
        ? meta.faq.map((f) => ({ question: f.q, answer: f.a }))
        : [];
    const specs = [];
    const payload = {
        slug: page.slug,
        product_id: String(canonical?.id ?? productIds[0]),
        category: page.category,
        canonical_url: `${base}/compare/${slug}`,
        product: {
            id: String(canonical?.id ?? productIds[0]),
            title: canonical?.title ?? slug,
            brand: canonical?.brand ?? null,
            gtin: null,
            description: canonical?.description ?? null,
            image_url: page.hero_image_url || canonical?.image_url || null,
            category_path: canonical?.category_path ?? [],
            specs,
        },
        retailers,
        lowest_price: lowestPriceNum,
        lowest_price_formatted: lowestPriceNum !== null ? formatPrice(lowestPriceNum) : 'N/A',
        lowest_price_retailer: lowestRetailer?.retailer_name ?? null,
        expert_summary: page.expert_summary,
        faq,
        related_comparisons: [], // populated by a future query or left empty for v1
        metadata: {
            updated_at: canonical?.updated_at ?? new Date().toISOString(),
            published_at: page.published_at ?? undefined,
        },
        breadcrumb: [
            { name: 'Home', url: base },
            { name: 'Compare', url: `${base}/compare` },
            { name: page.category.charAt(0).toUpperCase() + page.category.slice(1), url: `${base}/compare?category=${page.category}` },
            { name: canonical?.title ?? slug, url: `${base}/compare/${slug}` },
        ],
        structured_data: buildStructuredData({ ...page, title: canonical?.title, brand: canonical?.brand, image_url: page.hero_image_url || canonical?.image_url }, retailers.map((r) => ({ price: r.price, availability: r.availability, url: r.url, retailer_name: r.retailer_name, retailer_domain: r.retailer_domain })), base),
        seo: {
            title: `Compare ${canonical?.brand ? `${canonical.brand} ` : ''}${canonical?.title ?? slug} prices across ${retailers.length} Singapore retailers — BuyWhere`,
            description: `Find the best price for ${canonical?.title ?? slug} in Singapore. Compare live prices${retailers.length > 0 ? ` from ${retailers.slice(0, 3).map((r) => r.retailer_name).join(', ')}` : ''}${lowestPriceNum ? `. From ${formatPrice(lowestPriceNum)}` : ''}.`.slice(0, 155),
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
        productId: String(canonical?.id ?? productIds[0]),
        category: String(page.category),
        retailerCount: retailers.length,
        lowestPrice: lowestPriceNum,
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
