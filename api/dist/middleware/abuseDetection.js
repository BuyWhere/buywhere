"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ABUSE_LIMITS = void 0;
exports.abuseDetection = abuseDetection;
exports.recordInvalidKeyAttempt = recordInvalidKeyAttempt;
exports.recordProductsReturned = recordProductsReturned;
const config_1 = require("../config");
Object.defineProperty(exports, "ABUSE_LIMITS", { enumerable: true, get: function () { return config_1.ABUSE_LIMITS; } });
const errors_1 = require("./errors");
function getClientIp(req) {
    return (req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.socket.remoteAddress ||
        'unknown');
}
async function sendAbuseError(res, retryAfter, message) {
    (0, errors_1.sendRateLimitError)(res, retryAfter, 0, 0, message);
}
function abuseDetection() {
    return async (req, res, next) => {
        const ip = getClientIp(req);
        const now = Date.now();
        const minuteWindow = Math.floor(now / 60000);
        try {
            const ipMinuteKey = `abuse:ip:${ip}:${minuteWindow}`;
            const [ipMinuteCount] = await config_1.redis.pipeline()
                .incr(ipMinuteKey)
                .expire(ipMinuteKey, 120)
                .exec();
            const emptyQuery = req.query.q === '' ||
                req.query.q === '*' ||
                (typeof req.query.q === 'string' && req.query.q.trim() === '');
            const invalidLimit = Number(req.query.limit) > 100;
            if (emptyQuery) {
                (0, errors_1.sendError)(res, errors_1.ErrorCode.INVALID_QUERY, 'Query parameter q cannot be empty or wildcard.');
                return;
            }
            if (invalidLimit) {
                (0, errors_1.sendError)(res, errors_1.ErrorCode.INVALID_PARAMETER, 'Limit cannot exceed 100.');
                return;
            }
            const rapidFireKey = `abuse:rapid:${ip}:${req.path}:${JSON.stringify(req.query)}:${minuteWindow}`;
            const [rapidFireCount] = await config_1.redis.pipeline()
                .incr(rapidFireKey)
                .expire(rapidFireKey, config_1.ABUSE_LIMITS.RAPID_FIRE_WINDOW_SEC)
                .exec();
            const rfCount = rapidFireCount || 0;
            if (rfCount > config_1.ABUSE_LIMITS.RAPID_FIRE_THRESHOLD) {
                await sendAbuseError(res, 60, 'Too many identical requests. Please slow down.');
                return;
            }
            // Check if IP is currently blocked (from invalid key attempts tracked by recordInvalidKeyAttempt)
            const blockKey = `abuse:blocked:${ip}`;
            const ttl = await config_1.redis.ttl(blockKey);
            if (ttl > 0) {
                sendAbuseError(res, ttl, 'Too many invalid API key attempts. IP temporarily blocked.');
                return;
            }
            next();
        }
        catch (_err) {
            console.warn('[abuse-detection] Redis error, skipping check:', _err.message);
            next();
        }
    };
}
async function recordInvalidKeyAttempt(req) {
    const ip = getClientIp(req);
    const fiveMinWindow = Math.floor(Date.now() / 300000);
    const key = `abuse:invkey:${ip}:${fiveMinWindow}`;
    const blockKey = `abuse:blocked:${ip}`;
    try {
        const count = await config_1.redis.incr(key);
        if (count === 1) {
            await config_1.redis.expire(key, config_1.ABUSE_LIMITS.INVALID_KEY_WINDOW_SEC);
        }
        if (count >= config_1.ABUSE_LIMITS.INVALID_KEY_MAX_ATTEMPTS) {
            await config_1.redis.setex(blockKey, config_1.ABUSE_LIMITS.INVALID_KEY_BLOCK_SEC, '1');
        }
    }
    catch (_err) {
        // non-critical
    }
}
async function recordProductsReturned(req, count) {
    if (count <= 0)
        return;
    const ip = getClientIp(req);
    const minuteWindow = Math.floor(Date.now() / 60000);
    const key = `abuse:products:${ip}:${minuteWindow}`;
    try {
        const newTotal = await config_1.redis.incrby(key, count);
        if (newTotal === count) {
            await config_1.redis.expire(key, 120);
        }
        if (newTotal > config_1.ABUSE_LIMITS.SCRAPE_PRODUCTS_PER_MIN_PER_IP) {
            const blockKey = `abuse:blocked:${ip}`;
            await config_1.redis.setex(blockKey, 60, '1');
        }
    }
    catch (_err) {
        // non-critical
    }
}
