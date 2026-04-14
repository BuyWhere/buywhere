"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireApiKey = requireApiKey;
exports.checkRateLimit = checkRateLimit;
const crypto_1 = require("crypto");
const config_1 = require("../config");
const TIER_LIMITS = {
    free: config_1.FREE_TIER,
    pro: { rpm: 300, daily: 10000 },
    enterprise: { rpm: 1000, daily: 100000 },
};
function hashKey(rawKey) {
    return (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
}
async function requireApiKey(req, res, next) {
    const authHeader = req.headers['authorization'] || '';
    const queryKey = req.query['api_key'];
    let key;
    if (authHeader.startsWith('Bearer ')) {
        key = authHeader.slice(7).trim();
    }
    else if (authHeader.startsWith('ApiKey ')) {
        key = authHeader.slice(7).trim();
    }
    else if (queryKey) {
        key = queryKey;
    }
    if (!key) {
        res.status(401).json({ error: 'API key required. Pass as Authorization: Bearer <key>' });
        return;
    }
    const keyHash = hashKey(key);
    const result = await config_1.db.query(`SELECT id, key_hash, name, tier, signup_channel, attribution_source
     FROM api_keys WHERE key_hash = $1 AND is_active = 1`, [keyHash]);
    if (result.rows.length === 0) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
    }
    const row = result.rows[0];
    const tierLimits = TIER_LIMITS[row.tier] ?? config_1.FREE_TIER;
    req.apiKeyRecord = {
        id: row.id,
        key,
        agentName: row.name,
        tier: row.tier,
        rpmLimit: tierLimits.rpm,
        dailyLimit: tierLimits.daily,
        signupChannel: row.signup_channel,
        attributionSource: row.attribution_source,
    };
    // Update last_used_at (fire-and-forget)
    config_1.db.query('UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1', [keyHash]).catch(() => { });
    next();
}
async function checkRateLimit(req, res, next) {
    if (!req.apiKeyRecord) {
        next();
        return;
    }
    const key = req.apiKeyRecord.key;
    const now = Date.now();
    const minuteWindow = Math.floor(now / 60000);
    const dayWindow = Math.floor(now / 86400000);
    const rpmKey = `rl:rpm:${key}:${minuteWindow}`;
    const dailyKey = `rl:daily:${key}:${dayWindow}`;
    const [rpmCount, dailyCount] = await Promise.all([
        config_1.redis.incr(rpmKey),
        config_1.redis.incr(dailyKey),
    ]);
    // Set TTL on first increment
    if (rpmCount === 1)
        config_1.redis.expire(rpmKey, 120).catch(() => { });
    if (dailyCount === 1)
        config_1.redis.expire(dailyKey, 172800).catch(() => { });
    if (rpmCount > req.apiKeyRecord.rpmLimit) {
        res.status(429).json({
            error: 'Rate limit exceeded',
            limit: req.apiKeyRecord.rpmLimit,
            window: 'per_minute',
            retry_after: 60 - (now % 60000) / 1000,
        });
        return;
    }
    if (dailyCount > req.apiKeyRecord.dailyLimit) {
        res.status(429).json({
            error: 'Daily limit exceeded',
            limit: req.apiKeyRecord.dailyLimit,
            window: 'per_day',
        });
        return;
    }
    next();
}
