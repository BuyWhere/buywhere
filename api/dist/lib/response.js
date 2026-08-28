"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_REGIONS = exports.COUNTRY_CURRENCY = exports.CURRENCY_RATES = void 0;
exports.buildProduct = buildProduct;
exports.buildSearchResponse = buildSearchResponse;
exports.deriveEmptiness = deriveEmptiness;
const affiliateWrapper_1 = require("./affiliateWrapper");
const instrumentation_1 = require("./instrumentation");
const fxRatesLoader_1 = require("./fxRatesLoader");
exports.CURRENCY_RATES = {
    USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79,
};
// BUY-73753: include every active market code so the LIST/SIMILAR/DEALS
// paths can build a `WHERE currency = $1 AND country_code = $2` predicate
// that matches the rows actually stored under that country. Without a
// mapping, the fallback ('SGD') used to mismatch on PH/ID/JP/DE/AU and
// the planner was full-scanning for non-SG/US cohorts. Active set is
// the union of the openapi /mcp enum, the fleet onboarding targets, and
// the BUY-73330 gate probe; expand deliberately (any value absent here
// silently returns zero rows + a 30s seq-scan timeout).
exports.COUNTRY_CURRENCY = {
    SG: 'SGD', US: 'USD', GB: 'GBP', UK: 'GBP', VN: 'VND', TH: 'THB', MY: 'MYR',
    PH: 'PHP', ID: 'IDR', JP: 'JPY', DE: 'EUR', AU: 'AUD',
    // Single-currency regions stored under EUR/USD on the catalog:
    FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', IE: 'EUR', CA: 'CAD', MX: 'MXN', BR: 'BRL',
};
// BUY-72693: reject ASIN-derived image URLs from Amazon CDN.
// Synthetic rows carry image URLs like:
//   https://m.media-amazon.com/images/I/B10162255701._AC_SY360_.jpg
// where "B10162255701" is a fabricated 12-char key (ASIN + "01" suffix).
// Real Amazon media keys are base64-encoded (e.g. "71jG+e7roXL"), not
// "B" + digit sequences. Nulling the image_url here blocks 400s at the API
// level for ANY consumer of /v1/products/search (including MCP tools and
// third-party callers), not just the Next.js search UI.
function normalizeImageUrl(imageUrl) {
    if (typeof imageUrl !== 'string' || imageUrl.trim() === '')
        return null;
    try {
        const parsed = new URL(imageUrl);
        const hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname.toLowerCase();
        if (hostname === 'source.unsplash.com')
            return null;
        // BUY-72693: fail-closed on Amazon ASIN-derived media keys.
        if (hostname === 'm.media-amazon.com' || hostname.endsWith('.media-amazon.com')) {
            const imgMatch = pathname.match(/^\/images\/i\/([^/.]+)\./);
            if (imgMatch) {
                const mediaKey = imgMatch[1];
                // Reject "B" + ≥10 digits (with optional _XX suffix) — synthetic ASIN shape.
                if (/^b\d{10,}(?:_\d+)?$/.test(mediaKey))
                    return null;
            }
        }
    }
    catch {
        return imageUrl;
    }
    return imageUrl;
}
function buildProduct(row, defaultCurrency, compact, 
// BUY-74689: optional batched lookup from `merchants.id` → {name, slug}. Callers that
// resolve the map (every product-emitting handler) pass it in; legacy call sites
// pass nothing and get `merchantName: null` (same as an orphaned merchant_id). The
// platform slug (`merchant` / `source`) is preserved unchanged.
merchantMap) {
    const currency = row.currency || defaultCurrency;
    const amount = row.price != null ? parseFloat(row.price) : null;
    // BUY-60385: Sanitize anomalous prices from upstream affiliate/feed partners.
    // Validation catches two categories of data-quality failures observed in production:
    //   1. $0.00 prices — out-of-stock marker, missing price field, or parsing error
    //   2. Prices over $10,000 — feed corruption, currency conversion unit errors
    //   3. BUY-63738: Prices under $5 — observed $1.00 laptop prices are clearly
    //      invalid feed errors; real laptops start at ~$400. A $5 floor catches the
    //      obvious errors while still allowing cheap accessories ($2-3 cables, etc.).
    // Legitimate high-end products (luxury watches, high-end appliances, jewelry)
    // stay under $10k. When a price fails validation the amount is nullified so
    // the FE displays nothing instead of a deceptive value.
    const PRICE_MIN = 5;
    const PRICE_MAX = 10000;
    const sanitizedAmount = (amount != null && amount >= PRICE_MIN && amount <= PRICE_MAX)
        ? amount
        : null;
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
    const hasAffiliateTracking = Boolean(affiliateUrl || affiliateRedirectUrl);
    const base = {
        id: productId,
        title: row.title,
        price: { amount: sanitizedAmount, currency },
        merchant,
        url: destinationUrl,
        image_url: normalizeImageUrl(row.image_url),
        region: row.region || null,
        country_code: row.country_code || null,
        category_path: Array.isArray(row.category_path) ? row.category_path : null,
        updated_at: row.updated_at || null,
        // BUY-74689: merchant_id from the row, real storefront name from the batched
        // merchants lookup. `merchant` / `merchant_id` (platform slug) preserved for
        // filtering and analytics — emit the resolved name only when the row exists.
        merchant_id: row.merchant_id || null,
        merchant_name: (() => {
            const mid = row.merchant_id || '';
            const entry = mid && merchantMap ? merchantMap[mid] : undefined;
            return entry?.name ?? null;
        })(),
        merchant_slug: (() => {
            const mid = row.merchant_id || '';
            const entry = mid && merchantMap ? merchantMap[mid] : undefined;
            return entry?.slug || null;
        })(),
        // BUY-74732: resolve scraped_via with explicit precedence — the row's own
        // column (catalog may stamp per-product), then the merchant's row
        // (legacy where only the merchant-level flag is set), then null. The FE
        // `<MerchantBadge>` renders ✓ only when the value is `'first_party'`.
        scraped_via: (() => {
            const rowSv = row.scraped_via;
            if (typeof rowSv === 'string' && rowSv.trim())
                return rowSv.trim();
            const mid = row.merchant_id || '';
            const entry = mid && merchantMap ? merchantMap[mid] : undefined;
            return entry?.scraped_via ?? null;
        })(),
        // CAT-08: expose stock status as a top-level boolean when known.
        ...(row.in_stock != null && { in_stock: row.in_stock }),
        ...(isAmazonMerchant && row.updated_at != null && { price_as_of: row.updated_at }),
        // BUY-75368: A2 weekly-report metric (% search responses carrying a
        // url_last_checked_at within 24h). Always emit the field (null when
        // never checked) so consumers can rely on its presence.
        ...(row.url_last_checked_at !== undefined && {
            url_last_checked_at: row.url_last_checked_at ?? null,
        }),
        ...(row.url_status !== undefined && {
            url_status: row.url_status ?? null,
        }),
        ...(affiliateUrl != null && { affiliate_url: affiliateUrl }),
        ...(clickUrl != null && { click_url: clickUrl }),
        ...(affiliateRedirectUrl != null && { affiliate_redirect_url: affiliateRedirectUrl }),
        has_affiliate_tracking: hasAffiliateTracking,
        is_affiliate: hasAffiliateTracking,
        ...(hasAffiliateTracking && {
            affiliate_disclosure: 'BuyWhere may earn a commission from purchases made through tracked product links.',
        }),
        // BUY-74262: expose the raw `source` column alongside the `merchant` alias.
        // The `source` column holds the retailer/feed origin (e.g. "amazon_us",
        // "shopify"). `merchant` is the same value but mapped from the `domain` alias
        // for backward compatibility. Agents filtering by `?source=...` need the
        // explicit `source` key in the response to verify the filter took effect.
        source: row.source || null,
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
    return base;
}
// BUY-71542 / P2.6 + BUY-72044 / P2.6A: optional P2.6 envelope. When the response is empty AND the caller derived an emptiness reason, attach the emptiness_reason/confidence/diagnostic triplet to meta. Non-empty responses ignore this (reasons are only meaningful for empty results).
function buildSearchResponse(products, total, limit, offset, responseTimeMs, cached, degraded, hasMore, expectedCountryCode, emptiness) {
    const isEmpty = products.length === 0;
    const status = degraded ? 'degraded' : undefined;
    return {
        data: products,
        // F33 (2026-08-22): products/results/items are CONTRACT aliases of data — clients
        // integrated against response.products broke when the envelope went data-only.
        // By-reference aliases; keep all four until a versioned deprecation.
        products,
        results: products,
        items: products,
        meta: {
            total,
            limit,
            offset,
            response_time_ms: responseTimeMs,
            cached,
            ...(degraded != null && { degraded }),
            ...(status && { status }),
            ...(hasMore != null && { has_more: hasMore }),
            // BUY-71542 / P2.6 + BUY-72044 / P2.6A: surface the empty-result triplet
            // when (a) the caller derived one and (b) the response is genuinely empty.
            // Non-empty responses MUST NOT carry an emptiness_reason per spec §2.1.
            ...(isEmpty && emptiness && {
                emptiness_reason: emptiness.emptiness_reason,
                confidence: emptiness.confidence,
                diagnostic: emptiness.diagnostic,
                degraded_kind: emptiness.degraded_kind,
                ...(emptiness.degraded_kind && { degraded_reason: emptiness.diagnostic.timed_out_stage ?? 'catalog_search' }),
            }),
        },
    };
}
/** Known country codes the catalog actively indexes (covers all 5 SEA + US). */
exports.SUPPORTED_REGIONS = new Set(['SG', 'US', 'MY', 'TH', 'VN', 'PH', 'ID']);
/**
 * Determine emptiness_reason + confidence + diagnostic from observed signals.
 *
 * Heuristics (per spec §4, plus BUY-72044 / P2.6A amendment):
 * - api_error  ⇒ reason=api_error, confidence=low, engine_status=error.
 * - rateLimited ⇒ reason=quota, confidence=low, engine_status=degraded.
 * - region not supported ⇒ reason=region_unsupported, confidence=low.
 * - category requested but no rows for category ⇒ reason=category_unsupported,
 *   confidence=low (caller may want to widen the query).
 * - region supported but no rows at all ⇒ reason=no_data, confidence=high.
 * - region has rows but query/filters exclude all of them ⇒ reason=no_match,
 *   confidence=high.
 * - BUY-72044 / P2.6A: caller omitted deliver_to/country_code/country AND the
 *   unfiltered probe found at least one matching row somewhere ⇒ reason=deliver_to_missing.
 *   `confidence=low` when the query is ambiguous AND the catalog has ≤5 matching
 *   rows (caller may need to widen); otherwise `confidence=high`.
 */
function deriveEmptiness(signals) {
    // BUY-72044 / P2.6A: diagnostic.deliver_to_present is populated on every branch
    // (true|false, never null) so the agent can verify the engine saw the absence
    // of a buyer-market filter.
    const baseDiag = {
        deliver_to_present: signals.deliverToPresent,
    };
    // BUY-74597: timeout / auth failure / circuit open / upstream exception take
    // precedence over other empty-result heuristics. They always return
    // status=degraded, confidence=low, and a stage diagnostic.
    if (signals.degradedKind === 'timeout' || signals.degradedKind === 'partial_timeout') {
        return {
            emptiness_reason: signals.degradedKind,
            confidence: 'low',
            diagnostic: {
                engine_status: 'degraded',
                indexed_for_region: signals.regionSupported,
                category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
                rate_limit_remaining: signals.rateLimitRemaining ?? null,
                timed_out_stage: signals.timedOutStage ?? null,
                ...baseDiag,
            },
            degraded_kind: signals.degradedKind,
        };
    }
    if (signals.degradedKind === 'auth_failure') {
        return {
            emptiness_reason: 'auth_failure',
            confidence: 'low',
            diagnostic: {
                engine_status: 'error',
                indexed_for_region: signals.regionSupported,
                category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
                rate_limit_remaining: signals.rateLimitRemaining ?? null,
                timed_out_stage: null,
                ...baseDiag,
            },
            degraded_kind: 'auth_failure',
        };
    }
    if (signals.degradedKind === 'upstream_exception' || signals.degradedKind === 'circuit_open') {
        return {
            emptiness_reason: 'api_error',
            confidence: 'low',
            diagnostic: {
                engine_status: 'degraded',
                indexed_for_region: signals.regionSupported,
                category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
                rate_limit_remaining: signals.rateLimitRemaining ?? null,
                timed_out_stage: signals.timedOutStage ?? null,
                ...baseDiag,
            },
            degraded_kind: signals.degradedKind,
        };
    }
    if (signals.apiError) {
        return {
            emptiness_reason: 'api_error',
            confidence: 'low',
            diagnostic: {
                engine_status: 'error',
                indexed_for_region: signals.regionSupported,
                category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
                rate_limit_remaining: signals.rateLimitRemaining ?? null,
                ...baseDiag,
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
                ...baseDiag,
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
                ...baseDiag,
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
                ...baseDiag,
            },
        };
    }
    // BUY-72044 / P2.6A: deliver_to_missing branch sits AFTER region/category gates
    // so that genuine catalog gaps (no_data, region_unsupported, category_unsupported)
    // are not blamed on the missing buyer market. Fires only when the unfiltered probe
    // confirmed at least one row would have matched globally.
    if (!signals.deliverToPresent &&
        signals.unfilteredHasAnyData === true) {
        return {
            emptiness_reason: 'deliver_to_missing',
            // confidence=low override per spec: ambiguous query + thin catalog.
            confidence: signals.queryAmbiguous ? 'low' : 'high',
            diagnostic: {
                engine_status: 'ok',
                indexed_for_region: signals.regionSupported,
                category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
                rate_limit_remaining: signals.rateLimitRemaining ?? null,
                ...baseDiag,
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
                ...baseDiag,
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
            ...baseDiag,
        },
    };
}
