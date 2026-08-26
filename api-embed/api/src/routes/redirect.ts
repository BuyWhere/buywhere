import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { db } from '../config';
import { trackAffiliateClick } from '../analytics/posthog';

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

const router = Router();

// Awin affiliate programme (BUY-6873)
const awinPublisherId = process.env.AWIN_PUBLISHER_ID || '';
const awinAdvertiserIds: Set<string> = new Set(
  (process.env.AWIN_ADVERTISER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)
);

function buildAwinUrl(advertiserId: string, destination: string, clickRef: string): string {
  const encoded = encodeURIComponent(destination);
  return `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${awinPublisherId}&clickref=${clickRef}&p=${encoded}`;
}

const DEFAULT_ALLOWED_DOMAINS = [
  'lazada.sg',
  'shopee.sg',
  'bestdenki.com.sg',
  'amazon.sg',
  'courts.com.sg',
  'harvey-norman.com.sg',
  'challenger.sg',
  'qoo10.sg',
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

// GET /r/:affiliateSlug/:productId
// Log the affiliate click then redirect to destination
router.get('/:affiliateSlug/:productId', async (req: Request, res: Response) => {
  const { affiliateSlug, productId } = req.params;

  // Look up affiliate link
  const linkResult = await db.query(
    `SELECT id, merchant_id, platform, destination_url
     FROM affiliate_links WHERE platform = $1 AND product_id = $2`,
    [affiliateSlug, productId]
  );

  let merchantId = 'unknown';
  let affiliateLinkId = '';
  let destinationUrl: string | null = null;

  if (linkResult.rows.length > 0) {
    const link = linkResult.rows[0];
    merchantId = link.merchant_id || affiliateSlug;
    affiliateLinkId = String(link.id);
    destinationUrl = link.destination_url;
  } else {
    // Fallback: try direct product lookup
    const productResult = await db.query(
      `SELECT url, merchant_id FROM products WHERE id = $1`,
      [productId]
    );
    if (productResult.rows.length > 0) {
      destinationUrl = productResult.rows[0].url;
      merchantId = productResult.rows[0].merchant_id || 'unknown';
    }
  }

  if (!destinationUrl) {
    res.status(404).json({ error: 'Affiliate link not found' });
    return;
  }

  // Determine API key for attribution
  const authHeader = req.headers['authorization'] || '';
  let apiKey: string | null = null;
  if (authHeader.startsWith('Bearer ')) apiKey = authHeader.slice(7).trim();

  // BUY-71129 (re-applied, was clobbered by 554950c7): thread-through
  // attribution. Browser clicks carry ?k=<keyHash>&aid=<agentId> from the
  // upstream API call; Bearer auth stays canonical when present.
  const keyHashQuery = (req.query.k as string | undefined) || null;
  const agentIdQuery = (req.query.aid as string | undefined) || null;
  let resolvedAgentId: string | null = agentIdQuery;
  let resolvedKeyHash: string | null = apiKey ? hashKey(apiKey) : null;
  if (!resolvedKeyHash && keyHashQuery) resolvedKeyHash = keyHashQuery;

  const source = req.query.source as string || 'api_response';

  // Log click to DB (before redirect)
  await db.query(
    `INSERT INTO affiliate_clicks
       (api_key, affiliate_slug, product_id, merchant_id, affiliate_link_id, source, destination_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [apiKey, affiliateSlug, productId, merchantId, affiliateLinkId, source, destinationUrl]
  );

  // PostHog event (fire-and-forget)
  // Hash API key before sending to third-party analytics
  trackAffiliateClick({
    apiKeyId: resolvedAgentId,
    apiKey: resolvedKeyHash,
    productId,
    merchantId,
    affiliateLinkId,
    source,
  });

  // Rewrite to Awin tracking URL when publisher + advertiser IDs are configured
  let finalUrl = destinationUrl;
  if (awinPublisherId && affiliateLinkId && awinAdvertiserIds.has(affiliateLinkId)) {
    const clickRef = `${productId.slice(0, 12)}-${Date.now().toString(36)}`;
    finalUrl = buildAwinUrl(affiliateLinkId, destinationUrl, clickRef);
  } else {
    if (!isAllowedDestination(destinationUrl)) {
      const { hostname } = (() => { try { return new URL(destinationUrl); } catch { return { hostname: destinationUrl }; } })();
      console.warn(`[redirect] blocked: hostname "${hostname}" not in allowlist`);
      res.status(403).json({ error: 'Destination not permitted' });
      return;
    }
  }

  // BUY-63045: check link_health table before redirecting.
  // If the destination is known-dead (checked within 24h), serve a friendly
  // error page instead of sending the user to a broken merchant site.
  if (finalUrl !== destinationUrl) {
    // Awin-wrapped URLs skip the health check (the tracking URL is different from the destination)
    res.redirect(302, finalUrl);
    return;
  }

  try {
    const healthResult = await db.query(
      `SELECT http_status, is_alive, error_message, checked_at
         FROM link_health
        WHERE destination_url = $1
          AND checked_at > NOW() - INTERVAL '24 hours'
        LIMIT 1`,
      [destinationUrl]
    );

    if (healthResult.rows.length > 0) {
      const health = healthResult.rows[0];
      if (!health.is_alive) {
        const hostname = (() => { try { return new URL(destinationUrl).hostname; } catch { return 'the merchant site'; } })();
        console.warn(`[redirect] suppressing dead link: ${hostname} (status=${health.http_status}, checked=${health.checked_at})`);
        res.status(503).send(`<!DOCTYPE html>
<html><head><title>Merchant temporarily unavailable</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:80px auto;padding:20px;text-align:center;color:#334155}
h1{font-size:1.5rem;margin-bottom:1rem}p{line-height:1.6}a{color:#d97706;font-weight:600}</style>
</head><body>
<h1>Merchant temporarily unavailable</h1>
<p>${hostname} is currently experiencing issues and may not load correctly.</p>
<p>Try again later or check other deals for this product.</p>
<a href="javascript:history.back()">← Back to results</a>
</body></html>`);
        return;
      }
    }
  } catch (healthErr) {
    // Health lookup failed — fall through to the redirect (best-effort)
    console.warn(`[redirect] link_health lookup failed: ${(healthErr as Error)?.message}`);
  }

  res.redirect(302, finalUrl);
});

export default router;
