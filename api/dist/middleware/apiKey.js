"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashKey = hashKey;
exports.requireApiKey = requireApiKey;
exports.checkRateLimit = checkRateLimit;
const crypto_1 = require("crypto");
const http_1 = require("http");
const https_1 = require("https");
const config_1 = require("../config");
const errors_1 = require("./errors");
const errors_2 = require("./errors");
const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'https://api.paperclip.ai';
const JWT_CACHE_TTL_SECONDS = 300;
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
function jwtCacheKey(token) {
    return `jwt:verify:${(0, crypto_1.createHash)('sha256').update(token).digest('hex')}`;
}
async function getCachedJwtVerification(token) {
    try {
        const cached = await config_1.redis.get(jwtCacheKey(token));
        if (cached)
            return JSON.parse(cached);
    }
    catch {
    }
    return null;
}
async function setCachedJwtVerification(token, info) {
    try {
        await config_1.redis.set(jwtCacheKey(token), JSON.stringify(info), 'EX', JWT_CACHE_TTL_SECONDS);
    }
    catch {
    }
}
async function verifyPaperclipTokenWithApi(token) {
    const url = new URL(`${PAPERCLIP_API_URL}/api/agents/me`);
    const isHttps = url.protocol === 'https:';
    const requestFn = isHttps ? https_1.request : http_1.request;
    return new Promise((resolve) => {
        const connectTimeout = 2000;
        const headersTimeout = 3000;
        let settled = false;
        const req = requestFn({
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
            },
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk.toString();
            });
            res.on('end', () => {
                if (settled)
                    return;
                settled = true;
                if (res.statusCode === 200) {
                    try {
                        const data = JSON.parse(body);
                        if (data.id) {
                            resolve(data);
                            return;
                        }
                    }
                    catch { }
                }
                resolve(null);
            });
        });
        req.on('socket', (socket) => {
            socket.setTimeout(connectTimeout, () => {
                if (!settled) {
                    settled = true;
                    req.destroy(new Error('socket timeout'));
                    resolve(null);
                }
            });
        });
        req.on('error', () => {
            if (!settled) {
                settled = true;
                resolve(null);
            }
        });
        req.setTimeout(headersTimeout, () => {
            if (!settled) {
                settled = true;
                req.destroy(new Error('headers timeout'));
                resolve(null);
            }
        });
        req.end();
    });
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
function nextMidnightUTC() {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d;
}
function tierDailyLimit(tier, rowDailyLimit) {
    if (rowDailyLimit != null && rowDailyLimit > 0)
        return rowDailyLimit;
    return (config_1.TIER_LIMITS[tier] ?? config_1.FREE_TIER).daily;
}
function tierRpmLimit(tier, rowRpmLimit) {
    if (rowRpmLimit != null && rowRpmLimit > 0)
        return rowRpmLimit;
    return (config_1.TIER_LIMITS[tier] ?? config_1.FREE_TIER).rpm;
}
async function requireApiKey(req, res, next) {
    try {
        const authHeader = req.headers['authorization'] || '';
        const xApiKey = req.headers['x-api-key'];
        const queryKey = req.query['api_key'];
        let key;
        if (authHeader.startsWith('Bearer ')) {
            key = authHeader.slice(7).trim();
        }
        else if (authHeader.startsWith('ApiKey ')) {
            key = authHeader.slice(7).trim();
        }
        else if (xApiKey) {
            key = xApiKey.trim();
        }
        else if (queryKey) {
            key = queryKey;
        }
        if (!key) {
            (0, errors_2.sendSpecError)(res, 'missing_api_key', 'API key required. Get one at https://buywhere.ai/dashboard', 401);
            return;
        }
        const jwtPayload = decodeJwtPayload(key);
        if (jwtPayload && isPaperclipJwtPayload(jwtPayload)) {
            let agentInfo = await getCachedJwtVerification(key);
            if (!agentInfo) {
                agentInfo = await verifyPaperclipTokenWithApi(key);
                if (agentInfo) {
                    await setCachedJwtVerification(key, agentInfo);
                }
            }
            if (agentInfo) {
                try {
                    const row = await upsertPaperclipAgentKey(agentInfo.id, agentInfo.name, agentInfo.companyId);
                    const limits = config_1.TIER_LIMITS[row.tier] ?? config_1.TIER_LIMITS.enterprise;
                    req.apiKeyRecord = {
                        id: row.id,
                        key,
                        agentName: row.name,
                        tier: row.tier,
                        rpmLimit: limits.rpm,
                        dailyLimit: limits.daily,
                        signupChannel: row.signup_channel,
                        attributionSource: row.attribution_source,
                        dailyRequestCount: 0,
                        dailyResetAt: nextMidnightUTC(),
                    };
                    next();
                    return;
                }
                catch (err) {
                    console.error('[auth] upsertPaperclipAgentKey failed:', err);
                    (0, errors_1.sendError)(res, errors_1.ErrorCode.INTERNAL_ERROR, 'Auth key setup failed');
                    return;
                }
            }
            (0, errors_2.sendSpecError)(res, 'invalid_api_key', 'Invalid Paperclip token', 401);
            return;
        }
        const keyHash = hashKey(key);
        const result = await config_1.db.query(`SELECT id, key_hash, name, tier, signup_channel, attribution_source, is_active
       FROM api_keys WHERE key_hash = $1`, [keyHash]);
        if (result.rows.length === 0) {
            (0, errors_2.sendSpecError)(res, 'invalid_api_key', undefined, 401);
            return;
        }
        const row = result.rows[0];
        if (!row.is_active) {
            (0, errors_2.sendSpecError)(res, 'invalid_api_key', 'API key has been revoked', 401);
            return;
        }
        const limits = config_1.TIER_LIMITS[row.tier] ?? config_1.FREE_TIER;
        config_1.db.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => { });
        req.apiKeyRecord = {
            id: row.id,
            key,
            agentName: row.name,
            tier: row.tier,
            rpmLimit: limits.rpm,
            dailyLimit: limits.daily,
            signupChannel: row.signup_channel,
            attributionSource: row.attribution_source,
            dailyRequestCount: 0,
            dailyResetAt: nextMidnightUTC(),
        };
        next();
    }
    catch (err) {
        console.error('[auth] requireApiKey error:', err);
        (0, errors_1.sendError)(res, errors_1.ErrorCode.INTERNAL_ERROR, 'Authentication error');
    }
}
async function checkRateLimit(req, res, next) {
    try {
        if (!req.apiKeyRecord) {
            next();
            return;
        }
        const key = req.apiKeyRecord.key;
        const now = Date.now();
        const minuteWindow = Math.floor(now / 60000);
        const rpmKey = `rl:rpm:${key}:${minuteWindow}`;
        let rpmCount;
        try {
            rpmCount = await config_1.redis.incr(rpmKey);
            if (rpmCount === 1)
                config_1.redis.expire(rpmKey, 120).catch(() => { });
        }
        catch (_err) {
            console.warn('[rate-limit] Redis unavailable, skipping rate limit check');
            next();
            return;
        }
        if (rpmCount > req.apiKeyRecord.rpmLimit) {
            (0, errors_2.sendPerMinuteLimitError)(res, req.apiKeyRecord.tier, req.apiKeyRecord.rpmLimit);
            return;
        }
        next();
    }
    catch (err) {
        console.error('[rate-limit] checkRateLimit error:', err);
        next();
    }
}
