"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const uuid_1 = require("uuid");
const config_1 = require("../config");
const errors_1 = require("../middleware/errors");
const router = (0, express_1.Router)();
function hashKey(rawKey) {
    return (0, crypto_1.createHash)('sha256').update(rawKey).digest('hex');
}
function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomPart = (0, crypto_1.randomBytes)(32).toString('hex');
    let key = 'bw_live_';
    for (let i = 0; i < 32; i++) {
        key += chars[parseInt(randomPart.substr(i * 2, 2), 16) % chars.length];
    }
    return key;
}
// POST /v1/keys — public headless-key lifecycle
// Creates a new API key. Accepts label (or name for backward compat) and
// optional tier. Admin gating via X-Admin-Key / ADMIN_API_KEY is still
// supported but not required — omit to use as a public endpoint.
router.post('/', async (req, res) => {
    const adminKey = process.env.ADMIN_API_KEY;
    const providedKey = req.headers['x-admin-key'];
    if (adminKey && providedKey !== adminKey) {
        (0, errors_1.sendError)(res, errors_1.ErrorCode.INVALID_API_KEY, 'Valid admin key required via X-Admin-Key header');
        return;
    }
    const { label, name, email, tier, rpm_limit, daily_limit } = req.body;
    // Accept label (public headless-key contract) or name (legacy admin contract)
    const resolvedLabel = (label || name || '');
    const rawKey = generateApiKey();
    const keyHash = hashKey(rawKey);
    const id = (0, uuid_1.v4)();
    const resolvedTier = typeof tier === 'string' ? tier : 'free';
    const resolvedRpm = typeof rpm_limit === 'number' ? rpm_limit : 60;
    const resolvedDaily = typeof daily_limit === 'number' ? daily_limit : 1000;
    const labelValue = resolvedLabel ? resolvedLabel.trim().slice(0, 200) : `headless-key-${id.slice(0, 8)}`;
    try {
        await config_1.db.query(`INSERT INTO api_keys
         (id, key_hash, name, email, tier, is_active, rpm_limit, daily_limit, signup_channel, developer_id, label)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, 'api_key_endpoint', 'api_key_endpoint', $8)`, [id, keyHash, labelValue, email ? String(email).slice(0, 500) : null, resolvedTier, resolvedRpm, resolvedDaily, labelValue]);
        res.status(201).json({
            api_key: rawKey,
            tier: resolvedTier,
            label: labelValue,
            rate_limit: { rpm: resolvedRpm, daily: resolvedDaily },
        });
    }
    catch (err) {
        console.error('[keys] create error:', err);
        (0, errors_1.sendError)(res, errors_1.ErrorCode.INTERNAL_ERROR);
    }
});
exports.default = router;
