"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackProductView = exports.trackProductSearch = exports.trackEmailVerified = exports.trackApiUsage = exports.shutdownPostHog = exports.trackCompareRetailerClick = exports.trackComparePageView = exports.trackRegistration = exports.trackAffiliateClick = exports.trackApiQuery = void 0;
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
exports.trackApiQuery = trackApiQuery;
function trackAffiliateClick(event) {
    const ph = getClient();
    if (!ph)
        return;
    ph.capture({
        distinctId: event.apiKey || 'anonymous',
        event: 'affiliate_click',
        properties: {
            product_id: event.productId,
            merchant_id: event.merchantId,
            affiliate_link_id: event.affiliateLinkId,
            source: event.source,
        },
    });
}
exports.trackAffiliateClick = trackAffiliateClick;
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
exports.trackRegistration = trackRegistration;
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
exports.trackComparePageView = trackComparePageView;
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
exports.trackCompareRetailerClick = trackCompareRetailerClick;
async function shutdownPostHog() {
    if (client) {
        await client.shutdown();
    }
}
exports.shutdownPostHog = shutdownPostHog;
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
exports.trackApiUsage = trackApiUsage;
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
exports.trackEmailVerified = trackEmailVerified;
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
exports.trackProductSearch = trackProductSearch;
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
exports.trackProductView = trackProductView;
