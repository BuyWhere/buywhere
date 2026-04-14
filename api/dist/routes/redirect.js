"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const posthog_1 = require("../analytics/posthog");
const router = (0, express_1.Router)();
// GET /r/:affiliateSlug/:productId
// Log the affiliate click then redirect to destination
router.get('/:affiliateSlug/:productId', async (req, res) => {
    const { affiliateSlug, productId } = req.params;
    // Look up affiliate link
    const linkResult = await config_1.db.query(`SELECT id, merchant_id, affiliate_link_id, destination_url
     FROM affiliate_links WHERE slug = $1 AND product_id = $2`, [affiliateSlug, productId]);
    let merchantId = 'unknown';
    let affiliateLinkId = '';
    let destinationUrl = null;
    if (linkResult.rows.length > 0) {
        const link = linkResult.rows[0];
        merchantId = link.merchant_id;
        affiliateLinkId = link.affiliate_link_id || '';
        destinationUrl = link.destination_url;
    }
    else {
        // Fallback: try direct product lookup
        const productResult = await config_1.db.query(`SELECT url, domain FROM products WHERE id = $1`, [productId]);
        if (productResult.rows.length > 0) {
            destinationUrl = productResult.rows[0].url;
            merchantId = productResult.rows[0].domain || 'unknown';
        }
    }
    if (!destinationUrl) {
        res.status(404).json({ error: 'Affiliate link not found' });
        return;
    }
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
    (0, posthog_1.trackAffiliateClick)({
        apiKey,
        productId,
        merchantId,
        affiliateLinkId,
        source,
    });
    res.redirect(302, destinationUrl);
});
exports.default = router;
