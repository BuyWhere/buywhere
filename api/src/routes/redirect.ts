import { Router, Request, Response } from 'express';
import { classifyUserAgent, hashIp, clientIp } from '../lib/botClass';
import { generateShopeeSgDeeplink, isAffiliateWrapped } from '../lib/involveAsia';
import { createHash } from 'crypto';
import { db } from '../config';
import { trackAffiliateClick } from '../analytics/posthog';
import { fallbackForBrokenDestination } from '../lib/brokenDestinationFallbacks';
import { outboundProbeEnabled } from '../lib/outboundLinkHealth';

// truth layer (2026-08-26): record WHO clicked. Before this, every click row had empty UA/IP/referrer,
// so crawlers following /r links were indistinguishable from shoppers.
async function whoClicked(req: Request, apiKey: string | null) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const cls = classifyUserAgent(ua);
  const ip = clientIp(req as unknown as { headers: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } });
  const ipHash = hashIp(ip);
  const q = req.query as Record<string, unknown>;
  const pick = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : (v == null ? '' : String(v)));
  const referrer = (pick(q.referrer) || pick(q.$referrer) || String(req.headers['referer'] || '')).slice(0, 500) || null;
  const sourcePage = pick(q.pathname).slice(0, 300) || null;
  // BUY-71129 (re-applied, was clobbered by 554950c7): browser clicks carry no
  // Bearer header, so the upstream API call embeds ?k=<keyHash>&aid=<agentId>
  // on /r/ URLs. Bearer auth stays canonical when present; the query params
  // only fill in the identity for browser redirects.
  const keyHash = apiKey
    ? createHash('sha256').update(apiKey).digest('hex')
    : (pick(q.k) || null);
  const aidQuery = pick(q.aid) || null;
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
  const isProbeHeader = String(req.headers['x-buywhere-probe'] || '') === '1';
  const isInternal = isProbeHeader || (ipHash ? internalIpHashes.has(ipHash) : false);
  const family = isInternal ? 'internal' : cls.family;
  return { ua, family, ipHash, referrer, sourcePage, keyHash, keyId, isInternal };
}

async function insertAffiliateClickWithTruth(
  values: unknown[],
  isDeadClick: boolean,
): Promise<void> {
  const deadColumns = isDeadClick ? ', was_dead_at_click' : '';
  const deadValues = isDeadClick ? ', true' : '';
  try {
    await db.query(
      `INSERT INTO affiliate_clicks
         (api_key, affiliate_slug, product_id, merchant_id, affiliate_link_id, source, destination_url${deadColumns},
          user_agent, agent_framework, ip_hash, referrer, source_page, api_key_id, is_internal)
       VALUES ($1,$2,$3,$4,$5,$6,$7${deadValues},$8,$9,$10,$11,$12,$13,$14)`,
      values,
    );
  } catch (err) {
    if ((err as { code?: string }).code !== '42703') throw err;
    await db.query(
      `INSERT INTO affiliate_clicks
         (api_key, affiliate_slug, product_id, merchant_id, affiliate_link_id, source, destination_url${deadColumns},
          user_agent, agent_framework, ip_hash, referrer, source_page, api_key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7${deadValues},$8,$9,$10,$11,$12,$13)`,
      values.slice(0, 13),
    );
  }
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

function firstQueryValue(value: unknown): string | null {
  if (Array.isArray(value)) value = value[0];
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 2048) : null;
}

