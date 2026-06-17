"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSearchResponse = exports.buildProduct = exports.COUNTRY_CURRENCY = exports.CURRENCY_RATES = void 0;
const affiliateWrapper_1 = require("./affiliateWrapper");
exports.CURRENCY_RATES = {
    USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79,
};
exports.COUNTRY_CURRENCY = {
    SG: 'SGD', US: 'USD', GB: 'GBP', VN: 'VND', TH: 'THB', MY: 'MYR',
};
function buildProduct(row, defaultCurrency, compact) {
    const currency = row.currency || defaultCurrency;
    const amount = row.price != null ? parseFloat(row.price) : null;
    const affiliateUrl = (0, affiliateWrapper_1.resolvePrecomputedAffiliateUrl)(row.affiliate_url);
    const base = {
        id: row.id,
        title: row.title,
        price: { amount, currency },
        merchant: row.domain,
        url: affiliateUrl ?? row.url,
        image_url: row.image_url || null,
        region: row.region || null,
        country_code: row.country_code || null,
        updated_at: row.updated_at || null,
        ...(affiliateUrl != null && { affiliate_url: affiliateUrl }),
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
        const rate = exports.CURRENCY_RATES[currency] ?? null;
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
exports.buildProduct = buildProduct;
function buildSearchResponse(products, total, limit, offset, responseTimeMs, cached) {
    return {
        results: products,
        total,
        page: { limit, offset },
        response_time_ms: responseTimeMs,
        cached,
    };
}
exports.buildSearchResponse = buildSearchResponse;
