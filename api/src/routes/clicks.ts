/**
 * Outbound click tracking — BUY-4869
 *
 * GET /api/click?url=X&product_id=Y&merchant=Z
 *   Validates destination against allowed-domains whitelist, logs to `clicks`
 *   table, returns 302 redirect.
 *
 * GET /admin/clicks?days=N
 *   Admin-only analytics: CTR by merchant + top clicked products.
 */
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Router, Request, Response, NextFunction } from 'express';
import { db, catalogDb } from '../config';
import { trackAffiliateClick } from '../analytics/posthog';

const router = Router();

// ---------------------------------------------------------------------------
// Allowed-domains whitelist (mirrors redirect.ts)
// ---------------------------------------------------------------------------
const DEFAULT_ALLOWED_DOMAINS = [
  'lazada.sg',
  'shopee.sg',
  'bestdenki.com.sg',
  'amazon.sg',
  'courts.com.sg',
  'harvey-norman.com.sg',
  'challenger.sg',
  'qoo10.sg',
  'coldstorage.com.sg',
  'fairprice.com.sg',
  'guardian.com.sg',
  'watsons.com.sg',
];

const allowedDomains: Set<string> = new Set(
  (process.env.AFFILIATE_ALLOWED_DOMAINS
    ? process.env.AFFILIATE_ALLOWED_DOMAINS.split(',').map((d) => d.trim())
    : DEFAULT_ALLOWED_DOMAINS
  ).filter(Boolean)
);

function isAllowedDestination(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    const bare = hostname.replace(/^www\./, '');
    return allowedDomains.has(bare);
  } catch {
    return false;
  }
}

// F32 (2026-08-22): the static allowlist froze at 12 SG launch domains while the
// catalog grew to 150K merchants — /api/click 403'd its own generated URLs for
// everything else. Product-anchored validation: the destination is permitted when
// its hostname matches the referenced product's stored URL hostname. Still closed
// to arbitrary redirects (an attacker-supplied url must match the product row).
async function productAnchoredDestination(url: string, productId: string | null): Promise<boolean> {
  if (!productId) return false;
  try {
    const destHost = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const r = await db.query('SELECT url FROM products WHERE id = $1 LIMIT 1', [productId]);
    const stored = r.rows[0]?.url as string | undefined;
    if (!stored) return false;
    const storedHost = new URL(stored).hostname.replace(/^www\./, '').toLowerCase();
    return destHost === storedHost;
  } catch {
    return false;
  }
}

function merchantFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Admin auth (matches adminCompare.ts pattern)
// ---------------------------------------------------------------------------
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_API_KEY) {
    res.status(503).json({ error: 'Admin API not configured' });
    return;
  }
  const auth = req.headers['authorization'] || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!key || key !== ADMIN_API_KEY) {
    res.status(401).json({ error: 'Admin API key required' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// GET /api/click
// ---------------------------------------------------------------------------
router.get('/kpi-history', requireAdminKey, async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));
  try {
    const r = await catalogDb.query(
      `SELECT day, total_calls, calls_external, search_calls, zero_result_calls,
              search_success_pct, p50_ms, p95_ms, products_est, merchants_total,
              merchants_monetizable, clicks_total, active_ext_keys, dev_keys_external
       FROM kpi_daily
       WHERE day > current_date - $1::int
       ORDER BY day`,
      [days]
    );
    res.json({ data: r.rows });
  } catch (err) {
    console.error('[kpi-history] query error:', err);
    res.status(500).json({ error: 'kpi query failed' });
  }
});

