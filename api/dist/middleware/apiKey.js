"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const PAPERCLIP_API_URL_FALLBACKS = ['https://api.paperclip.ai', 'https://paperclip.richteo.com'];
const PAPERCLIP_API_URLS = [...new Set([
        ...(process.env.PAPERCLIP_API_URL || '').split(',').map((v) => v.trim()).filter(Boolean),
        ...PAPERCLIP_API_URL_FALLBACKS,
    ])];
const JWT_CACHE_TTL_SECONDS = 300;
// BUY-77823: server-to-server shared-secret bypass. When BuyWhere first-party
// callers (buywhere-site SSR for intent pages, internal jobs) cannot present a
// stored api_keys row, they present `Authorization: Bearer <BUYWHERE_INTERNAL_API_KEY>`.
// The env var is a single long-lived secret rotated via Railway. Without this
// bypass, intent pages render empty (SSR fetches `/api/v1/products/search`
// server-side with no key) — see BUY-77823 SEV-1. The bypass:
//   - only matches when the env var is set (default = bypass disabled)
//   - uses timingSafeEqual on equal-length buffers
//   - is rate-limited per process (1 token bucket; RPM=600, daily=1M) to
//     prevent external abuse if the secret leaks
//   - does NOT expose any DB row — apiKeyRecord is synthetic but counted in usage
//     tables so dashboards still see the call volume
const INTERNAL_API_KEY = process.env.BUYWHERE_INTERNAL_API_KEY || '';
const INTERNAL_RPM = 600;
const INTERNAL_DAILY = 1000000;
const internalTokenBucket = new Map();
const internalDailyBucket = new Map();
function nextMidnightUTCInternal() {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}
function checkInternalRateLimit(key) {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000);
    const dayKey = Math.floor(now.valueOf() / (24 * 60 * 60 * 1000));
    const m = internalTokenBucket.get(`${key}:${minuteKey}`);
    if (!m)
        internalTokenBucket.set(`${key}:${minuteKey}`, { count: 1, resetAt: minuteKey * 60000 + 60000 });
    else {
        m.count++;
        if (m.count > INTERNAL_RPM)
            return false;
    }
    const d = internalDailyBucket.get(`${key}:${dayKey}`);
    if (!d)
        internalDailyBucket.set(`${key}:${dayKey}`, { count: 1, resetAt: nextMidnightUTCInternal().getTime() });
    else {
        d.count++;
        if (d.count > INTERNAL_DAILY)
            return false;
    }
    return true;
}
function matchesInternalKey(candidate) {
    if (!INTERNAL_API_KEY)
        return false;
    if (candidate.length !== INTERNAL_API_KEY.length)
        return false;
    try {
        const a = new Uint8Array(Buffer.from(candidate, 'utf8'));
        const b = new Uint8Array(Buffer.from(INTERNAL_API_KEY, 'utf8'));
        return (0, crypto_1.timingSafeEqual)(a, b);
    }
    catch {
        return false;
    }
}
function attachInternalApiKeyRecord(req, key) {
    req.apiKeyRecord = {
        id: '__internal__',
        key,
        agentName: 'buywhere-internal',
        tier: 'enterprise',
        rpmLimit: INTERNAL_RPM,
        dailyLimit: INTERNAL_DAILY,
        signupChannel: 'internal',
        attributionSource: 'internal',
        isInternal: true,
        dailyRequestCount: 0,
        dailyResetAt: nextMidnightUTCInternal(),
    };
}
function hashKey(rawKey) {
    return (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
}
function apiKeyLookupHashes(rawKey) {
    const hashes = [hashKey(rawKey)];
    if (rawKey.startsWith('bw_beta_')) {
        hashes.push(hashKey(`bw_${rawKey.slice('bw_beta_'.length)}`));
    }
    return [...new Set(hashes)];
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
async function verifyPaperclipTokenAtUrl(token, baseUrl, agentPath) {
    const url = new URL(`${baseUrl}${agentPath}`);
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
async function verifyPaperclipTokenWithApi(token) {
    const agentPaths = ['/api/agents/me', '/agents/me'];
    for (const baseUrl of PAPERCLIP_API_URLS) {
        for (const agentPath of agentPaths) {
            try {
                const result = await verifyPaperclipTokenAtUrl(token, baseUrl, agentPath);
                if (result)
                    return result;
            }
            catch {
                // try next
            }
        }
    }
    return null;
}
async function resolvePaperclipAgentKey(agentId) {
    const result = await config_1.db.query(`SELECT id, key_hash, name, tier, signup_channel, attribution_source, is_internal
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
     RETURNING id, key_hash, name, tier, signup_channel, attribution_source, is_internal`, [keyHash, agentName, companyId || null]);
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
function nextWeekUTC() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    d.setUTCHours(0, 0, 0, 0);
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
        res.set('WWW-Authenticate', 'Bearer realm="buywhere"');
        // 2026-08-24 (Richmond): agents must be able to self-serve with ZERO human
        // steps — the 401 itself carries the machine-actionable recipe.
        res.status(401).json({
            error: 'missing_api_key',
            message: 'No API key. Agents: self-register in one call — no email, no human, key returned instantly.',
            register: {
                method: 'POST',
                url: 'https://api.buywhere.ai/v1/auth/register?verify=false',
                content_type: 'application/json',
                body: { agent_name: '<your-agent-name>' },
                returns: 'api_key (use as Authorization: Bearer <api_key>); 1000 requests/day free',
                oauth_alternative: 'https://api.buywhere.ai/.well-known/oauth-authorization-server',
            },
        });
        return;
    }
    // BUY-77823: server-to-server shared-secret bypass (env-gated). Matched BEFORE
    // any DB lookup so an expired/disabled key check is irrelevant. The bypass is
    // intentionally rate-limited (in-process) so a leaked secret does not unmeter
    // the entire public catalog.
    if (matchesInternalKey(key)) {
        if (!checkInternalRateLimit('__internal__')) {
            (0, errors_2.sendSpecError)(res, 'rate_limited', 'Internal key rate limit exceeded', 429);
            return;
        }
        attachInternalApiKeyRecord(req, key);
        next();
        return;
    }
    // OAuth M2 (2026-08-22): opaque access tokens resolve to their linked api_keys
    // row, so every downstream limit/accounting path applies unchanged.
    if (key.startsWith('bwoat_')) {
        const { verifyAccessToken } = await Promise.resolve().then(() => __importStar(require('../lib/oauthStore')));
        const tok = await verifyAccessToken(key);
        if (!tok) {
            (0, errors_2.sendSpecError)(res, 'invalid_api_key', 'Invalid or expired OAuth access token', 401);
            return;
        }
        const r = await config_1.db.query(`SELECT id, name, tier, signup_channel, attribution_source, is_internal FROM api_keys WHERE id = $1 AND is_active = true`, [tok.apiKeyId]);
        if (!r.rows.length) {
            (0, errors_2.sendSpecError)(res, 'invalid_api_key', 'OAuth client key disabled', 401);
            return;
        }
        const row = r.rows[0];
        const limits = config_1.TIER_LIMITS[row.tier] ?? config_1.TIER_LIMITS.unverified ?? { rpm: 60, daily: 1000 };
        req.apiKeyRecord = {
            id: row.id,
            key,
            agentName: row.name,
            tier: row.tier,
            rpmLimit: limits.rpm,
            dailyLimit: limits.daily,
            signupChannel: row.signup_channel,
            attributionSource: row.attribution_source,
            isInternal: row.is_internal === true,
            dailyRequestCount: 0,
            dailyResetAt: nextMidnightUTC(),
        };
        next();
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
                    isInternal: row.is_internal === true,
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
    const keyHashes = apiKeyLookupHashes(key);
    const result = await config_1.db.query(`SELECT id, key_hash, name, tier, signup_channel, attribution_source, is_active, is_internal,
            daily_request_count, daily_reset_at, weekly_request_count, weekly_reset_at,
            created_at, rpm_limit, daily_limit, failed_request_count
     FROM api_keys WHERE key_hash = ANY($1::text[])`, [keyHashes]);
    if (result.rows.length === 0) {
        (0, errors_2.sendSpecError)(res, 'invalid_api_key', undefined, 401);
        return;
    }
    const row = result.rows[0];
    if (!row.is_active) {
        (0, errors_2.sendSpecError)(res, 'invalid_api_key', 'API key has been revoked', 401);
        return;
    }
    // BUY-72774: pending-verify auto-suspend logic
    // - "key created <1s before first failing request" (track failed_request_count)
    // - "50 calls with 0 outbound_url clicks"
    const pvLimits = config_1.TIER_LIMITS.pending_verify;
    const tier = row.tier;
    const isPendingVerify = tier === 'pending_verify';
    // BUY-72774: 72h expiration for pending-verify keys
    // If neither email verified nor 3-day outbound click promotion happened, expire after 72h
    if (isPendingVerify) {
        const createdAt = row.created_at ? new Date(row.created_at) : null;
        if (createdAt && Date.now() - createdAt.getTime() > 72 * 60 * 60 * 1000) {
            await config_1.db.query('UPDATE api_keys SET is_active = false WHERE id = $1', [row.id]);
            (0, errors_2.sendSpecError)(res, 'invalid_api_key', 'Pending-verify key expired after 72 hours. Please re-register or verify your email.', 403);
            return;
        }
    }
    if (isPendingVerify && row.failed_request_count >= 50) {
        // Auto-suspend: 50+ failed requests (likely bot/abuse)
        await config_1.db.query('UPDATE api_keys SET is_active = false WHERE id = $1', [row.id]);
        (0, errors_2.sendSpecError)(res, 'invalid_api_key', 'API key suspended due to excessive failed requests.', 403);
        return;
    }
    // BUY-72774: auto-suspend if 50+ calls made but zero outbound clicks
    if (isPendingVerify && row.daily_request_count >= 50 && (row.consecutive_outbound_days || 0) === 0) {
        await config_1.db.query('UPDATE api_keys SET is_active = false WHERE id = $1', [row.id]);
        (0, errors_2.sendSpecError)(res, 'invalid_api_key', 'API key suspended: no outbound clicks after 50 API calls.', 403);
        return;
    }
    const dailyLimit = tierDailyLimit(row.tier, row.daily_limit);
    const rpmLimit = tierRpmLimit(row.tier, row.rpm_limit);
    let dailyRequestCount = row.daily_request_count || 0;
    let dailyResetAt = row.daily_reset_at ? new Date(row.daily_reset_at) : nextMidnightUTC();
    let weeklyRequestCount = row.weekly_request_count || 0;
    let weeklyResetAt = row.weekly_reset_at ? new Date(row.weekly_reset_at) : nextWeekUTC();
    const now = new Date();
    // BUY-73693: a row with daily_reset_at=NULL falls back to nextMidnightUTC()
    // (tomorrow midnight), which makes the row forever-stuck at the cap until a
    // fresh reset_at is written. For monitoring-tier keys (no entry in
    // TIER_LIMITS) that were created without a reset_at, the first request to
    // arrive after a cap hit would never reset. Initialize the reset window
    // from row creation time when reset_at is missing AND a counter is present,
    // so the counter can recover on the next request.
    if (!row.daily_reset_at && dailyRequestCount > 0) {
        const createdAt = row.created_at ? new Date(row.created_at) : null;
        const firstReset = createdAt
            ? new Date(Math.ceil(createdAt.getTime() / 86400000) * 86400000)
            : nextMidnightUTC();
        if (now >= firstReset) {
            dailyRequestCount = 0;
            dailyResetAt = nextMidnightUTC();
            config_1.db.query('UPDATE api_keys SET daily_request_count = 0, daily_reset_at = $1 WHERE id = $2', [dailyResetAt, row.id]).catch(() => { });
        }
        else {
            dailyResetAt = firstReset;
        }
    }
    if (now >= dailyResetAt) {
        dailyRequestCount = 0;
        dailyResetAt = nextMidnightUTC();
        config_1.db.query('UPDATE api_keys SET daily_request_count = 0, daily_reset_at = $1 WHERE id = $2', [dailyResetAt, row.id]).catch(() => { });
    }
    // Weekly reset for pending-verify tier
    if (isPendingVerify && now >= weeklyResetAt) {
        weeklyRequestCount = 0;
        weeklyResetAt = nextWeekUTC();
        config_1.db.query('UPDATE api_keys SET weekly_request_count = 0, weekly_reset_at = $1 WHERE id = $2', [weeklyResetAt, row.id]).catch(() => { });
    }
    if (dailyRequestCount >= dailyLimit) {
        (0, errors_2.sendDailyLimitError)(res, row.tier, dailyLimit, dailyResetAt.toISOString());
        return;
    }
    // BUY-72774: weekly limit check for pending-verify tier
    if (isPendingVerify && weeklyRequestCount >= (pvLimits.weekly || 100)) {
        const retryAfter = Math.ceil((weeklyResetAt.getTime() - now.getTime()) / 1000);
        res.set('Retry-After', String(retryAfter));
        res.status(429).json({
            error: 'rate_limit_exceeded',
            message: `Weekly limit of ${pvLimits.weekly} requests reached for pending-verify tier. Resets ${weeklyResetAt.toISOString()}.`,
            tier: 'pending-verify',
            limit: pvLimits.weekly,
            window: '7d',
        });
        return;
    }
    req.apiKeyRecord = {
        id: row.id,
        key,
        agentName: row.name,
        tier: row.tier,
        rpmLimit,
        dailyLimit,
        signupChannel: row.signup_channel,
        attributionSource: row.attribution_source,
        isInternal: row.is_internal === true,
        dailyRequestCount,
        dailyResetAt,
    };
    res.set('X-RateLimit-Limit-Day', String(dailyLimit));
    res.set('X-RateLimit-Remaining-Day', String(Math.max(0, dailyLimit - dailyRequestCount - 1)));
    // Increment both daily and weekly for pending-verify
    if (isPendingVerify) {
        config_1.db.query('UPDATE api_keys SET daily_request_count = daily_request_count + 1, weekly_request_count = weekly_request_count + 1, last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => { });
    }
    else {
        config_1.db.query('UPDATE api_keys SET daily_request_count = daily_request_count + 1, last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => { });
    }
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
