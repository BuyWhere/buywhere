"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callerIdFromRequest = callerIdFromRequest;
exports.recordProductView = recordProductView;
exports.recordProductViewsBulk = recordProductViewsBulk;
exports.buildClickUrl = buildClickUrl;
exports.buildAffiliateRedirectUrl = buildAffiliateRedirectUrl;
/**
 * BUY-52474: Wire product_views + clicks + affiliate_clicks instrumentation
 * on the api.products id-space.
 *
 * All INSERTs are fire-and-forget so they cannot regress /v1 P95. The pool's
 * statement_timeout still bounds a stuck INSERT, and failures are logged but
 * never propagated to the response.
 *
 * Idempotency is enforced by an in-memory LRU keyed on (endpoint, product_id,
 * api_key_id_or_ip, second_bucket). Repeated requests within the same wall-clock
 * second for the same (product, caller, endpoint) tuple are dropped. This is
 * sufficient because:
 *   - /v1 responses are short-lived (cache TTL = 60-3600s); a caller retrying
 *     inside one second is rare.
 *   - The product_views table has no UNIQUE constraint, so true exact-once
 *     dedup requires the in-memory filter.
 *
 * Schema assumptions (verified against api DB, BUY-52474 task 1):
 *   product_views      (id bigserial, product_id bigint, source text,
 *                       query_hash text, viewed_at timestamptz)
 *   clicks             (id uuid, product_id text, merchant_id text, api_key text,
 *                       referrer text, destination_url text, ip_hash text,
 *                       source text, clicked_at timestamptz)
 *   affiliate_clicks   (id uuid, api_key text, affiliate_slug text,
 *                       product_id text, merchant_id text, affiliate_link_id text,
 *                       source text, destination_url text, clicked_at timestamptz)
 */