const DEFAULT_ALLOWED_DOMAINS = [
  // Singapore retailers
  'lazada.sg',
  'shopee.sg',
  'bestdenki.com.sg',
  'amazon.sg',
  'courts.com.sg',
  'harvey-norman.com.sg',
  'harveynorman.com.sg',
  'challenger.sg',
  'qoo10.sg',
  'carousell.sg',
  'popular.com.sg',
  'guardian.com.sg',
  'coldstorage.com.sg',
  'fairprice.com.sg',
  'watsons.com.sg',
  'polypet.com.sg',
  'pupsik.sg',
  'robinsons.com.sg',
  // Global / US retailers (country=us revenue path — BUY-60383/BUY-60606)
  'amazon.com',
  'amazon.co.uk',
  'amazon.com.au',
  'amazon.ca',
  'amazon.de',
  'amazon.fr',
  'amazon.co.jp',
  'bestbuy.com',
  'walmart.com',
  'target.com',
  'ebay.com',
  'ebay.sg',
  'costco.com',
  'bhphotovideo.com',
  'adorama.com',
  'newegg.com',
  'homedepot.com',
  'lowes.com',
  'macys.com',
  'nordstrom.com',
  'apple.com',
  'microsoft.com',
  'dell.com',
  'hp.com',
  'lenovo.com',
  'samsung.com',
  'sony.com',
  'bjs.com',
  'samsclub.com',
  // Affiliate tracking / redirect domains (deeplinks served from affiliate_links)
  'awstrack.me',
  'awin1.com',
  'impact.com',
  'go.skimresources.com',
  'go.redirectingat.com',
];

const allowedDomains: Set<string> = new Set(
  (process.env.AFFILIATE_ALLOWED_DOMAINS
    ? process.env.AFFILIATE_ALLOWED_DOMAINS.split(',').map((d) => d.trim())
    : DEFAULT_ALLOWED_DOMAINS
  ).filter(Boolean)
);

// BUY-60383/BUY-60606: destinationUrl is always resolved from our own DB
// (affiliate_links or products table — admin-curated, not user input), so the
// guard only blocks dangerous schemes (open-redirect / XSS via javascript: /
// data:). Any valid http(s) merchant URL is permitted.
// Set AFFILIATE_STRICT_ALLOWLIST=1 to re-enable exact-domain matching against
// AFFILIATE_ALLOWED_DOMAINS if an operator ever needs to lock down outbound
// redirects to a fixed merchant set.
const strictAllowlist = process.env.AFFILIATE_STRICT_ALLOWLIST === '1';

function isAllowedDestination(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!strictAllowlist) return true;
    const bare = parsed.hostname.replace(/^www\./, '');
    if (allowedDomains.has(bare)) return true;
    for (const root of allowedDomains) {
      if (bare.endsWith('.' + root)) return true;
    }
    return false;
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

