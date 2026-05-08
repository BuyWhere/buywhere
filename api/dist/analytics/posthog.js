"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackApiQuery = trackApiQuery;
exports.trackAffiliateClick = trackAffiliateClick;
exports.trackRegistration = trackRegistration;
exports.trackComparePageView = trackComparePageView;
exports.trackCompareRetailerClick = trackCompareRetailerClick;
exports.shutdownPostHog = shutdownPostHog;
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
    // Skip PostHog capture for internal test keys (BUY-13878)
    if (event.isTest)
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
function trackRegistration(apiKey, agentName, signupChannel, utmSource, isTest) {
    const ph = getClient();
    if (!ph)
        return;
    // Skip PostHog capture for internal test keys (BUY-13878)
    if (isTest)
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
    if (event.isTest)
        return;
    ph.capture({
        distinctId: event.apiKey,
        event: 'product_search',
        properties: {
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
    if (event.isTest)
        return;
    ph.capture({
        distinctId: event.apiKey,
        event: 'product_view',
        properties: {
            product_id: event.productId,
            retailer: event.retailer,
            category: event.category,
        },
    });
}
