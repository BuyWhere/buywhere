import { Router, Request, Response } from 'express';
import { db } from '../config';
import { trackAffiliateClick } from '../analytics/posthog';

const router = Router();

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
    `SELECT id, merchant_id, affiliate_link_id, destination_url
     FROM affiliate_links WHERE slug = $1 AND product_id = $2`,
    [affiliateSlug, productId]
  );

  let merchantId = 'unknown';
  let affiliateLinkId = '';
  let destinationUrl: string | null = null;

  if (linkResult.rows.length > 0) {
    const link = linkResult.rows[0];
    merchantId = link.merchant_id;
    affiliateLinkId = link.affiliate_link_id || '';
    destinationUrl = link.destination_url;
  } else {
    // Fallback: try direct product lookup
    const productResult = await db.query(
      `SELECT url, domain FROM products WHERE id = $1`,
      [productId]
    );
    if (productResult.rows.length > 0) {
      destinationUrl = productResult.rows[0].url;
      merchantId = productResult.rows[0].domain || 'unknown';
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
  trackAffiliateClick({
    apiKey,
    productId,
    merchantId,
    affiliateLinkId,
    source,
  });

  if (!isAllowedDestination(destinationUrl)) {
    const { hostname } = (() => { try { return new URL(destinationUrl); } catch { return { hostname: destinationUrl }; } })();
    console.warn(`[redirect] blocked: hostname "${hostname}" not in allowlist`);
    res.status(403).json({ error: 'Destination not permitted' });
    return;
  }

  res.redirect(302, destinationUrl);
});

export default router;
