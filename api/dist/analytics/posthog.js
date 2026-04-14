"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackApiQuery = trackApiQuery;
exports.trackAffiliateClick = trackAffiliateClick;
exports.trackRegistration = trackRegistration;
exports.shutdownPostHog = shutdownPostHog;
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
async function shutdownPostHog() {
    if (client) {
        await client.shutdown();
    }
}
