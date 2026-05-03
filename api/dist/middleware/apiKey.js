"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashKey = hashKey;
exports.requireApiKey = requireApiKey;
exports.checkRateLimit = checkRateLimit;
const crypto_1 = require("crypto");
const config_1 = require("../config");
const errors_1 = require("./errors");
const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'https://api.paperclip.ai';
const TIER_LIMITS = {
    free: config_1.FREE_TIER,
    pro: { rpm: 300, daily: 10000 },
    enterprise: { rpm: 1000, daily: 100000 },
};
function hashKey(rawKey) {
    return (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
}
function base64UrlDecode(s) {
    const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf8');
}
function isPaperclipJwtPayload(payload) {
    return payload.iss === 'paperclip' && payload.aud === 'paperclip-api';
}
async function verifyPaperclipTokenWithApi(token) {
    try {
        const resp = await fetch(`${PAPERCLIP_API_URL}/api/agents/me`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
        });
        if (resp.status === 200) {
            const data = await resp.json();
            if (data.id)
                return data;
        }
        return null;
    }
    catch {
        return null;
    }
}
async function resolvePaperclipAgentKey(agentId) {
    const result = await config_1.db.query(`SELECT id, key_hash, name, tier, signup_channel, attribution_source
     FROM api_keys
     WHERE signup_channel = 'paperclip_agent'
       AND name = $1
       AND is_active = true`, [agentId]);
    if (result.rows.length > 0) {
        const row = result.rows[0];
        config_1.db.query('UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1', [row.key_hash]).catch(() => { });
        return row;
    }
    return null;
}
async function upsertPaperclipAgentKey(agentId, agentName, companyId) {
    const existing = await resolvePaperclipAgentKey(agentId);
    if (existing)
        return existing;
    const keyHash = hashKey(agentId);
    const result = await config_1.db.query(`INSERT INTO api_keys (key_hash, name, tier, signup_channel, developer_id, rpm_limit, daily_limit)
     VALUES ($1, $2, 'enterprise', 'paperclip_agent', $3, 1000, 100000)
     ON CONFLICT (key_hash) DO UPDATE SET last_used_at = NOW()
     RETURNING id, key_hash, name, tier, signup_channel, attribution_source`, [keyHash, agentName, companyId || null]);
    return result.rows[0];
}
function decodeJwtPayload(token) {
    const parts = token.split('.');
    if (parts.length !== 3)
        return null;
    try {
        return JSON.parse(base64UrlDecode(parts[1]));
    }
    catch {
        return null;
    }
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
        (0, errors_1.sendError)(res, errors_1.ErrorCode.MISSING_API_KEY);
        return;
    }
    // Detect Paperclip JWT — decode payload without signature verification
    const jwtPayload = decodeJwtPayload(key);
    if (jwtPayload && isPaperclipJwtPayload(jwtPayload)) {
        const agentInfo = await verifyPaperclipTokenWithApi(key);
        if (agentInfo) {
            const row = await upsertPaperclipAgentKey(agentInfo.id, agentInfo.name, agentInfo.companyId);
            req.apiKeyRecord = {
                id: row.id,
                key,
                agentName: row.name,
                tier: row.tier,
                rpmLimit: TIER_LIMITS.enterprise.rpm,
                dailyLimit: TIER_LIMITS.enterprise.daily,
                signupChannel: row.signup_channel,
                attributionSource: row.attribution_source,
            };
            next();
            return;
        }
        (0, errors_1.sendError)(res, errors_1.ErrorCode.INVALID_API_KEY, 'Invalid Paperclip token');
        return;
    }
    const keyHash = hashKey(key);
    const result = await config_1.db.query(`SELECT id, key_hash, name, tier, signup_channel, attribution_source, is_active
     FROM api_keys WHERE key_hash = $1`, [keyHash]);
    if (result.rows.length === 0) {
        (0, errors_1.sendError)(res, errors_1.ErrorCode.INVALID_API_KEY);
        return;
    }
    const row = result.rows[0];
    if (!row.is_active) {
        (0, errors_1.sendError)(res, errors_1.ErrorCode.REVOKED_API_KEY);
        return;
    }
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
    let rpmCount;
    let dailyCount;
    try {
        [rpmCount, dailyCount] = await Promise.all([
            config_1.redis.incr(rpmKey),
            config_1.redis.incr(dailyKey),
        ]);
        if (rpmCount === 1)
            config_1.redis.expire(rpmKey, 120).catch(() => { });
        if (dailyCount === 1)
            config_1.redis.expire(dailyKey, 172800).catch(() => { });
    }
    catch (_err) {
        console.warn('[rate-limit] Redis unavailable, skipping rate limit check');
        next();
        return;
    }
    if (rpmCount > req.apiKeyRecord.rpmLimit) {
        const retryAfter = Math.ceil(60 - (now % 60000) / 1000);
        (0, errors_1.sendRateLimitError)(res, retryAfter, req.apiKeyRecord.rpmLimit, 0, 'Per-minute rate limit exceeded.');
        return;
    }
    if (dailyCount > req.apiKeyRecord.dailyLimit) {
        const retryAfter = Math.ceil(86400 - (now % 86400000) / 1000);
        (0, errors_1.sendRateLimitError)(res, retryAfter, req.apiKeyRecord.dailyLimit, 0, 'Daily rate limit exceeded.');
        return;
    }
    next();
}