// GET /r/:affiliateSlug/:productId and /r/direct/:merchantId/:productId
// Log the affiliate click then redirect to destination
const redirectHandler = async (req: Request, res: Response) => {
  const affiliateSlug = req.params.affiliateSlug || 'direct';
  const productId = req.params.productId;

  const probeEnabled = outboundProbeEnabled();
  let merchantId = req.params.merchantId || 'unknown';
  let affiliateLinkId = '';
  let destinationUrl: string | null = null;
  let urlStatus: string | null = null;

  // BUY-60548: The affiliateSlug (e.g. 'direct') is only a routing hint — the
  // affiliate_links table has no 'platform'/'slug' column, so the previous
  // `WHERE platform = $1` query threw "column does not exist", the catch block
  // skipped the product fallback, and every click 302'd to FALLBACK_URL.
  // Resolve the affiliate link by product_id (the canonical key used by the
  // product search JOINs); if none exists, fall through to the product lookup.
  // BUY-60824: also select affiliate_url and prefer it over destination_url,
  // which is empty for many rows. affiliate_url is the actual affiliate deeplink.
  try {
    const linkResult = await withTimeout(
      db.query(
        probeEnabled
          ? `SELECT al.id, al.merchant_id, al.affiliate_url, al.destination_url, p.url_status
               FROM affiliate_links al
               LEFT JOIN products p ON p.id::text = al.product_id
              WHERE al.product_id = $1
              ORDER BY al.affiliate_url NULLS LAST, al.destination_url LIMIT 1`
          : `SELECT id, merchant_id, affiliate_url, destination_url, NULL::text AS url_status
               FROM affiliate_links WHERE product_id = $1
              ORDER BY affiliate_url NULLS LAST, destination_url LIMIT 1`,
        [productId]
      ),
      REDIRECT_TIMEOUT_MS,
      'affiliate_links lookup'
    );

    if (linkResult.rows.length > 0) {
      const link = linkResult.rows[0];
      merchantId = link.merchant_id || affiliateSlug;
      affiliateLinkId = String(link.id);
      // Prefer explicit affiliate_url over destination_url (which may be empty)
      destinationUrl = link.affiliate_url || link.destination_url;
      urlStatus = link.url_status || null;
    }
  } catch (err) {
    console.warn('[redirect] affiliate_links lookup failed:', (err as Error).message);
  }

  // Product fallback runs in its own try/catch so an affiliate_links failure
  // (or a missing link) still resolves the real merchant URL.
  // BUY-67318: select url_status so we can return 410 on confirmed dead links.
  if (!destinationUrl) {
    try {
      const productResult = await withTimeout(
        db.query(
          probeEnabled
            ? `SELECT url, merchant_id, url_status FROM products WHERE id = $1`
            : `SELECT url, merchant_id, NULL::text AS url_status FROM products WHERE id = $1`,
          [productId]
        ),
        REDIRECT_TIMEOUT_MS,
        'products lookup'
      );
      if (productResult.rows.length > 0) {
        destinationUrl = productResult.rows[0].url;
        merchantId = productResult.rows[0].merchant_id || 'unknown';
        urlStatus = productResult.rows[0].url_status || null;
      }
    } catch (err) {
      console.warn('[redirect] products lookup failed:', (err as Error).message);
    }
  }

  if (!destinationUrl) {
    res.redirect(302, FALLBACK_URL);
    return;
  }

  // BUY-67318: if the probe flag is on and this URL is confirmed dead, return
  // 410 instead of forwarding buyers to a retailer 404/410 page.
  if (probeEnabled && urlStatus === 'dead') {
    const authHeader = req.headers['authorization'] || '';
    let apiKey: string | null = null;
    if (authHeader.startsWith('Bearer ')) apiKey = authHeader.slice(7).trim();
    const source = firstQueryValue(req.query.source) || 'api_response';
    const who = await whoClicked(req, apiKey);
    (async () => {
      try {
        await withTimeout(
          insertAffiliateClickWithTruth(
            [who.keyHash, affiliateSlug, productId, merchantId, affiliateLinkId, source, destinationUrl,
             who.ua, who.family, who.ipHash, who.referrer, who.sourcePage, who.keyId, who.isInternal],
            true,
          ),
          REDIRECT_TIMEOUT_MS,
          'affiliate_clicks insert (dead)'
        );
      } catch (err) {
        console.warn('[redirect] dead-click logging failed:', (err as Error).message);
      }
    })();
    res.status(410).json({
      error: 'gone',
      product_id: productId,
      merchant_id: merchantId,
      message: 'This product link has been verified as no longer available.',
    });
    return;
  }

  const brokenDestinationFallback = fallbackForBrokenDestination(destinationUrl);
  if (brokenDestinationFallback) {
    console.warn(`[redirect] replacing confirmed broken destination for product ${productId}`);
    destinationUrl = brokenDestinationFallback;
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
  const source = firstQueryValue(req.query.source) || 'api_response';
  const pathname = firstQueryValue(req.query.pathname);
  const currentUrl = firstQueryValue(req.query.current_url) || firstQueryValue(req.query.$current_url);
  const referrer = firstQueryValue(req.query.referrer) || firstQueryValue(req.query.$referrer);
  const sessionId = firstQueryValue(req.query.session_id) || firstQueryValue(req.query.$session_id);

  // Log click to DB best-effort (do not block the redirect on a slow write)
  const who = await whoClicked(req, apiKey);
  (async () => {
    try {
      await withTimeout(
        insertAffiliateClickWithTruth(
          [who.keyHash, affiliateSlug, productId, merchantId, affiliateLinkId, source, destinationUrl,
           who.ua, who.family, who.ipHash, who.referrer, who.sourcePage, who.keyId, who.isInternal],
          false,
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
    // BUY-71129: uuid identity first (joins the funnel), hash fallback.
    apiKeyId: who.keyId,
    apiKey: apiKey ? hashKey(apiKey) : null,
    productId,
    merchantId,
    affiliateLinkId,
    source,
    pathname,
    currentUrl,
    referrer,
    sessionId,
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
};

router.get('/direct/:merchantId/:productId', redirectHandler);
router.get('/:affiliateSlug/:productId', redirectHandler);

export default router;
