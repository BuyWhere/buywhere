"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAffiliateConfigs = loadAffiliateConfigs;
exports.detectPlatform = detectPlatform;
exports.buildAffiliateUrl = buildAffiliateUrl;
exports.wrapAffiliateUrl = wrapAffiliateUrl;
exports.resolvePrecomputedAffiliateUrl = resolvePrecomputedAffiliateUrl;
/**
 * Affiliate link wrapping — BUY-18436
 *
 * Wraps raw product URLs with affiliate tracking parameters at response time.
 * Config is loaded from the affiliate_platform_config table and cached in-process.
 * Wrapping adds < 1ms latency (no external calls).
 */
const crypto_1 = require("crypto");
const config_1 = require("../config");
// Domain → platform slug mapping for URL detection
const DOMAIN_TO_PLATFORM = {
    'shopee.sg': 'shopee_sg',
    'lazada.sg': 'lazada_sg',
};
// In-process config cache — refreshed every 60s
let configCache = new Map();
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60000;
async function loadAffiliateConfigs() {
    try {
        const result = await config_1.db.query(`SELECT platform, network_id, tracking_id, is_active
       FROM affiliate_platform_config
       WHERE is_active = true`);
        const next = new Map();
        for (const row of result.rows) {
            next.set(row.platform, {
                platform: row.platform,
                networkId: row.network_id,
                trackingId: row.tracking_id,
                isActive: row.is_active,
            });
        }
        configCache = next;
        cacheLoadedAt = Date.now();
    }
    catch {
        // Non-fatal — table may not exist yet or DB unavailable; keep stale cache
    }
}
async function getConfig(platform) {
    if (Date.now() - cacheLoadedAt > CACHE_TTL_MS) {
        await loadAffiliateConfigs();
    }
    return configCache.get(platform) ?? null;
}
function detectPlatform(url) {
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        return DOMAIN_TO_PLATFORM[hostname] ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Build a wrapped affiliate URL for the given network/trackingId.
 * Uses placeholder URL patterns; swap for real network deep-link format
 * once real credentials from BUY-13765 are available.
 */
function buildAffiliateUrl(rawUrl, config, clickId) {
    const encoded = encodeURIComponent(rawUrl);
    switch (config.platform) {
        case 'shopee_sg':
            // Placeholder: Accesstrade / Involve Asia deep-link format for Shopee SG
            return `https://s.shopee.sg/affiliate-redirect?pid=${encodeURIComponent(config.trackingId)}&click_id=${clickId}&url=${encoded}`;
        case 'lazada_sg':
            // Placeholder: Involve Asia deep-link format for Lazada SG
            return `https://c.lazada.sg/t/${encodeURIComponent(config.trackingId)}?sub_aff_id=${clickId}&url=${encoded}`;
        default:
            // Generic fallback: append tracking params
            try {
                const u = new URL(rawUrl);
                u.searchParams.set('aff_id', config.trackingId);
                u.searchParams.set('click_id', clickId);
                return u.toString();
            }
            catch {
                return rawUrl;
            }
    }
}
/**
 * Wraps a raw product URL with affiliate tracking parameters.
 * Returns the original URL if no active config exists for the detected platform.
 * Logs a click impression asynchronously (fire-and-forget) when wrapping occurs.
 */
async function wrapAffiliateUrl(rawUrl, productId, merchantId) {
    const platform = detectPlatform(rawUrl);
    if (!platform)
        return { url: rawUrl, clickId: null };
    const config = await getConfig(platform);
    if (!config)
        return { url: rawUrl, clickId: null };
    const clickId = (0, crypto_1.randomUUID)();
    const wrappedUrl = buildAffiliateUrl(rawUrl, config, clickId);
    // Fire-and-forget: log click impression
    config_1.db.query(`INSERT INTO affiliate_clicks
       (api_key, affiliate_slug, product_id, merchant_id, affiliate_link_id, source, destination_url)
     VALUES (null, $1, $2, $3, null, 'api_response', $4)`, [platform, productId, merchantId, wrappedUrl]).catch(() => { });
    return { url: wrappedUrl, clickId };
}
/**
 * Synchronous wrapper using pre-fetched affiliate_url from the affiliate_links table.
 * Used in buildProduct when the DB query already joined the table.
 * Returns the pre-computed destination URL if present; otherwise returns null.
 */
function resolvePrecomputedAffiliateUrl(affiliateUrl) {
    if (typeof affiliateUrl === 'string' && affiliateUrl.length > 0) {
        return affiliateUrl;
    }
    return null;
}
