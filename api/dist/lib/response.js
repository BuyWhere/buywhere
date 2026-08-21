"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_REGIONS = exports.COUNTRY_CURRENCY = exports.CURRENCY_RATES = void 0;
exports.getPriceBoundsForCurrency = getPriceBoundsForCurrency;
exports.evaluateNearMiss = evaluateNearMiss;
exports.buildProduct = buildProduct;
exports.buildSearchResponse = buildSearchResponse;
exports.deriveEmptiness = deriveEmptiness;
const affiliateWrapper_1 = require("./affiliateWrapper");
const instrumentation_1 = require("./instrumentation");
const fxRatesLoader_1 = require("./fxRatesLoader");
exports.CURRENCY_RATES = {
    USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79,
};
exports.COUNTRY_CURRENCY = {
    SG: 'SGD', US: 'USD', GB: 'GBP', VN: 'VND', TH: 'THB', MY: 'MYR',
    ID: 'IDR', PH: 'PHP', HK: 'HKD', TW: 'TWD', AU: 'AUD',
};
const PRICE_MIN_USD = 5;
const PRICE_MAX_USD = 10000;
/**
 * Return the native currency min/max bounds that correspond to the configured
 * USD-equivalent sanitizer band. Used by SQL sort tiers to keep sort order
 * consistent with serialized prices. Falls back to the sanitizer's old
 * hardcoded band when no rate is known.
 */
