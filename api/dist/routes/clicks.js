"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Outbound click tracking — BUY-4869
 *
 * GET /api/click?url=X&product_id=Y&merchant=Z
 *   Validates destination against allowed-domains whitelist, logs to `clicks`
 *   table, returns 302 redirect.
 *
 * GET /admin/clicks?days=N
 *   Admin-only analytics: CTR by merchant + top clicked products.
 */
const crypto_1 = require("crypto");
const express_1 = require("express");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// ---------------------------------------------------------------------------
// Allowed-domains whitelist (mirrors redirect.ts)
// ---------------------------------------------------------------------------
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
function merchantFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Admin auth (matches adminCompare.ts pattern)
// ---------------------------------------------------------------------------
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
function requireAdminKey(req, res, next) {
    if (!ADMIN_API_KEY) {
        res.status(503).json({ error: 'Admin API not configured' });
        return;
    }
    const auth = req.headers['authorization'] || '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!key || key !== ADMIN_API_KEY) {
        res.status(401).json({ error: 'Admin API key required' });
        return;
    }
    next();
}
// ---------------------------------------------------------------------------
// GET /api/click
// ---------------------------------------------------------------------------
router.get('/click', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        res.status(400).json({ error: 'Missing required query param: url' });
        return;
    }
    if (!isAllowedDestination(url)) {
        res.status(403).json({ error: 'Destination not permitted' });
        return;
    }
    const productId = req.query.product_id || null;
    const merchantId = req.query.merchant || merchantFromUrl(url);
    const auth = req.headers['authorization'] || '';
    const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    const referrer = req.headers['referer'] || req.headers['referrer'] || null;
    const clientIp = req.ip || req.socket?.remoteAddress || '';
    const ipHash = clientIp
        ? (0, crypto_1.createHash)('sha256').update(clientIp).digest('hex')
        : null;
    try {
        await config_1.db.query(`INSERT INTO clicks
         (product_id, merchant_id, api_key, referrer, destination_url, ip_hash, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'click_endpoint')`, [productId, merchantId, apiKey, referrer, url, ipHash]);
    }
    catch (err) {
        // Log but don't block the redirect
        console.error('[clicks] insert error:', err);
    }
    res.redirect(302, url);
});
// ---------------------------------------------------------------------------
// GET /admin/clicks
// ---------------------------------------------------------------------------
router.get('/clicks', requireAdminKey, async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days || '7'), 1), 90);
    try {
        const [merchantResult, productResult] = await Promise.all([
            config_1.db.query(`SELECT merchant_id,
                COUNT(*)::text                   AS clicks,
                COUNT(DISTINCT product_id)::text AS unique_products
         FROM clicks
         WHERE clicked_at >= NOW() - ($1 || ' days')::interval
           AND merchant_id IS NOT NULL
         GROUP BY merchant_id
         ORDER BY COUNT(*) DESC
         LIMIT 50`, [days]),
            config_1.db.query(`SELECT product_id,
                merchant_id,
                COUNT(*)::text AS clicks
         FROM clicks
         WHERE clicked_at >= NOW() - ($1 || ' days')::interval
           AND product_id IS NOT NULL
         GROUP BY product_id, merchant_id
         ORDER BY COUNT(*) DESC
         LIMIT 20`, [days]),
        ]);
        res.json({
            period: `last_${days}_days`,
            by_merchant: merchantResult.rows.map((r) => ({
                merchant_id: r.merchant_id,
                clicks: parseInt(r.clicks),
                unique_products: parseInt(r.unique_products),
            })),
            top_products: productResult.rows.map((r) => ({
                product_id: r.product_id,
                merchant_id: r.merchant_id,
                clicks: parseInt(r.clicks),
            })),
        });
    }
    catch (err) {
        console.error('[clicks] admin query error:', err);
        res.status(500).json({ error: 'Query failed', detail: String(err) });
    }
});
exports.default = router;
