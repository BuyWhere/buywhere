"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const crypto_1 = require("crypto");
const config_1 = require("../config");
const errors_1 = require("../middleware/errors");
const router = (0, express_1.Router)();
function hashKey(rawKey) {
    return (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
}
// POST /v1/keys — create a new API key
// Requires an admin API key passed as X-Admin-Key header or matching
// ADMIN_API_KEY env var. This is distinct from the public registration
// endpoint (/v1/auth/register) which requires email verification.
router.post('/', async (req, res) => {
    const adminKey = process.env.ADMIN_API_KEY;
    const providedKey = req.headers['x-admin-key'];
    if (adminKey && providedKey !== adminKey) {
        (0, errors_1.sendError)(res, errors_1.ErrorCode.INVALID_API_KEY, 'Valid admin key required via X-Admin-Key header');
        return;
    }
    const { name, email, tier, rpm_limit, daily_limit } = req.body;
    if (!name || typeof name !== 'string') {
        (0, errors_1.sendError)(res, errors_1.ErrorCode.INVALID_PARAMETER, 'name is required');
        return;
    }
    const rawKey = `bw_${(0, uuid_1.v4)().replace(/-/g, '')}`;
    const keyHash = hashKey(rawKey);
    const resolvedTier = typeof tier === 'string' ? tier : 'free';
    const resolvedRpm = typeof rpm_limit === 'number' ? rpm_limit : 60;
    const resolvedDaily = typeof daily_limit === 'number' ? daily_limit : 1000;
    try {
        await config_1.db.query(`INSERT INTO api_keys
         (id, key_hash, name, email, tier, is_active, rpm_limit, daily_limit, signup_channel)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true, $5, $6, 'api_key_endpoint')`, [keyHash, name.trim().slice(0, 200), email ? String(email).slice(0, 500) : null, resolvedTier, resolvedRpm, resolvedDaily]);
        res.status(201).json({
            api_key: rawKey,
            tier: resolvedTier,
            name: name.trim().slice(0, 200),
            rate_limit: { rpm: resolvedRpm, daily: resolvedDaily },
        });
    }
    catch (err) {
        console.error('[keys] create error:', err);
        (0, errors_1.sendError)(res, errors_1.ErrorCode.INTERNAL_ERROR);
    }
});
exports.default = router;
