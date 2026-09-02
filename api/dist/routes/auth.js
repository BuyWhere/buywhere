"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const crypto_1 = require("crypto");
const config_1 = require("../config");
const apiKey_1 = require("../middleware/apiKey");
const posthog_1 = require("../analytics/posthog");
const email_1 = require("../email");
const errors_1 = require("../middleware/errors");
const errors_2 = require("../middleware/errors");
const router = (0, express_1.Router)();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function hashKey(rawKey) {
    return (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
}
function generateVerificationToken() {
    return (0, crypto_1.randomBytes)(32).toString('hex');
}
// POST /v1/auth/register
// POST /v1/developers/signup
// Headless agent self-registration — requires email for verification
// BUY-72774: verify=false query param skips email verification and issues pending-verify tier
async function registerAgent(req, res) {
    const { agent_name, email, contact, use_case, is_internal: reqIsInternal } = req.body;
    // BUY-72774: verify=false → issue pending-verify tier, skip verification email
    const skipVerify = req.query.verify === 'false';
    if (!agent_name || typeof agent_name !== 'string') {
        res.status(400).json({ error: 'agent_name is required' });
        return;
    }
    // BUY-72823: internal-flag registration — only honored when the caller
    // presents the shared BUYWHERE_SIGNUP_SECRET header. Without the secret,
    // any "is_internal" in the body is silently ignored (column default = false).
    // This lets fleet-testing harnesses mint keys invisible to growth cohorts
    // without exposing the flag to arbitrary public signups.
    const headerSecret = req.headers['x-buywhere-signup-secret'];
    const envSecret = process.env.BUYWHERE_SIGNUP_SECRET;
    const isInternal = !!(reqIsInternal === true &&
        envSecret &&
        typeof headerSecret === 'string' &&
        headerSecret === envSecret);
    const emailAddr = (email || contact || '');
    const hasEmail = emailAddr.length > 0;
    // Email is OPTIONAL for agent self-service (MCP/API are agent-only; no human signup required).
    // If provided it must be valid (enables tier upgrade via verification); if omitted, an unverified key is issued directly.
    if (hasEmail && !EMAIL_RE.test(emailAddr)) {
        (0, errors_1.sendError)(res, errors_2.ErrorCode.INVALID_PARAMETER, 'If an email is provided, it must be valid.');
        return;
    }
    // Generate API key (raw key returned once, only hash stored)
    const rawKey = `bw_${(0, uuid_1.v4)().replace(/-/g, '')}`;
    const keyHash = hashKey(rawKey);
    // UTM / attribution from query params or body
    const utmSource = (req.query.utm_source || req.body.utm_source);
    const utmMedium = (req.query.utm_medium || req.body.utm_medium);
    // GTM-attribution (2026-08-22): persist the FULL utm set + a referrer-host
    // fallback — the columns existed but were never written, leaving attribution
    // blind (100% 'direct' in the W1 growth analysis).
    const utmCampaign = (req.query.utm_campaign || req.body.utm_campaign);
    const utmContent = (req.query.utm_content || req.body.utm_content);
    const utmTerm = (req.query.utm_term || req.body.utm_term);
    const clip = (v) => (v ? String(v).slice(0, 200) : null);
    let referrerHost = null;
    try {
        const ref = req.headers['referer'];
        if (typeof ref === 'string' && ref)
            referrerHost = new URL(ref).hostname.slice(0, 200);
    }
    catch { /* malformed referer — ignore */ }
    const signupChannel = resolveSignupChannel(req.headers['referer'], utmSource, utmMedium);
    // BUY-72774: determine tier based on verify=false flag
    const tier = skipVerify ? 'pending_verify' : 'unverified';
    // Capture registration IP for anti-abuse (pending-verify tier)
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() ??
        req.headers['x-real-ip'] ??
        req.ip ??
        null;
    const verificationToken = hasEmail && !skipVerify ? generateVerificationToken() : null;
    const expiresAt = hasEmail && !skipVerify ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
    const id = (0, uuid_1.v4)();
    // BUY-72774: for pending-verify tier, capture IP for tracking.
    // Anti-abuse IP limit (3+ keys/24h) is enforced in the apiKey middleware
    // on first use, not at registration — keeping the register path synchronous.
    const registrationIp = skipVerify ? clientIp : null;
    await config_1.db.query(`INSERT INTO api_keys
       (id, key_hash, name, email, contact, use_case, tier, is_active,
        signup_channel, attribution_source, developer_id,
        email_verification_token, email_verification_expires_at,
        registration_ip, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        is_internal)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,'self-registered',$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [
        id,
        keyHash,
        agent_name.trim().slice(0, 200),
        hasEmail ? emailAddr.slice(0, 500) : null,
        hasEmail ? emailAddr.slice(0, 500) : null,
        use_case ? String(use_case).slice(0, 1000) : null,
        tier,
        signupChannel,
        utmSource || referrerHost || null,
        verificationToken,
        expiresAt,
        registrationIp,
        clip(utmSource),
        clip(utmMedium),
        clip(utmCampaign),
        clip(utmContent),
        clip(utmTerm),
        isInternal,
    ]);
    // BUY-72774: background IP counter — fire-and-forget, non-blocking.
    // Updates api_keys.keys_from_same_ip_24h for future use-time checks.
    if (skipVerify && clientIp) {
        const ipHash = (0, crypto_1.createHash)('sha256').update(clientIp).digest('hex').slice(0, 32);
        const ipCounterKey = `auth:pending_verify:ip:${ipHash}`;
        config_1.db.query(`UPDATE api_keys SET keys_from_same_ip_24h = (
         SELECT COUNT(*) FROM api_keys
         WHERE registration_ip = $1 AND created_at > NOW() - INTERVAL '24 hours'
       ) WHERE id = $2`, [clientIp, id]).catch(() => { });
        // Increment Redis for use-time fast-path check (best-effort, never blocks)
        config_1.redis.incr(ipCounterKey).catch(() => { });
        config_1.redis.expire(ipCounterKey, 24 * 60 * 60).catch(() => { });
    }
    // Fire PostHog registration event (async, non-blocking)
    (0, posthog_1.trackRegistration)(hashKey(rawKey), agent_name, signupChannel, utmSource || null);
    // Send verification email only when an email was supplied (optional for agents)
    // BUY-72774: skip email when verify=false (pending-verify tier has no email)
    if (hasEmail && verificationToken && !skipVerify) {
        (0, email_1.sendVerificationEmail)(emailAddr, verificationToken)
            .then((sent) => {
            if (sent) {
                config_1.db.query(`UPDATE api_keys SET email_verification_sent_at = NOW() WHERE key_hash = $1`, [keyHash]).catch(() => { });
            }
        })
            .catch(() => { });
    }
    // BUY-72775: include verify_url in response when email provided — enables
    // one-step paste of both api_key and verify_url into framework config.
    // BUY-72774: verify=false path has no email verification.
    const pvLimits = config_1.TIER_LIMITS.pending_verify;
    const response = {
        api_key: rawKey,
        tier: skipVerify ? 'pending-verify' : 'unverified',
        email_verified: false,
        rate_limit: {
            rpm: skipVerify ? pvLimits.rpm : config_1.TIER_LIMITS.unverified.rpm,
            daily: skipVerify ? pvLimits.daily : config_1.TIER_LIMITS.unverified.daily,
            ...(skipVerify ? { week: pvLimits.weekly } : {}),
        },
        ...(skipVerify ? { cap: { day: pvLimits.daily, wk: pvLimits.weekly } } : {}),
        docs: 'https://api.buywhere.ai/docs',
    };
    if (hasEmail && verificationToken) {
        response.verify_url = `${config_1.API_BASE_URL}/v1/auth/verify?token=${encodeURIComponent(verificationToken)}`;
    }
    res.status(201).json(response);
}
router.post('/register', registerAgent);
router.post('/signup', registerAgent);
// GET /v1/auth/verify?token=xxx
router.get('/verify', async (req, res) => {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
        (0, errors_1.sendError)(res, errors_2.ErrorCode.INVALID_PARAMETER, 'Verification token is required.');
        return;
    }
    // BUY-72774: check current tier to determine promotion target
    // pending_verify -> free (via email verification), unverified -> verified_agent
    const currentTierResult = await config_1.db.query(`SELECT tier FROM api_keys
     WHERE email_verification_token = $1
       AND email_verified = false
       AND (email_verification_expires_at IS NULL OR email_verification_expires_at > NOW())`, [token]);
    const newTier = currentTierResult.rows[0]?.tier === 'pending_verify' ? 'free' : 'verified_agent';
    const result = await config_1.db.query(`UPDATE api_keys
       SET email_verified = true,
           email_verification_token = NULL,
           email_verification_expires_at = NULL,
           tier = $2
     WHERE email_verification_token = $1
       AND email_verified = false
       AND (email_verification_expires_at IS NULL OR email_verification_expires_at > NOW())
     RETURNING id, email, tier, rpm_limit, daily_limit`, [token, newTier]);
    if (result.rows.length === 0) {
        // Check if token exists but expired
        const expired = await config_1.db.query(`SELECT id FROM api_keys
       WHERE email_verification_token = $1
         AND email_verified = false
         AND email_verification_expires_at <= NOW()`, [token]);
        if (expired.rows.length > 0) {
            (0, errors_1.sendError)(res, errors_2.ErrorCode.INVALID_PARAMETER, 'Verification token has expired. Request a new one.', undefined, 410);
            return;
        }
        (0, errors_1.sendError)(res, errors_2.ErrorCode.INVALID_PARAMETER, 'Verification token is invalid or already used.', undefined, 404);
        return;
    }
    const { id, email: verifiedEmail, tier, rpm_limit, daily_limit } = result.rows[0];
    const effectiveDaily = daily_limit ?? (config_1.TIER_LIMITS[tier] ?? config_1.FREE_TIER).daily;
    const effectiveRpm = rpm_limit ?? (config_1.TIER_LIMITS[tier] ?? config_1.FREE_TIER).rpm;
    (0, posthog_1.trackEmailVerified)(id, verifiedEmail);
    res.json({
        message: 'Email verified successfully.',
        tier,
        rate_limit: {
            rpm: effectiveRpm,
            daily: effectiveDaily,
        },
    });
});
// POST /v1/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
        (0, errors_1.sendError)(res, errors_2.ErrorCode.INVALID_PARAMETER, 'A valid email address is required.');
        return;
    }
    const normalizedEmail = email.trim().toLowerCase().slice(0, 500);
    // Rate limit: 1 resend per 60s per email
    const rateLimitKey = `verify:resend:${normalizedEmail}`;
    const lastSent = await config_1.redis.get(rateLimitKey);
    if (lastSent) {
        const ttl = await config_1.redis.ttl(rateLimitKey);
        (0, errors_1.sendError)(res, errors_2.ErrorCode.RATE_LIMIT_EXCEEDED, `Please wait ${ttl}s before requesting another verification email.`);
        return;
    }
    const result = await config_1.db.query(`SELECT id, email_verified, key_hash
     FROM api_keys
     WHERE email = $1
     ORDER BY created_at DESC
     LIMIT 1`, [normalizedEmail]);
    if (result.rows.length === 0) {
        (0, errors_1.sendError)(res, errors_2.ErrorCode.NOT_FOUND, 'No account found with this email address.');
        return;
    }
    const row = result.rows[0];
    if (row.email_verified) {
        (0, errors_1.sendError)(res, errors_2.ErrorCode.CONFLICT, 'Email is already verified.');
        return;
    }
    const newToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await config_1.db.query(`UPDATE api_keys
       SET email_verification_token = $1,
           email_verification_expires_at = $2,
           email_verification_sent_at = NOW()
     WHERE id = $3`, [newToken, expiresAt, row.id]);
    // Set rate limit: 60s
    await config_1.redis.set(rateLimitKey, '1', 'EX', 60);
    const backfill = req.body && req.body.backfill === true;
    await (0, email_1.sendVerificationEmail)(normalizedEmail, newToken, { backfill });
    res.json({ message: 'Verification email resent.' });
});
// GET /v1/auth/me — inspect metadata for the authenticated key
router.get('/me', apiKey_1.requireApiKey, async (req, res) => {
    const keyRecord = req.apiKeyRecord;
    if (!keyRecord) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const result = await config_1.db.query(`SELECT id, email, tier, daily_limit, rpm_limit, created_at, last_used_at, total_queries
     FROM api_keys
     WHERE id = $1`, [keyRecord.id]);
    if (result.rows.length === 0) {
        res.status(404).json({ error: 'key not found' });
        return;
    }
    const row = result.rows[0];
    const tierLimits = config_1.TIER_LIMITS[row.tier] ?? config_1.FREE_TIER;
    const dailyLimit = (row.daily_limit && row.daily_limit > 0) ? row.daily_limit : tierLimits.daily;
    const rpmLimit = (row.rpm_limit && row.rpm_limit > 0) ? row.rpm_limit : tierLimits.rpm;
    res.json({
        key_id: row.id,
        email: row.email || null,
        tier: row.tier,
        limits: {
            queries_per_day: dailyLimit,
            requests_per_second: rpmLimit,
        },
        created_at: row.created_at ? row.created_at.toISOString() : null,
        last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
        total_queries: row.total_queries || 0,
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
