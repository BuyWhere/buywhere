"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const involveAsia_1 = require("../lib/involveAsia");
const crypto_1 = require("crypto");
const config_1 = require("../config");
const posthog_1 = require("../analytics/posthog");
function hashKey(rawKey) {
    return (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
}
const router = (0, express_1.Router)();
// Awin affiliate programme (BUY-6873)
const awinPublisherId = process.env.AWIN_PUBLISHER_ID || '';
const awinAdvertiserIds = new Set((process.env.AWIN_ADVERTISER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));
function buildAwinUrl(advertiserId, destination, clickRef) {
    const encoded = encodeURIComponent(destination);
    return `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${awinPublisherId}&clickref=${clickRef}&p=${encoded}`;
}
const DEFAULT_ALLOWED_DOMAINS = [
    'lazada.sg',
    'shopee.sg',
    'bestdenki.com.sg',
    'amazon.sg',
    'courts.com.sg',
    'harvey-norman.com.sg',
    'challenger.sg',
    'qoo10.sg',
];
const allowedDomains = new Set((process.env.AFFILIATE_ALLOWED_DOMAINS
    ? process.env.AFFILIATE_ALLOWED_DOMAINS.split(',').map((d) => d.trim())
    : DEFAULT_ALLOWED_DOMAINS).filter(Boolean));
function isAllowedDestination(url) {
    try {
        const { hostname } = new URL(url);
        const bare = hostname.replace(/^www\./, '');
        return allowedDomains.has(bare);
    }
    catch {
        return false;
    }
}
// GET /r/:affiliateSlug/:productId
// Log the affiliate click then redirect to destination
router.get('/:affiliateSlug/:productId', async (req, res) => {
    const { affiliateSlug, productId } = req.params;
    // Look up affiliate link
    const linkResult = await config_1.db.query(`SELECT id, merchant_id, platform, destination_url
     FROM affiliate_links WHERE platform = $1 AND product_id = $2`, [affiliateSlug, productId]);
    let merchantId = 'unknown';
    let affiliateLinkId = '';
    let destinationUrl = null;
    if (linkResult.rows.length > 0) {
        const link = linkResult.rows[0];
        merchantId = link.merchant_id || affiliateSlug;
        affiliateLinkId = String(link.id);
        destinationUrl = link.destination_url;
    }
    else {
        // Fallback: try direct product lookup
        const productResult = await config_1.db.query(`SELECT url, merchant_id FROM products WHERE id = $1`, [productId]);
        if (productResult.rows.length > 0) {
            destinationUrl = productResult.rows[0].url;
            merchantId = productResult.rows[0].merchant_id || 'unknown';
        }
    }
    if (!destinationUrl) {
        res.status(404).json({ error: 'Affiliate link not found' });
        return;
    }
    // Involve Asia (2026-08-24): shopee.sg destinations get a commission-bearing
    // tracking link at click time (offer 5035, Shopee SG - CPS). Generated links are
    // cached into affiliate_links so subsequent clicks skip the API call. Fails soft.
    try {
        const destHost = new URL(destinationUrl).hostname.replace(/^www\./, '');
        if (destHost === 'shopee.sg' && !(0, involveAsia_1.isAffiliateWrapped)(destinationUrl)) {
            const dl = await (0, involveAsia_1.generateShopeeSgDeeplink)(destinationUrl, productId);
            if (dl) {
                const rawUrl = destinationUrl;
                destinationUrl = dl;
                (async () => {
                    try {
                        if (affiliateLinkId) {
                            await config_1.db.query(`UPDATE affiliate_links SET affiliate_url = $1 WHERE id = $2`, [dl, affiliateLinkId]);
                        }
                        else {
                            await config_1.db.query(`INSERT INTO affiliate_links (id, slug, product_id, merchant_id, destination_url, affiliate_url)
                 VALUES (gen_random_uuid(), 'involve_asia', $1, $2, $3, $4)`, [productId, merchantId, rawUrl, dl]);
                        }
                    }
                    catch (err) {
                        console.warn('[redirect] IA link cache write failed:', err.message);
                    }
                })();
            }
        }
    }
    catch { /* bad URL — proceed unwrapped */ }
    // Determine API key for attribution
    const authHeader = req.headers['authorization'] || '';
    let apiKey = null;
    if (authHeader.startsWith('Bearer '))
        apiKey = authHeader.slice(7).trim();
    const source = req.query.source || 'api_response';
    // Log click to DB (before redirect)
    await config_1.db.query(`INSERT INTO affiliate_clicks
       (api_key, affiliate_slug, product_id, merchant_id, affiliate_link_id, source, destination_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`, [apiKey, affiliateSlug, productId, merchantId, affiliateLinkId, source, destinationUrl]);
    // PostHog event (fire-and-forget)
    // Hash API key before sending to third-party analytics
    (0, posthog_1.trackAffiliateClick)({
        apiKey: apiKey ? hashKey(apiKey) : null,
        productId,
        merchantId,
        affiliateLinkId,
        source,
    });
    // Rewrite to Awin tracking URL when publisher + advertiser IDs are configured
    let finalUrl = destinationUrl;
    if (awinPublisherId && affiliateLinkId && awinAdvertiserIds.has(affiliateLinkId)) {
        const clickRef = `${productId.slice(0, 12)}-${Date.now().toString(36)}`;
        finalUrl = buildAwinUrl(affiliateLinkId, destinationUrl, clickRef);
    }
    else {
        if (!isAllowedDestination(destinationUrl)) {
            const { hostname } = (() => { try {
                return new URL(destinationUrl);
            }
            catch {
                return { hostname: destinationUrl };
            } })();
            console.warn(`[redirect] blocked: hostname "${hostname}" not in allowlist`);
            res.status(403).json({ error: 'Destination not permitted' });
            return;
        }
    }
    res.redirect(302, finalUrl);
});
exports.default = router;
