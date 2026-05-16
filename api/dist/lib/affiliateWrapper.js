"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOMAIN_TO_PLATFORM = void 0;
exports.detectPlatform = detectPlatform;
exports.buildAffiliateUrl = buildAffiliateUrl;
exports.resolvePrecomputedAffiliateUrl = resolvePrecomputedAffiliateUrl;
exports.loadAffiliateConfigs = loadAffiliateConfigs;
exports.wrapAffiliateUrl = wrapAffiliateUrl;

const crypto_1 = require("crypto");

// Domain → platform slug mapping for URL detection
exports.DOMAIN_TO_PLATFORM = {
    'shopee.sg': 'shopee_sg',
    'lazada.sg': 'lazada_sg',
};

// In-process config cache — refreshed every 60s
let configCache = new Map();
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadAffiliateConfigs() {
    try {
        // db may not be available in test context — skip gracefully
        const { db } = require('../config');
        const result = await db.query(
            `SELECT platform, network_id, tracking_id, is_active
             FROM affiliate_platform_config
             WHERE is_active = true`
        );
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
    } catch {
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
        return exports.DOMAIN_TO_PLATFORM[hostname] ?? null;
    } catch {
        return null;
    }
}

function buildAffiliateUrl(rawUrl, config, clickId) {
    const encoded = encodeURIComponent(rawUrl);
    switch (config.platform) {
        case 'shopee_sg':
            return `https://s.shopee.sg/affiliate-redirect?pid=${encodeURIComponent(config.trackingId)}&click_id=${clickId}&url=${encoded}`;
        case 'lazada_sg':
            return `https://c.lazada.sg/t/${encodeURIComponent(config.trackingId)}?sub_aff_id=${clickId}&url=${encoded}`;
        default:
            try {
                const u = new URL(rawUrl);
                u.searchParams.set('aff_id', config.trackingId);
                u.searchParams.set('click_id', clickId);
                return u.toString();
            } catch {
                return rawUrl;
            }
    }
}

async function wrapAffiliateUrl(rawUrl, productId, merchantId) {
    const platform = detectPlatform(rawUrl);
    if (!platform) return { url: rawUrl, clickId: null };

    const config = await getConfig(platform);
    if (!config) return { url: rawUrl, clickId: null };

    const clickId = (0, crypto_1.randomUUID)();
    const wrappedUrl = buildAffiliateUrl(rawUrl, config, clickId);

    // Fire-and-forget: log click impression
    try {
        const { db } = require('../config');
        db.query(
            `INSERT INTO affiliate_clicks
               (api_key, affiliate_slug, product_id, merchant_id, affiliate_link_id, source, destination_url)
             VALUES (null, $1, $2, $3, null, 'api_response', $4)`,
            [platform, productId, merchantId, wrappedUrl],
        ).catch(() => {});
    } catch {
        // db not available — skip
    }

    return { url: wrappedUrl, clickId };
}

function resolvePrecomputedAffiliateUrl(affiliateUrl) {
    if (typeof affiliateUrl === 'string' && affiliateUrl.length > 0) {
        return affiliateUrl;
    }
    return null;
}