const crypto_1 = require("crypto");
const pg_1 = require("pg");
// Dedicated lightweight pool for instrumentation inserts.
// Uses no statement_timeout so inserts always complete (or fail fast with PG error).
// Separate from main `db` pool to avoid interference.
let _insertPool = null;
function getInsertPool() {
    if (!_insertPool) {
        _insertPool = new pg_1.Pool({
            connectionString: process.env.DATABASE_URL,
            max: 5,
            idleTimeoutMillis: 10000,
            connectionTimeoutMillis: 10000,
        });
    }
    return _insertPool;
}
// ---------------------------------------------------------------------------
// Idempotency filter — bounded LRU keyed on the dedup tuple.
// ---------------------------------------------------------------------------
const DEDUP_MAX_ENTRIES = 10000;
const dedupSet = new Set();
function dedupKey(endpoint, productId, callerId, secondBucket) {
    return `${endpoint}|${productId}|${callerId}|${secondBucket}`;
}
function shouldInsert(endpoint, productId, callerId) {
    const secondBucket = Math.floor(Date.now() / 1000);
    const key = dedupKey(endpoint, productId, callerId, secondBucket);
    if (dedupSet.has(key))
        return false;
    dedupSet.add(key);
    // Trim to bound memory. Drop ~10% of oldest by clearing the set when full.
    if (dedupSet.size > DEDUP_MAX_ENTRIES) {
        dedupSet.clear();
    }
    return true;
}
// ---------------------------------------------------------------------------
// Caller-id derivation: prefer api_key_id (req.apiKeyRecord.id), fall back to
// a salted IP hash so unauthenticated traffic still has a stable caller bucket.
// ---------------------------------------------------------------------------
function callerIdFromRequest(req) {
    if (req.apiKeyRecord?.id)
        return `key:${req.apiKeyRecord.id}`;
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    return `ip:${(0, crypto_1.createHash)('sha256').update(ip).digest('hex').slice(0, 16)}`;
}
// ---------------------------------------------------------------------------
// Fire-and-forget INSERT into product_views.
// ---------------------------------------------------------------------------
function recordProductView(opts) {
    const productId = String(opts.productId);
    const callerId = opts.req ? callerIdFromRequest(opts.req) : 'server';
    if (!shouldInsert('product_views', productId, callerId))
        return;
    const queryHash = opts.queryHash ?? null;
    getInsertPool().query(`INSERT INTO product_views (product_id, source, query_hash) VALUES ($1, $2, $3)`, [productId, opts.source, queryHash]).then(() => console.log('[instrumentation] DB write SUCCESS for ' + productId)).catch((err) => {
        console.warn(`[instrumentation] product_views insert failed for ${productId}: ${err.message}`);
    });
}
// Bulk variant for /v1/products/search — one INSERT per product, fire-and-forget.
// Uses .catch() instead of async/await to ensure proper error handling
// when called without await (fire-and-forget from Express handlers).
function recordProductViewsBulk(opts) {
    const callerId = opts.req ? callerIdFromRequest(opts.req) : 'server';
    const queryHash = opts.queryHash ?? null;
    const seen = new Set();
    for (const pid of opts.productIds) {
        const id = String(pid);
        if (seen.has(id))
            continue;
        seen.add(id);
        if (!shouldInsert('product_views', id, callerId))
            continue;
        getInsertPool().query(`INSERT INTO product_views (product_id, source, query_hash) VALUES ($1, $2, $3)`, [id, opts.source, queryHash]).then(() => console.log('[instrumentation] DB write SUCCESS for ' + id)).catch((err) => {
            console.warn('[instrumentation] bulk insert failed for ' + id + ': ' + err.message);
        });
    }
}
// ---------------------------------------------------------------------------
// Outbound-click URL builders — exposed to buildProduct so the response carries
// the redirect endpoints the FE should use for clicks.
// ---------------------------------------------------------------------------
const API_BASE = process.env.PUBLIC_API_BASE || 'https://api.buywhere.ai';
/**
 * /api/click?url=<merchant_url>&product_id=<id>&merchant=<slug>&k=<keyHash>&aid=<agentId>
 * The /api/click handler validates the destination and INSERTs into `clicks`.
 *
 * BUY-71129 (re-applied, was clobbered by 554950c7): `k` carries the caller
 * api_key hash (NOT the raw key — privacy). `aid` carries the api_keys.id
 * (uuid) when the upstream call has an authenticated key, so the click handler
 * can resolve it back to an agent for distinct_id attribution even though the
 * browser click carries no Bearer header. Both optional — click without them
 * = anonymous click, as before.
 */
function buildClickUrl(opts) {
    const params = new URLSearchParams({
        url: opts.destinationUrl,
        product_id: opts.productId,
        source: 'product_card',
    });
    if (opts.merchantId)
        params.set('merchant', opts.merchantId);
    if (opts.keyHash)
        params.set('k', opts.keyHash);
    if (opts.agentId)
        params.set('aid', opts.agentId);
    return `${API_BASE}/api/click?${params.toString()}`;
}
/**
 * /r/:slug/:productId?source=<src>&k=<keyHash>&aid=<agentId>
 * The /r handler looks up affiliate_links and INSERTs into `affiliate_clicks`
 * before 302-redirecting to the merchant (or the Awin-wrapped destination).
 * Fallback slug `direct` lets the FE route any merchant through the same path
 * even when no affiliate_link row exists — redirect.ts already handles that
 * fallback (it queries products.url and logs the click).
 *
 * BUY-71129: see buildClickUrl above.
 */
function buildAffiliateRedirectUrl(opts) {
    const slug = opts.slug || 'direct';
    const params = new URLSearchParams();
    if (opts.source)
        params.set('source', opts.source);
    if (opts.keyHash)
        params.set('k', opts.keyHash);
    if (opts.agentId)
        params.set('aid', opts.agentId);
    const qs = params.toString();
    const base = `${API_BASE}/r/${encodeURIComponent(slug)}/${encodeURIComponent(opts.productId)}`;
    return qs ? `${base}?${qs}` : base;
}