function getPriceBoundsForCurrency(currency) {
    const rate = (0, fxRatesLoader_1.getRate)(currency, exports.CURRENCY_RATES);
    if (rate != null && rate > 0) {
        return { min: Math.ceil(PRICE_MIN_USD / rate), max: Math.floor(PRICE_MAX_USD / rate) };
    }
    return { min: PRICE_MIN_USD, max: PRICE_MAX_USD };
}
const ISO_4217_RE = /^[A-Z]{3}$/;
const ISO_4217_CURRENCIES = new Set([
    'AUD', 'GBP', 'HKD', 'IDR', 'MYR', 'PHP', 'SGD', 'THB', 'TWD', 'USD', 'VND',
]);
const MINIMUM_UTILITY_ALLOWED_AVAILABILITY = new Set(['in_stock', 'out_of_stock', 'preorder', 'discontinued', 'unknown']);
function hiddenProductField(product, key) {
    return product[key];
}
function hasUsableImageUrl(imageUrl) {
    if (!imageUrl)
        return false;
    if (imageUrl.startsWith('data:image/svg+xml'))
        return true; // BUY-63954 branded SVG fallback
    return true; // BUY-63507 content probing is upstream; this hook consumes its selected URL.
}
function evaluateNearMiss(products, expectedCountryCode) {
    if (products.length !== 1)
        return { near_miss: false, near_miss_predicate_fails: [] };
    const product = products[0];
    const fails = [];
    const currency = product.price?.currency;
    const countryCode = (expectedCountryCode || product.country_code || '').toUpperCase();
    const expectedCurrency = exports.COUNTRY_CURRENCY[countryCode];
    if (product.price?.amount == null || product.price.amount <= 0 || (expectedCurrency && currency !== expectedCurrency)) {
        fails.push('price');
    }
    if (!currency || !ISO_4217_RE.test(currency) || !ISO_4217_CURRENCIES.has(currency)) {
        fails.push('currency');
    }
    if (!product.availability || !MINIMUM_UTILITY_ALLOWED_AVAILABILITY.has(product.availability.status)) {
        fails.push('availability');
    }
    if (!hasUsableImageUrl(product.image_url)) {
        fails.push('image_url');
    }
    if (!product.url || hiddenProductField(product, 'url_status') === 'dead') {
        fails.push('merchant_url');
    }
    return { near_miss: fails.length > 0, near_miss_predicate_fails: fails };
}
function normalizeImageUrl(imageUrl) {
    if (typeof imageUrl !== 'string' || imageUrl.trim() === '')
        return null;
    try {
        const parsed = new URL(imageUrl);
        if (parsed.hostname.toLowerCase() === 'source.unsplash.com')
            return null;
    }
    catch {
        return imageUrl;
    }
    return imageUrl;
}
// F2 (2026-08-18): Amazon Associates monetization — outbound amazon.com URLs get
// our tracking tag when none is present. Applied at serialization so url,
// click_url and affiliate redirects all inherit it. amazon.sg intentionally
// EXCLUDED until the separate buywhere-22 account is confirmed (ledger R3).
// buywhere-20 (US) and buywhere-22 (SG) are one linked account (Richmond,
// 2026-08-18); reporting is per-program, so each storefront must carry ITS tag.
// The correct tag is FORCED — this also repairs precomputed affiliate links that
// were bulk-built in April with the US tag on amazon.sg. Other-country amazon
// domains are left untouched (no program tag for them yet).
const AMAZON_TAGS = {
    'amazon.com': 'buywhere-20',
    'amazon.sg': 'buywhere-22',
};
function wrapAmazonAffiliateTag(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        for (const [domain, tag] of Object.entries(AMAZON_TAGS)) {
            if (host === domain || host.endsWith('.' + domain)) {
                if (u.searchParams.get('tag') !== tag) {
                    u.searchParams.set('tag', tag);
                    return u.toString();
                }
                break;
            }
        }
    }
    catch { /* malformed URL — pass through untouched */ }
    return url;
}
function buildProduct(row, defaultCurrency, compact, 
// BUY-71129: caller context for thread-through attribution. The api_key_id
// + key_hash travel with /r/ and /api/click URLs as `?k=` + `?aid=` so the
// redirect handler can attribute the conversion back to the originating
// agent even when the browser click carries no Bearer header.
caller) {
    const currency = row.currency || defaultCurrency;
    const amount = row.price != null ? parseFloat(row.price) : null;
    // BUY-60385 / BUY-71393 / BUY-71419: Sanitize anomalous prices.
    // CURRENCY_RATES are USD per 1 unit of foreign currency.
    // - Upper bound is always USD-equivalent when a rate is known, so high-value
    //   currencies (SGD 10,799 ≈ USD 7,991) are not wrongly capped at 10,000 native.
    // - Lower bound is currency-aware: USD still uses the $5 floor that catches
    //   $1 laptop feed errors, while non-USD currencies use a native floor of 1
    //   so legitimate low-cost accessories (PHP 125-250 ≈ USD 2-4) are not hidden.
    // When validation fails the amount is nullified so the FE displays nothing
    // instead of a deceptive value.
    const rate = (0, fxRatesLoader_1.getRate)(currency, (0, fxRatesLoader_1.getCachedFxRates)());
    const usdEquivalent = amount != null && rate != null ? amount * rate : null;
    const minNative = currency === 'USD' ? PRICE_MIN_USD : 1;
    const maxNative = (usdEquivalent != null
        ? Math.floor(PRICE_MAX_USD / rate)
        : PRICE_MAX_USD);
    const sanitizedAmount = (amount != null &&
        Number.isFinite(amount) &&
        amount >= minNative &&
        amount <= maxNative &&
        (currency === 'USD' || usdEquivalent == null || usdEquivalent <= PRICE_MAX_USD)) ? amount : null;
    const affiliateUrl = (0, affiliateWrapper_1.resolvePrecomputedAffiliateUrl)(row.affiliate_url);
    const productId = String(row.id);
    const merchant = row.domain || '';
    const destinationUrl = wrapAmazonAffiliateTag(affiliateUrl ?? row.url);
    // BUY-52474: every /v1 product response now carries tracking URLs so the FE
    // naturally routes user clicks through /r/ (logs affiliate_clicks) and /api/click
    // (logs clicks). The raw merchant URL is still in `url` for agents/SEO use;
    // `affiliate_url` keeps its precomputed wrapper when present.
    // BUY-71129: thread `k` (api_key hash) + `aid` (api_key_id) when caller has
    // an authenticated key, so the redirect handler can attribute the eventual
    // conversion event back to the originating agent.
    const clickUrl = destinationUrl
        ? (0, instrumentation_1.buildClickUrl)({
            productId,
            destinationUrl,
            merchantId: merchant || null,
            keyHash: caller?.keyHash ?? null,
            agentId: caller?.apiKeyId ?? null,
        })
        : null;
    const affiliateRedirectUrl = destinationUrl
        ? (0, instrumentation_1.buildAffiliateRedirectUrl)({
            productId,
            source: 'product_card',
            keyHash: caller?.keyHash ?? null,
            agentId: caller?.apiKeyId ?? null,
        })
        : null;
    const hasAffiliateTracking = Boolean(affiliateUrl || affiliateRedirectUrl);
    const inStock = row.in_stock != null
        ? row.in_stock
        : sanitizedAmount != null && sanitizedAmount > 0;
    const base = {
        id: productId,
        title: row.title,
        price: { amount: sanitizedAmount, currency },
        merchant,
        url: destinationUrl,
        image_url: normalizeImageUrl(row.image_url),
        region: row.region || null,
        country_code: row.country_code || null,
        updated_at: row.updated_at || null,
        // BUY-71396: expose render-gate freshness for A2 metric
        url_last_checked_at: row.url_last_checked_at || null,
        // CAT-08: expose stock status as a top-level boolean when known.
        ...(row.in_stock != null && { in_stock: row.in_stock }),
        // BUY-70574/BUY-70043: basket verification consumes availability.in_stock.
        // When feeds omit explicit stock, positive-price catalog rows are minimally
        // considered available so agent commerce flows have a usable availability signal.
        availability: {
            in_stock: inStock,
            status: inStock ? 'in_stock' : 'out_of_stock',
        },
        ...(affiliateUrl != null && { affiliate_url: affiliateUrl }),
        ...(clickUrl != null && { click_url: clickUrl }),
        ...(affiliateRedirectUrl != null && { affiliate_redirect_url: affiliateRedirectUrl }),
        has_affiliate_tracking: hasAffiliateTracking,
        is_affiliate: hasAffiliateTracking,
        ...(hasAffiliateTracking && {
            affiliate_disclosure: 'BuyWhere may earn a commission from purchases made through tracked product links.',
        }),
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
        const rates = (0, fxRatesLoader_1.getCachedFxRates)();
        const rate = rates[currency] ?? exports.CURRENCY_RATES[currency] ?? null;
        const normalized_price_usd = amount != null && rate != null ? +(amount * rate).toFixed(4) : null;
        base.canonical_id = row.id;
        base.normalized_price_usd = normalized_price_usd;
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
    Object.defineProperty(base, 'url_status', {
        value: row.url_status ?? null,
        enumerable: false,
    });
    return base;
}
function buildSearchResponse(products, total, limit, offset, responseTimeMs, cached, degraded, hasMore, expectedCountryCode) {
    const nearMiss = evaluateNearMiss(products, expectedCountryCode);
    return {
        // BUY-71275: preserve stable agent contract while staying compatible with
        // newer REST envelopes; all aliases point to the same array reference.
        products,
        results: products,
        items: products,
        data: products,
        meta: {
            total,
            limit,
            offset,
            response_time_ms: responseTimeMs,
            cached,
            near_miss: nearMiss.near_miss,
            near_miss_predicate_fails: nearMiss.near_miss_predicate_fails,
            ...(degraded != null && { degraded }),
            ...(hasMore != null && { has_more: hasMore }),
        },
    };
}
/** Known country codes the catalog actively indexes (covers all 5 SEA + US). */
exports.SUPPORTED_REGIONS = new Set(['SG', 'US', 'MY', 'TH', 'VN', 'PH', 'ID']);
/**
 * Determine emptiness_reason + confidence + diagnostic from observed signals.
 *
 * Heuristics (per spec §4):
 * - api_error  ⇒ reason=api_error, confidence=low, engine_status=error.
 * - rateLimited ⇒ reason=quota, confidence=low, engine_status=degraded.
 * - region not supported ⇒ reason=region_unsupported, confidence=low.
 * - region supported but no rows at all ⇒ reason=no_data, confidence=high.
 * - category requested but no rows for category ⇒ reason=category_unsupported,
 *   confidence=low (caller may want to widen the query).
 * - region has rows but query/filters exclude all of them ⇒ reason=no_match,
 *   confidence=high.
 */
function deriveEmptiness(signals) {
    if (signals.apiError) {
        return {
            emptiness_reason: 'api_error',
            confidence: 'low',
            diagnostic: {
                engine_status: 'error',
                indexed_for_region: signals.regionSupported,
                category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
                rate_limit_remaining: signals.rateLimitRemaining ?? null,
            },
        };
    }
    if (signals.rateLimited) {
        return {
            emptiness_reason: 'quota',
            confidence: 'low',
            diagnostic: {
                engine_status: 'degraded',
                indexed_for_region: signals.regionSupported,
                category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
                rate_limit_remaining: signals.rateLimitRemaining ?? 0,
            },
        };
    }
    if (signals.requestedCountry && !signals.regionSupported) {
        return {
            emptiness_reason: 'region_unsupported',
            confidence: 'low',
            diagnostic: {
                engine_status: 'ok',
                indexed_for_region: false,
                category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
                rate_limit_remaining: signals.rateLimitRemaining ?? null,
            },
        };
    }
    if (signals.categoryRequested && signals.regionHasAnyData && !signals.categoryHasAnyData) {
        return {
            emptiness_reason: 'category_unsupported',
            confidence: 'low',
            diagnostic: {
                engine_status: 'ok',
                indexed_for_region: true,
                category_recognized: false,
                rate_limit_remaining: signals.rateLimitRemaining ?? null,
            },
        };
    }
    if (!signals.regionHasAnyData) {
        return {
            emptiness_reason: 'no_data',
            confidence: 'high',
            diagnostic: {
                engine_status: 'ok',
                indexed_for_region: signals.regionSupported,
                category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
                rate_limit_remaining: signals.rateLimitRemaining ?? null,
            },
        };
    }
    return {
        emptiness_reason: 'no_match',
        confidence: 'high',
        diagnostic: {
            engine_status: 'ok',
            indexed_for_region: true,
            category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
            rate_limit_remaining: signals.rateLimitRemaining ?? null,
        },
    };
}
