"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESS_TOKEN_TTL_S = exports.OAUTH_SCOPES_ALLOWED = void 0;
exports.sanitizeScopes = sanitizeScopes;
exports.createOAuthClient = createOAuthClient;
exports.authenticateClient = authenticateClient;
exports.issueClientCredentialsToken = issueClientCredentialsToken;
exports.verifyAccessToken = verifyAccessToken;
// OAuth M2 store (2026-08-22) — pure data layer per docs/oauth-design.md.
// No route wiring in this commit; endpoints switch from 501 to live in M2 step 2.
// Every access token maps to an api_keys row so existing enforcement applies.
const crypto_1 = require("crypto");
const uuid_1 = require("uuid");
const config_1 = require("../config");
exports.OAUTH_SCOPES_ALLOWED = ['catalog.read', 'offers.read'];
exports.ACCESS_TOKEN_TTL_S = 3600;
const sha256 = (s) => (0, crypto_1.createHash)('sha256').update(s).digest('hex');
function sanitizeScopes(requested) {
    if (!Array.isArray(requested) || requested.length === 0) {
        return [...exports.OAUTH_SCOPES_ALLOWED];
    }
    const ok = requested.filter((s) => typeof s === 'string' && exports.OAUTH_SCOPES_ALLOWED.includes(s));
    return ok.length ? ok : [...exports.OAUTH_SCOPES_ALLOWED];
}
async function createOAuthClient(opts) {
    const clientId = `bwc_${(0, crypto_1.randomBytes)(16).toString('hex')}`;
    const secret = opts.clientType === 'confidential' ? `bwcs_${(0, crypto_1.randomBytes)(24).toString('hex')}` : undefined;
    await config_1.catalogDb.query(`INSERT INTO oauth_clients
       (id, client_id, client_secret_hash, client_name, client_type, redirect_uris, scopes, registration_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [(0, uuid_1.v4)(), clientId, secret ? sha256(secret) : null, opts.clientName.slice(0, 200),
        opts.clientType, opts.redirectUris.slice(0, 10), opts.scopes, opts.registrationIp]);
    return {
        client_id: clientId,
        ...(secret ? { client_secret: secret } : {}),
        client_name: opts.clientName.slice(0, 200),
        client_type: opts.clientType,
        scopes: opts.scopes,
    };
}
async function authenticateClient(clientId, clientSecret) {
    const r = await config_1.catalogDb.query(`SELECT client_secret_hash, client_type, scopes, api_key_id, disabled_at
     FROM oauth_clients WHERE client_id = $1`, [clientId]);
    if (!r.rows.length)
        return { ok: false, reason: 'invalid_client' };
    const row = r.rows[0];
    if (row.disabled_at)
        return { ok: false, reason: 'client_disabled' };
    if (row.client_type === 'confidential') {
        if (!clientSecret)
            return { ok: false, reason: 'invalid_client' };
        const given = new Uint8Array(Buffer.from(sha256(clientSecret)));
        const stored = new Uint8Array(Buffer.from(String(row.client_secret_hash || '')));
        if (given.length !== stored.length || !(0, crypto_1.timingSafeEqual)(given, stored)) {
            return { ok: false, reason: 'invalid_client' };
        }
    }
    return { ok: true, scopes: row.scopes, clientType: row.client_type, apiKeyId: row.api_key_id };
}
/** client_credentials grant: mint an opaque access token; lazily create + link the
 *  api_keys row on first grant so all existing key enforcement applies. */
async function issueClientCredentialsToken(clientId, scopes) {
    // ensure linked api_key
    const c = await config_1.catalogDb.query(`SELECT api_key_id, client_name FROM oauth_clients WHERE client_id = $1`, [clientId]);
    let apiKeyId = c.rows[0]?.api_key_id ?? null;
    if (!apiKeyId) {
        apiKeyId = (0, uuid_1.v4)();
        const rawKey = `bw_${(0, uuid_1.v4)().replace(/-/g, '')}`;
        await config_1.catalogDb.query(`INSERT INTO api_keys (id, key_hash, name, tier, is_active, signup_channel, developer_id, scopes)
       VALUES ($1, $2, $3, 'unverified', true, 'oauth', 'oauth-client', $4)`, [apiKeyId, sha256(rawKey), `oauth:${(c.rows[0]?.client_name || clientId).slice(0, 180)}`, scopes]);
        await config_1.catalogDb.query(`UPDATE oauth_clients SET api_key_id = $1 WHERE client_id = $2`, [apiKeyId, clientId]);
    }
    const token = `bwoat_${(0, crypto_1.randomBytes)(32).toString('base64url')}`;
    await config_1.catalogDb.query(`INSERT INTO oauth_tokens (token_hash, client_id, api_key_id, kind, scopes, expires_at)
     VALUES ($1, $2, $3, 'access', $4, now() + interval '${exports.ACCESS_TOKEN_TTL_S} seconds')`, [sha256(token), clientId, apiKeyId, scopes]);
    return { access_token: token, token_type: 'Bearer', expires_in: exports.ACCESS_TOKEN_TTL_S, scope: scopes.join(' ') };
}
/** Resolve a bwoat_ bearer to its api_key id (for the auth middleware in step 2). */
async function verifyAccessToken(token) {
    if (!token.startsWith('bwoat_'))
        return null;
    const r = await config_1.catalogDb.query(`SELECT api_key_id, scopes FROM oauth_tokens
     WHERE token_hash = $1 AND kind = 'access' AND revoked_at IS NULL AND expires_at > now()`, [sha256(token)]);
    if (!r.rows.length || !r.rows[0].api_key_id)
        return null;
    return { apiKeyId: r.rows[0].api_key_id, scopes: r.rows[0].scopes || [] };
}
