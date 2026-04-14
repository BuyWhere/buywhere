"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const config_1 = require("../config");
const posthog_1 = require("../analytics/posthog");
const router = (0, express_1.Router)();
// POST /v1/auth/register
// Headless agent self-registration — no human approval required
router.post('/register', async (req, res) => {
    const { agent_name, contact, use_case } = req.body;
    if (!agent_name || typeof agent_name !== 'string') {
        res.status(400).json({ error: 'agent_name is required' });
        return;
    }
    // Generate API key
    const rawKey = `bw_${(0, uuid_1.v4)().replace(/-/g, '')}`;
    // UTM / attribution from query params or body
    const utmSource = (req.query.utm_source || req.body.utm_source);
    const utmMedium = (req.query.utm_medium || req.body.utm_medium);
    const utmCampaign = (req.query.utm_campaign || req.body.utm_campaign);
    const signupChannel = resolveSignupChannel(req.headers['referer'], utmSource, utmMedium);
    await config_1.db.query(`INSERT INTO api_keys
       (key, agent_name, contact, use_case, tier, rpm_limit, daily_limit,
        signup_channel, attribution_source, utm_source, utm_medium, utm_campaign)
     VALUES ($1,$2,$3,$4,'free',$5,$6,$7,$8,$9,$10,$11)`, [
        rawKey,
        agent_name.trim().slice(0, 200),
        contact ? String(contact).slice(0, 500) : null,
        use_case ? String(use_case).slice(0, 1000) : null,
        config_1.FREE_TIER.rpm,
        config_1.FREE_TIER.daily,
        signupChannel,
        utmSource || null,
        utmSource || null,
        utmMedium || null,
        utmCampaign || null,
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
        docs: 'https://docs.buywhere.ai/api',
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