router.get('/click', async (req: Request, res: Response) => {
  const url = req.query.url as string | undefined;
  if (!url) {
    res.status(400).json({ error: 'Missing required query param: url' });
    return;
  }

  const productId = (req.query.product_id as string) || null;

  if (!isAllowedDestination(url) && !(await productAnchoredDestination(url, productId))) {
    res.status(403).json({ error: 'Destination not permitted' });
    return;
  }
  const merchantId = (req.query.merchant as string) || merchantFromUrl(url);

  const auth = req.headers['authorization'] || '';
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  // BUY-71129 (re-applied): thread-through attribution. The upstream API call
  // embeds ?k=<keyHash>&aid=<agentId> on /api/click URLs so a browser click
  // (no Bearer header) can still be tied back to an agent.
  const keyHashQuery = (req.query.k as string | undefined) || null;
  const agentIdQuery = (req.query.aid as string | undefined) || null;
  const resolvedAgentId = agentIdQuery;
  const resolvedKeyHash = apiKey
    ? createHash('sha256').update(apiKey).digest('hex')
    : keyHashQuery;

  const referrer = req.headers['referer'] || req.headers['referrer'] || null;

  const clientIp = req.ip || req.socket?.remoteAddress || '';
  const ipHash = clientIp
    ? createHash('sha256').update(clientIp).digest('hex')
    : null;

  // BUY-72774: resolve api_key.id for outbound tracking on pending-verify keys
  let apiKeyId: string | null = null;
  if (apiKey) {
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const keyRow = await db.query<{ id: string }>(
      'SELECT id FROM api_keys WHERE key_hash = $1 AND is_active = true',
      [keyHash]
    );
    apiKeyId = keyRow.rows[0]?.id || null;
  }

  // Align INSERT to actual clicks table schema (verified via
  // information_schema 2026-08-26, BUY-75628): id, tracking_id, product_id,
  // platform, destination_url, api_key_id, clicked_at, user_agent, referrer,
  // … The previous INSERT named columns (api_key, ip_hash, source) that do
  // NOT exist in prod — every insert failed since 2026-08-22. Resolve the
  // api_key_id from ?aid= / ?k= (BUY-71129) or the Bearer lookup (BUY-72774).
  const clicksApiKeyId = resolvedAgentId
    ?? apiKeyId
    ?? (resolvedKeyHash
      ? (await db.query<{ id: string }>(
          'SELECT id FROM api_keys WHERE key_hash = $1 LIMIT 1',
          [resolvedKeyHash]
        ).then(r => r.rows[0]?.id ?? null).catch(() => null))
      : null);
  try {
    await db.query(
      `INSERT INTO clicks (id, product_id, platform, destination_url, api_key_id, user_agent, referrer)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuidv4(), productId, merchantId, url, clicksApiKeyId,
       (req.headers['user-agent'] as string) || null, (referrer as string) || null]
    );
  } catch (err) {
    // Log but don't block the redirect
    console.error('[clicks] insert error:', err);
  }

  // BUY-72774: update pending-verify outbound tracking for auto-promotion
  // Outbound click → update consecutive days counter + check 3-day promotion
  if (apiKeyId) {
    db.query(
      `UPDATE api_keys
         SET last_outbound_date = CURRENT_DATE,
             consecutive_outbound_days =
               CASE
                 WHEN last_outbound_date = CURRENT_DATE - INTERVAL '1 day'
                   THEN consecutive_outbound_days + 1
                 WHEN last_outbound_date IS NULL OR last_outbound_date < CURRENT_DATE - INTERVAL '1 day'
                   THEN 1
                 ELSE consecutive_outbound_days
               END
         WHERE id = $1
           AND tier = 'pending_verify'`,
      [apiKeyId]
    ).catch(() => {});

    // Check auto-promotion: 3+ consecutive days with outbound clicks
    db.query(
      `UPDATE api_keys
         SET tier = 'free'
         WHERE id = $1
           AND tier = 'pending_verify'
           AND consecutive_outbound_days >= 3`,
      [apiKeyId]
    ).catch(() => {});
  }

  // BUY-71129 (re-applied): emit affiliate_click for the /api/click path too.
  // Same distinct_id priority (apiKeyId → apiKey → anonymous) as redirect.ts so
  // the funnel join works for both code paths.
  if (productId) {
    trackAffiliateClick({
      apiKeyId: resolvedAgentId,
      apiKey: resolvedKeyHash,
      productId,
      merchantId: merchantId || 'unknown',
      affiliateLinkId: 'unknown',
      source: 'product_card',
    });
  }

  res.redirect(302, url);
});

// ---------------------------------------------------------------------------
// GET /admin/clicks
// ---------------------------------------------------------------------------
router.get('/clicks', requireAdminKey, async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt((req.query.days as string) || '7'), 1), 90);

  try {
    const [merchantResult, productResult] = await Promise.all([
      db.query<{ merchant_id: string; clicks: string; unique_products: string }>(
        `SELECT merchant_id,
                COUNT(*)::text                   AS clicks,
                COUNT(DISTINCT product_id)::text AS unique_products
         FROM clicks
         WHERE clicked_at >= NOW() - ($1 || ' days')::interval
           AND merchant_id IS NOT NULL
         GROUP BY merchant_id
         ORDER BY COUNT(*) DESC
         LIMIT 50`,
        [days]
      ),
      db.query<{ product_id: string; merchant_id: string; clicks: string }>(
        `SELECT product_id,
                merchant_id,
                COUNT(*)::text AS clicks
         FROM clicks
         WHERE clicked_at >= NOW() - ($1 || ' days')::interval
           AND product_id IS NOT NULL
         GROUP BY product_id, merchant_id
         ORDER BY COUNT(*) DESC
         LIMIT 20`,
        [days]
      ),
    ]);

    res.json({
      period: `last_${days}_days`,
      by_merchant: merchantResult.rows.map((r) => ({
        merchant_id: r.merchant_id,
        clicks: parseInt(r.clicks),
        unique_products: parseInt(r.unique_products),
      })),
      top_products: productResult.rows.map((r) => ({
        product_id: r.product_id,
        merchant_id: r.merchant_id,
        clicks: parseInt(r.clicks),
      })),
    });
  } catch (err) {
    console.error('[clicks] admin query error:', err);
    res.status(500).json({ error: 'Query failed', detail: String(err) });
  }
});

export default router;
