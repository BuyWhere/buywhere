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

const REDIRECT_TIMEOUT_MS = 4000;
const FALLBACK_URL = 'https://buywhere.ai';

function withTimeout<T>(promise: Promise<T>, ms: number, context: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms (${context})`)), ms)
    ),
  ]);
}

// GET /r/:affiliateSlug/:productId
// Log the affiliate click then redirect to destination
router.get('/:affiliateSlug/:productId', async (req: Request, res: Response) => {
  const { affiliateSlug, productId } = req.params;

  let merchantId = 'unknown';
  let affiliateLinkId = '';
  let destinationUrl: string | null = null;

  try {
    // Look up affiliate link (bounded so a DB outage never stalls the revenue path)
    const linkResult = await withTimeout(
      db.query(
        `SELECT id, merchant_id, platform, destination_url
         FROM affiliate_links WHERE platform = $1 AND product_id = $2`,
        [affiliateSlug, productId]
      ),
      REDIRECT_TIMEOUT_MS,
      'affiliate_links lookup'
    );

    if (linkResult.rows.length > 0) {
      const link = linkResult.rows[0];
      merchantId = link.merchant_id || affiliateSlug;
      affiliateLinkId = String(link.id);
      destinationUrl = link.destination_url;
    } else {
      // Fallback: try direct product lookup
      const productResult = await withTimeout(
        db.query(
          `SELECT url, merchant_id FROM products WHERE id = $1`,
          [productId]
        ),
        REDIRECT_TIMEOUT_MS,
        'products lookup'
      );
      if (productResult.rows.length > 0) {
        destinationUrl = productResult.rows[0].url;
        merchantId = productResult.rows[0].merchant_id || 'unknown';
      }
    }
  } catch (err) {
    console.warn('[redirect] lookup failed/timed out, falling back:', (err as Error).message);
  }

  if (!destinationUrl) {
    res.redirect(302, FALLBACK_URL);
    return;
  }

  // Determine API key for attribution
  const authHeader = req.headers['authorization'] || '';
  let apiKey: string | null = null;
  if (authHeader.startsWith('Bearer ')) apiKey = authHeader.slice(7).trim();
  const source = req.query.source as string || 'api_response';

  // Log click to DB best-effort (do not block the redirect on a slow write)
  (async () => {
    try {
      await withTimeout(
        db.query(
          `INSERT INTO affiliate_clicks
             (api_key, affiliate_slug, product_id, merchant_id, affiliate_link_id, source, destination_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [apiKey, affiliateSlug, productId, merchantId, affiliateLinkId, source, destinationUrl]
        ),
        REDIRECT_TIMEOUT_MS,
        'affiliate_clicks insert'
      );
    } catch (err) {
      console.warn('[redirect] click logging failed:', (err as Error).message);
    }
  })();

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
