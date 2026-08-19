"use strict";
// BUY-22737 / BUY-35381 — admin auth for /v1/admin/*.
//
// Keys live in the BUYWHERE_ADMIN_API_KEYS env var as a comma-separated list
// of opaque strings. Distinct from end-user api_keys (which are DB-backed);
// admin keys are not stored in the database, only in the env.
//
// Compare with constant-time equality to avoid leaking key length / prefix
// to a timing attacker.
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuth = adminAuth;
function timingSafeEqualStr(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}
function getAdminKeys() {
    const raw = process.env.BUYWHERE_ADMIN_API_KEYS || '';
    return raw
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
}
function adminAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing Authorization: Bearer <admin key>' });
        return;
    }
    const presented = match[1].trim();
    const keys = getAdminKeys();
    if (keys.length === 0) {
        // Defensive: if no admin keys are configured, refuse all access rather
        // than accidentally open up the endpoint to anyone with a non-empty header.
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'No BUYWHERE_ADMIN_API_KEYS configured' });
        return;
    }
    for (const k of keys) {
        if (timingSafeEqualStr(presented, k)) {
            return next();
        }
    }
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid admin key' });
}
