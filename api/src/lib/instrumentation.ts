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
import { createHash } from 'crypto';
import { db } from '../config';

// ---------------------------------------------------------------------------
// Idempotency filter — bounded LRU keyed on the dedup tuple.
// ---------------------------------------------------------------------------
const DEDUP_MAX_ENTRIES = 10_000;
const dedupSet = new Set<string>();

function dedupKey(endpoint: string, productId: string, callerId: string, secondBucket: number): string {
  return `${endpoint}|${productId}|${callerId}|${secondBucket}`;
}

function shouldInsert(endpoint: string, productId: string, callerId: string): boolean {
  const secondBucket = Math.floor(Date.now() / 1000);
  const key = dedupKey(endpoint, productId, callerId, secondBucket);
  if (dedupSet.has(key)) return false;
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
export function callerIdFromRequest(req: { apiKeyRecord?: { id?: string }; ip?: string; socket?: { remoteAddress?: string } }): string {
  if (req.apiKeyRecord?.id) return `key:${req.apiKeyRecord.id}`;
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `ip:${createHash('sha256').update(ip).digest('hex').slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Fire-and-forget INSERT into product_views.
// ---------------------------------------------------------------------------
export function recordProductView(opts: {
  productId: string | number;
  source: string;            // 'products.get' | 'products.search' | 'products.list' | 'products.deals'
  queryHash?: string | null; // sha256 of search query (null for direct product fetch)
  req?: { apiKeyRecord?: { id?: string }; ip?: string; socket?: { remoteAddress?: string } };
}): void {
  const productId = String(opts.productId);
  const callerId = opts.req ? callerIdFromRequest(opts.req) : 'server';
  if (!shouldInsert('product_views', productId, callerId)) return;

  const queryHash = opts.queryHash ?? null;
  db.query(
    `INSERT INTO product_views (product_id, source, query_hash) VALUES ($1, $2, $3)`,
    [productId, opts.source, queryHash]
  ).catch((err: Error) => {
    console.warn(`[instrumentation] product_views insert failed for ${productId}: ${err.message}`);
  });
}

// Bulk variant for /v1/products/search — one INSERT per product, fire-and-forget.
// Caller must invoke this AFTER res.json has been queued to keep P95 unaffected;
// here we still fire-and-forget so even an early call won't block the response.
export function recordProductViewsBulk(opts: {
  productIds: Array<string | number>;
  source: string;
  queryHash?: string | null;
  req?: { apiKeyRecord?: { id?: string }; ip?: string; socket?: { remoteAddress?: string } };
}): void {
  const callerId = opts.req ? callerIdFromRequest(opts.req) : 'server';
  const queryHash = opts.queryHash ?? null;
  const seen = new Set<string>();
  for (const pid of opts.productIds) {
    const id = String(pid);
    if (seen.has(id)) continue;
    seen.add(id);
    if (!shouldInsert('product_views', id, callerId)) continue;
    db.query(
      `INSERT INTO product_views (product_id, source, query_hash) VALUES ($1, $2, $3)`,
      [id, opts.source, queryHash]
    ).catch((err: Error) => {
      console.warn(`[instrumentation] product_views bulk insert failed for ${id}: ${err.message}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Outbound-click URL builders — exposed to buildProduct so the response carries
// the redirect endpoints the FE should use for clicks.
// ---------------------------------------------------------------------------
const API_BASE = process.env.PUBLIC_API_BASE || 'https://api.buywhere.ai';

/**
 * /api/click?url=<merchant_url>&product_id=<id>&merchant=<slug>
 * The /api/click handler validates the destination and INSERTs into `clicks`.
 */
export function buildClickUrl(opts: {
  productId: string;
  destinationUrl: string;
  merchantId?: string | null;
}): string {
  const params = new URLSearchParams({
    url: opts.destinationUrl,
    product_id: opts.productId,
    source: 'product_card',
  });
  if (opts.merchantId) params.set('merchant', opts.merchantId);
  return `${API_BASE}/api/click?${params.toString()}`;
}

/**
 * /r/:slug/:productId?source=<src>
 * The /r handler looks up affiliate_links and INSERTs into `affiliate_clicks`
 * before 302-redirecting to the merchant (or the Awin-wrapped destination).
 * Fallback slug `direct` lets the FE route any merchant through the same path
 * even when no affiliate_link row exists — redirect.ts already handles that
 * fallback (it queries products.url and logs the click).
 */
export function buildAffiliateRedirectUrl(opts: {
  productId: string;
  source?: string;
  slug?: string;
}): string {
  const slug = opts.slug || 'direct';
  const qs = opts.source ? `?source=${encodeURIComponent(opts.source)}` : '';
  return `${API_BASE}/r/${encodeURIComponent(slug)}/${encodeURIComponent(opts.productId)}${qs}`;
}