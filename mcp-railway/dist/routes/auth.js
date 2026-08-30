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
async function registerAgent(req, res) {
    const { agent_name, email, contact, use_case, is_internal: reqIsInternal } = req.body;
    if (!agent_name || typeof agent_name !== 'string') {
        res.status(400).json({ error: 'agent_name is required' });
        return;
    }
    // BUY-72823: internal-flag registration — only honored when the caller
    // presents the shared BUYWHERE_SIGNUP_SECRET header. Without the secret,
    // any "is_internal" in the body is silently ignored (column default = false).
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
    const signupChannel = resolveSignupChannel(req.headers['referer'], utmSource, utmMedium);
    const verificationToken = hasEmail ? generateVerificationToken() : null;
    const expiresAt = hasEmail ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
    const id = (0, uuid_1.v4)();
    await config_1.db.query(`INSERT INTO api_keys
       (id, key_hash, name, email, contact, use_case, tier, is_active,
        signup_channel, attribution_source, developer_id,
        email_verification_token, email_verification_expires_at,
        is_internal)
      VALUES ($1,$2,$3,$4,$5,$6,'unverified',true,$7,$8,'self-registered',$9,$10,$11)`, [
        id,
        keyHash,
        agent_name.trim().slice(0, 200),
        hasEmail ? emailAddr.slice(0, 500) : null,
        hasEmail ? emailAddr.slice(0, 500) : null, // also set contact for backward compat
        use_case ? String(use_case).slice(0, 1000) : null,
        signupChannel,
        utmSource || null,
        verificationToken,
        expiresAt,
        isInternal,
    ]);
    // Fire PostHog registration event (async, non-blocking)
    (0, posthog_1.trackRegistration)(hashKey(rawKey), agent_name, signupChannel, utmSource || null);
    // Send verification email only when an email was supplied (optional for agents)
    if (hasEmail && verificationToken) {
        (0, email_1.sendVerificationEmail)(emailAddr, verificationToken)
            .then((sent) => {
            if (sent) {
                config_1.db.query(`UPDATE api_keys SET email_verification_sent_at = NOW() WHERE key_hash = $1`, [keyHash]).catch(() => { });
            }
        })
            .catch(() => { });
    }
    res.status(201).json({
        api_key: rawKey,
        tier: 'unverified',
        email_verified: false,
        rate_limit: {
            rpm: config_1.TIER_LIMITS.unverified.rpm,
            daily: config_1.TIER_LIMITS.unverified.daily,
        },
        docs: 'https://api.buywhere.ai/docs',
    });
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
    const result = await config_1.db.query(`UPDATE api_keys
       SET email_verified = true,
           email_verification_token = NULL,
           email_verification_expires_at = NULL,
           tier = 'verified_agent'
     WHERE email_verification_token = $1
       AND email_verified = false
       AND (email_verification_expires_at IS NULL OR email_verification_expires_at > NOW())
     RETURNING id, email, tier, rpm_limit, daily_limit`, [token]);
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
    await (0, email_1.sendVerificationEmail)(normalizedEmail, newToken);
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
