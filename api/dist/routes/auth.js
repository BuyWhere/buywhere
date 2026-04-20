"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const crypto_1 = require("crypto");
const config_1 = require("../config");
const posthog_1 = require("../analytics/posthog");
const router = (0, express_1.Router)();
function hashKey(rawKey) {
    return (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
}
// POST /v1/auth/register
// Headless agent self-registration — no human approval required
router.post('/register', async (req, res) => {
    const { agent_name, contact, use_case } = req.body;
    if (!agent_name || typeof agent_name !== 'string') {
        res.status(400).json({ error: 'agent_name is required' });
        return;
    }
    // Generate API key (raw key returned once, only hash stored)
    const rawKey = `bw_${(0, uuid_1.v4)().replace(/-/g, '')}`;
    const keyHash = hashKey(rawKey);
    // UTM / attribution from query params or body
    const utmSource = (req.query.utm_source || req.body.utm_source);
    const utmMedium = (req.query.utm_medium || req.body.utm_medium);
    const signupChannel = resolveSignupChannel(req.headers['referer'], utmSource, utmMedium);
    await config_1.db.query(`INSERT INTO api_keys
       (id, key_hash, name, contact, use_case, tier, is_active,
        signup_channel, attribution_source, developer_id)
     VALUES (gen_random_uuid(),$1,$2,$3,$4,'free',true,$5,$6,'self-registered')`, [
        keyHash,
        agent_name.trim().slice(0, 200),
        contact ? String(contact).slice(0, 500) : null,
        use_case ? String(use_case).slice(0, 1000) : null,
        signupChannel,
        utmSource || null,
    ]);
    // Fire PostHog registration event (async, non-blocking)
    (0, posthog_1.trackRegistration)(rawKey, agent_name, signupChannel, utmSource || null);
    res.status(201).json({
        api_key: rawKey,
        tier: 'free',
        rate_limit: {
            rpm: config_1.FREE_TIER.rpm,
            daily: config_1.FREE_TIER.daily,
        },
        docs: 'https://api.buywhere.ai/docs',
    });
});
// Infer signup channel from referer + UTM
function resolveSignupChannel(referer, utmSource, utmMedium) {
    if (utmSource) {
        const src = utmSource.toLowerCase();
        if (src.includes('github'))
            return 'github';
        if (src.includes('producthunt') || src.includes('product_hunt'))
            return 'product_hunt';
        if (src.includes('google'))
            return 'google_search';
        if (src.includes('blog'))
            return 'blog_post';
        if (src.includes('social') || src.includes('twitter') || src.includes('linkedin'))
            return 'social';
        if (utmMedium?.includes('referral'))
            return 'referral';
        return utmSource;
    }
    if (referer) {
        if (/github\.com/i.test(referer))
            return 'github';
        if (/google\.com/i.test(referer))
            return 'google_search';
        if (/producthunt\.com/i.test(referer))
            return 'product_hunt';
    }
    return 'direct';
}
exports.default = router;
