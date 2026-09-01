"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRICE_UNAVAILABLE_TEXT = exports.PRICE_SENTINEL_MIN = exports.COUNTRY_CURRENCY = exports.CURRENCY_RATES = void 0;
exports.isSentinelPrice = isSentinelPrice;
exports.formatPriceField = formatPriceField;
exports.formatSimilarPriceField = formatSimilarPriceField;
exports.regionForCountry = regionForCountry;
exports.buildProduct = buildProduct;
exports.buildSearchResponse = buildSearchResponse;
const affiliateWrapper_1 = require("./affiliateWrapper");
const instrumentation_1 = require("./instrumentation");
exports.CURRENCY_RATES = {
    // Convention: USD per 1 unit of the foreign currency (amount * rate = USD).
    USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79,
    // BUY-66199: EUR added so EUR-priced rows (e.g. .eu merchants mislabeled
    // country_code=US) can still normalize to USD. find_best_price already
    // exposes normalized_price_usd; search_products non-compact now does too.
    EUR: 1.09,
};
exports.COUNTRY_CURRENCY = {
    SG: 'SGD', US: 'USD', GB: 'GBP', VN: 'VND', TH: 'THB', MY: 'MYR',
};
// BUY-69998: Map ISO country codes to the coarse region labels agents expect
// (sea/us/global). Without this, mcp-railway search responses surfaced
// `country_code=US` rows tagged with `region=sg`, contradicting the FE/agent
// contract that branch on `region` to pick fulfillment logic. The downstream
// SQL filter remains on country_code; this is purely a response-shape fix.
exports.PRICE_SENTINEL_MIN = 10;
exports.PRICE_UNAVAILABLE_TEXT = 'see merchant (price unavailable in catalog) — click through to confirm';
function isSentinelPrice(amount) {
    return typeof amount !== 'number' || !Number.isFinite(amount) || amount < exports.PRICE_SENTINEL_MIN;
}
function formatPriceField(amount, currency) {
    if (isSentinelPrice(amount)) {
        return exports.PRICE_UNAVAILABLE_TEXT;
    }
    return { amount: amount, currency };
}
function formatSimilarPriceField(amount, currency) {
    return formatPriceField(amount, currency);
}
function regionForCountry(countryCode) {
    const cc = (countryCode || '').toUpperCase();
    if (!cc)
        return null;
    // BUY-69998: region is the lowercase ISO market, matching country_code.
    // Coarse labels like leftover `sg` shards must not contradict US/VN rows.
    return cc.toLowerCase();
}
function buildProduct(row, defaultCurrency, compact) {
    const currency = row.currency || defaultCurrency;
    const amount = row.price != null ? parseFloat(row.price) : null;
    const affiliateUrl = (0, affiliateWrapper_1.resolvePrecomputedAffiliateUrl)(row.affiliate_url);
    const productId = String(row.id);
    const merchant = row.domain || '';
    const isAmazonMerchant = merchant.toLowerCase().includes('amazon');
    const destinationUrl = affiliateUrl ?? row.url;
    // BUY-52474: every /v1 product response now carries tracking URLs so the FE
    // naturally routes user clicks through /r/ (logs affiliate_clicks) and /api/click
    // (logs clicks). The raw merchant URL is still in `url` for agents/SEO use;
    // `affiliate_url` keeps its precomputed wrapper when present.
    const clickUrl = destinationUrl
        ? (0, instrumentation_1.buildClickUrl)({ productId, destinationUrl, merchantId: merchant || null })
        : null;
    const affiliateRedirectUrl = destinationUrl
        ? (0, instrumentation_1.buildAffiliateRedirectUrl)({ productId, source: 'product_card' })
        : null;
    // BUY-66199: normalized_price_usd is computed for BOTH compact and
    // non-compact responses. Previously it was compact-only, so a US-market
    // search_products caller saw only the row's native currency (e.g. EUR for a
    // .eu merchant mislabeled country_code=US) with no USD reference — making
    // prices misleading. Mirrors find_best_price, which always exposes USD.
    const rate = exports.CURRENCY_RATES[currency] ?? null;
    const normalized_price_usd = amount != null && rate != null ? +(amount * rate).toFixed(4) : null;
    const base = {
        id: productId,
        title: row.title,
        price: formatPriceField(amount, currency), // string when sentinel, see BUY-65559
        normalized_price_usd,
        merchant,
        url: destinationUrl,
        image_url: row.image_url || null,
        // BUY-69998: derive region from country_code when the row is missing or
        // contradictory (mcp-railway used to surface `region=sg` on US rows,
        // confusing FE fulfilment logic). Keep the row's own region when present
        // AND consistent with the country_code; otherwise replace it.
        region: (() => {
            const rawRegion = row.region || null;
            const cc = (row.country_code || '').toUpperCase();
            const expected = regionForCountry(cc);
            if (!rawRegion || (expected && rawRegion.toLowerCase() !== expected)) {
                return expected ?? rawRegion;
            }
            return rawRegion;
        })(),
        country_code: row.country_code || null,
        updated_at: row.updated_at || null,
        // BUY-75368: A2 weekly-report needs url_last_checked_at + url_status on
        // every search result so Cart can compute the %-of-24h-fresh metric
        // straight off the response.
        ...(row.url_last_checked_at !== undefined && {
            url_last_checked_at: row.url_last_checked_at ?? null,
        }),
        ...(row.url_status !== undefined && {
            url_status: row.url_status ?? null,
        }),
        ...(isAmazonMerchant && row.updated_at != null && { price_as_of: row.updated_at }),
        ...(affiliateUrl != null && { affiliate_url: affiliateUrl }),
        ...(clickUrl != null && { click_url: clickUrl }),
        ...(affiliateRedirectUrl != null && { affiliate_redirect_url: affiliateRedirectUrl }),
    };
    if (compact) {
        const meta = row.metadata;
        const structured_specs = {};
        for (const k of ['brand', 'category', 'model', 'size', 'color', 'material', 'weight']) {
            const v = meta?.[k];
            if (v != null)
                structured_specs[k] = v;
        }
        const comparison_attributes = [];
        if (structured_specs.brand != null)
            comparison_attributes.push({ key: 'brand', label: 'Brand', value: structured_specs.brand });
        if (structured_specs.category != null)
            comparison_attributes.push({ key: 'category', label: 'Category', value: structured_specs.category });
        if (amount != null)
            comparison_attributes.push({ key: 'price', label: `Price (${currency})`, value: amount });
        if (structured_specs.model != null)
            comparison_attributes.push({ key: 'model', label: 'Model', value: structured_specs.model });
        if (structured_specs.color != null)
            comparison_attributes.push({ key: 'color', label: 'Color', value: structured_specs.color });
        base.canonical_id = row.id;
        base.structured_specs = structured_specs;
        base.comparison_attributes = comparison_attributes;
    }
    else {
        base.metadata = row.metadata;
    }
    if (row.original_price != null) {
        base.original_price = parseFloat(row.original_price);
    }
    if (row.discount_pct != null) {
        base.discount_pct = parseFloat(row.discount_pct);
    }
    return base;
}
function buildSearchResponse(products, total, limit, offset, responseTimeMs, cached, hasMore) {
    return {
        results: products,
        total,
        page: { limit, offset },
        response_time_ms: responseTimeMs,
        cached,
        ...(hasMore != null && { has_more: hasMore }),
    };
}
