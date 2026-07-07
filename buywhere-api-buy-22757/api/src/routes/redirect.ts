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

// GET /r/direct/:merchantId/:productId
// Direct merchant redirect without allowlist restriction (for all merchants)
router.get('/direct/:merchantId/:productId', async (req: Request, res: Response) => {
  const { merchantId, productId } = req.params;

  // Look up product directly by merchant_id and product_id
  const productResult = await db.query(
    `SELECT url, merchant_id FROM products WHERE id = $1 AND merchant_id = $2`,
    [productId, merchantId]
  );

  if (productResult.rows.length === 0) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  const destinationUrl = productResult.rows[0].url;
  const actualMerchantId = productResult.rows[0].merchant_id || 'unknown';

  if (!destinationUrl) {
    res.status(404).json({ error: 'Product URL not found' });
    return;
  }

  // Determine API key for attribution
  const authHeader = req.headers['authorization'] || '';
  let apiKey: string | null = null;
  if (authHeader.startsWith('Bearer ')) apiKey = authHeader.slice(7).trim();
  const source = req.query.source as string || 'direct_redirect';

  // Log click to DB (before redirect)
  await db.query(
    `INSERT INTO affiliate_clicks
       (api_key, affiliate_slug, product_id, merchant_id, affiliate_link_id, source, destination_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [apiKey, 'direct', productId, actualMerchantId, '', source, destinationUrl]
  );

  // PostHog event (fire-and-forget)
  trackAffiliateClick({
    apiKey: apiKey ? hashKey(apiKey) : null,
    productId,
    merchantId: actualMerchantId,
    affiliateLinkId: '',
    source,
  });

  res.redirect(302, destinationUrl);
});


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
    apiKey: apiKey ? hashKey(apiKey) : null,
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

  res.redirect(302, finalUrl);
});

export default router;
