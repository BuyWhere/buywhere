"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackApiQuery = trackApiQuery;
exports.trackAffiliateClick = trackAffiliateClick;
exports.trackRegistration = trackRegistration;
exports.trackComparePageView = trackComparePageView;
exports.trackCompareRetailerClick = trackCompareRetailerClick;
exports.shutdownPostHog = shutdownPostHog;
exports.trackApiUsage = trackApiUsage;
exports.trackEmailVerified = trackEmailVerified;
exports.trackProductSearch = trackProductSearch;
exports.trackProductView = trackProductView;
const posthog_node_1 = require("posthog-node");
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://app.posthog.com';
let client = null;
function getClient() {
    if (!POSTHOG_API_KEY)
        return null;
    if (!client) {
        client = new posthog_node_1.PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
    }
    return client;
}
function trackApiQuery(event) {
    const ph = getClient();
    if (!ph)
        return;
    ph.capture({
        distinctId: event.apiKey,
        event: 'api_query',
        properties: {
            agent_framework: event.agentFramework,
            agent_version: event.agentVersion,
            sdk_language: event.sdkLanguage,
            query_intent: event.queryIntent,
            product_categories: event.productCategories,
            result_count: event.resultCount,
            response_time_ms: event.responseTimeMs,
            signup_channel: event.signupChannel,
            source_page: event.sourcePage,
            endpoint: event.endpoint,
        },
    });
}
// BUY-71129: fixed source enum. Any value outside the set is bucketed as
// 'unknown' so dirty enum values like 'product_card\' (trailing backslash bug)
// can never reach PostHog. The trailing-backslash case maps to 'unknown'
// because the literal string 'product_card\' is not in the enum and never
// was a valid value — it was a routing artifact.
const ALLOWED_AFFILIATE_SOURCES = new Set([
    'product_card',
    'api_response',
    'compare_page',
    'mcp_tool_call',
    'landing_page',
    'test',
]);
function normalizeAffiliateSource(raw) {
    if (typeof raw !== 'string')
        return 'unknown';
    // Strip a single trailing backslash from any input that may have been
    // double-escaped by an upstream URL builder (BUY-71129 dirty-enum fix).
    const cleaned = raw.endsWith('\\') ? raw.slice(0, -1) : raw;
    if (ALLOWED_AFFILIATE_SOURCES.has(cleaned))
        return cleaned;
    if (cleaned.startsWith('test') || cleaned.startsWith('rex-') || cleaned.startsWith('buy'))
        return 'test';
    return 'unknown';
}
function trackAffiliateClick(event) {
    const ph = getClient();
    if (!ph)
        return;
    // Distinct id priority: apiKeyId (uuid) > apiKey (hash) > 'anonymous'.
    // apiKeyId is the same value PostHog has on api_query / product_search /
    // mcp_tool_call, so the join across the funnel works.
    const distinctId = event.apiKeyId || event.apiKey || 'anonymous';
    const source = normalizeAffiliateSource(event.source);
    const props = {
        product_id: event.productId,
        merchant_id: event.merchantId,
        affiliate_link_id: event.affiliateLinkId,
        source,
    };
    if (event.apiKeyId)
        props.api_key_id = event.apiKeyId;
    if (event.agentName)
        props.agent_name = event.agentName;
    if (event.signupChannel)
        props.signup_channel = event.signupChannel;
    if (event.attributionSource)
        props.attribution_source = event.attributionSource;
    if (event.utmSource)
        props.utm_source = event.utmSource;
    if (event.utmMedium)
        props.utm_medium = event.utmMedium;
    if (event.utmCampaign)
        props.utm_campaign = event.utmCampaign;
    if (event.merchantName)
        props.merchant = event.merchantName;
    if (event.merchantDomain)
        props.merchant_domain = event.merchantDomain;
    if (event.productTitle)
        props.product_title = event.productTitle;
    if (event.productCategory)
        props.product_category = event.productCategory;
    if (event.countryCode)
        props.$geoip_country_code = event.countryCode;
    if (event.city)
        props.$geoip_city = event.city;
    if (event.testMode)
        props.$test_event = true;
    ph.capture({
        distinctId,
        event: 'affiliate_click',
        properties: props,
        // BUY-71129: the PostHog client is constructed with disableGeoip: true
        // (project-level privacy default). Per-capture override re-enables geo
        // for this one revenue-impacting event so we can attribute conversions
        // by country.
        disableGeoip: false,
    });
}
function trackRegistration(apiKey, agentName, signupChannel, utmSource) {
    const ph = getClient();
    if (!ph)
        return;
    ph.capture({
        distinctId: apiKey,
        event: 'agent_registered',
        properties: {
            agent_name: agentName,
            signup_channel: signupChannel,
            utm_source: utmSource,
        },
    });
    ph.identify({
        distinctId: apiKey,
        properties: {
            agent_name: agentName,
            signup_channel: signupChannel,
            utm_source: utmSource,
            registered_at: new Date().toISOString(),
        },
    });
}
function trackComparePageView(event) {
    const ph = getClient();
    if (!ph)
        return;
    ph.capture({
        distinctId: `compare:${event.slug}`,
        event: 'compare_page_view',
        properties: {
            slug: event.slug,
            product_id: event.productId,
            category: event.category,
            retailer_count: event.retailerCount,
            lowest_price: event.lowestPrice,
        },
    });
}
function trackCompareRetailerClick(event) {
    const ph = getClient();
    if (!ph)
        return;
    ph.capture({
        distinctId: `compare:${event.slug}`,
        event: 'compare_retailer_click',
        properties: {
            slug: event.slug,
            retailer: event.retailer,
            price: event.price,
            rank: event.rank,
        },
    });
}
async function shutdownPostHog() {
    if (client) {
        await client.shutdown();
    }
}
function trackApiUsage(event) {
    const ph = getClient();
    if (!ph)
        return;
    const isMcpToolCall = !!event.toolName;
    const extra = {};
    if (event.queryIntent)
        extra.query_intent = event.queryIntent;
    if (event.productCategories?.length)
        extra.product_categories = event.productCategories;
    if (event.signupChannel)
        extra.signup_channel = event.signupChannel;
    if (event.sourcePage)
        extra.source_page = event.sourcePage;
    ph.capture({
        distinctId: event.apiKeyId,
        event: isMcpToolCall ? 'mcp_tool_call' : 'api_query',
        properties: {
            endpoint: event.endpoint,
            method: event.method,
            tier: event.tier,
            api_key_id: event.apiKeyId,
            result_status: event.resultStatus,
            latency_ms: event.latencyMs,
            ...(isMcpToolCall ? { tool_name: event.toolName } : {}),
            ...(event.backfilled ? { backfilled: true } : {}),
            ...extra,
        },
        ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    });
}
function trackEmailVerified(apiKeyId, email) {
    const ph = getClient();
    if (!ph)
        return;
    ph.capture({
        distinctId: apiKeyId,
        event: 'email_verified',
        properties: {
            email,
            verified_at: new Date().toISOString(),
        },
    });
}
function trackProductSearch(event) {
    const ph = getClient();
    if (!ph)
        return;
    ph.capture({
        distinctId: event.apiKey,
        event: 'product_search',
        properties: {
            api_key_id: event.apiKeyId,
            result_status: 200,
            latency_ms: event.responseTimeMs,
            query_text: event.queryText,
            result_count: event.resultCount,
            response_time_ms: event.responseTimeMs,
        },
    });
}
function trackProductView(event) {
    const ph = getClient();
    if (!ph)
        return;
    ph.capture({
        distinctId: event.apiKey,
        event: 'product_view',
        properties: {
            api_key_id: event.apiKeyId,
            result_status: 200,
            latency_ms: event.latencyMs,
            product_id: event.productId,
            retailer: event.retailer,
            category: event.category,
        },
    });
}
