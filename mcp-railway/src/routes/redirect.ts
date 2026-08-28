import { Router, Request, Response } from 'express';
import { classifyUserAgent, hashIp, clientIp } from '../lib/botClass';
import { generateShopeeSgDeeplink, isAffiliateWrapped } from '../lib/involveAsia';
import { createHash } from 'crypto';
import { db } from '../config';
import { trackAffiliateClick } from '../analytics/posthog';

async function whoClicked(req: Request, apiKey: string | null) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const cls = classifyUserAgent(ua);
  const ip = clientIp(req as unknown as { headers: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } });
  const ipHash = hashIp(ip);
  const pick = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : (v == null ? '' : String(v)));
  const referrer = (pick(req.query.referrer) || pick(req.query.$referrer) || String(req.headers['referer'] || '')).slice(0, 500) || null;
  const sourcePage = pick(req.query.pathname).slice(0, 300) || null;
  const keyHash = apiKey
    ? createHash('sha256').update(apiKey).digest('hex')
    : (pick(req.query.k) || null);
  const aidQuery = pick(req.query.aid) || null;
  let keyId: string | null = aidQuery;
  if (keyHash && !keyId) {
    try { const r = await db.query('SELECT id FROM api_keys WHERE key_hash = $1 LIMIT 1', [keyHash]); keyId = r.rows[0]?.id ?? null; } catch { /* best effort */ }
  }
  const internalIpHashes = new Set(
    ['168.144.134.188', ...(process.env.BUYWHERE_INTERNAL_EGRESS_IPS || '').split(',')]
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => hashIp(v))
      .filter((v): v is string => Boolean(v)),
  );
  for (const hash of (process.env.BUYWHERE_INTERNAL_EGRESS_IP_HASHES || '').split(',')) {
    const trimmed = hash.trim();
    if (trimmed) internalIpHashes.add(trimmed);
  }
  const isProbeHeader = String(req.headers['x-buywhere-probe'] || '').trim() === '1';
  const isInternal = isProbeHeader || (ipHash ? internalIpHashes.has(ipHash) : false);
  const family = isInternal ? 'internal' : cls.family;
  return { ua, family, ipHash, referrer, sourcePage, keyHash, keyId, isInternal };
}

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

  // Involve Asia (2026-08-24): shopee.sg destinations get a commission-bearing
  // tracking link at click time (offer 5035, Shopee SG - CPS). Generated links are
  // cached into affiliate_links so subsequent clicks skip the API call. Fails soft.
  try {
    const destHost = new URL(destinationUrl).hostname.replace(/^www\./, '');
    if (destHost === 'shopee.sg' && !isAffiliateWrapped(destinationUrl)) {
      const dl = await generateShopeeSgDeeplink(destinationUrl, productId);
      if (dl) {
        const rawUrl = destinationUrl;
        destinationUrl = dl;
        (async () => {
          try {
            if (affiliateLinkId) {
              await db.query(`UPDATE affiliate_links SET affiliate_url = $1 WHERE id = $2`, [dl, affiliateLinkId]);
            } else {
              await db.query(
                `INSERT INTO affiliate_links (id, slug, product_id, merchant_id, destination_url, affiliate_url)
                 VALUES (gen_random_uuid(), 'involve_asia', $1, $2, $3, $4)`,
                [productId, merchantId, rawUrl, dl]
              );
            }
          } catch (err) {
            console.warn('[redirect] IA link cache write failed:', (err as Error).message);
          }
        })();
      }
    }
  } catch { /* bad URL — proceed unwrapped */ }

  // Determine API key for attribution
  const authHeader = req.headers['authorization'] || '';
  let apiKey: string | null = null;
  if (authHeader.startsWith('Bearer ')) apiKey = authHeader.slice(7).trim();
  const source = req.query.source as string || 'api_response';
  const who = await whoClicked(req, apiKey);

  // Log click to DB (before redirect)
  await db.query(
    `INSERT INTO affiliate_clicks
       (api_key, affiliate_slug, product_id, merchant_id, affiliate_link_id, source, destination_url,
        user_agent, agent_framework, ip_hash, referrer, source_page, api_key_id, is_internal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [who.keyHash, affiliateSlug, productId, merchantId, affiliateLinkId, source, destinationUrl,
     who.ua, who.family, who.ipHash, who.referrer, who.sourcePage, who.keyId, who.isInternal]
  );

  // PostHog event (fire-and-forget)
  // Hash API key before sending to third-party analytics
  trackAffiliateClick({
    apiKeyId: who.keyId,
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
