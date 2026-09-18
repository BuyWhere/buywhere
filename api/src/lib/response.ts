import { CanonicalProduct, ComparisonAttribute, EmptinessReason, SearchConfidence, SearchResponse, EmptinessDiagnostic } from '../types/product';
import { resolvePrecomputedAffiliateUrl } from './affiliateWrapper';
import { buildAffiliateRedirectUrl, buildClickUrl } from './instrumentation';

import { getCachedFxRates } from './fxRatesLoader';
import type { MerchantMapEntry } from './merchantLookup';
export const CURRENCY_RATES: Record<string, number> = {
  USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79,
};

// BUY-73753: include every active market code so the LIST/SIMILAR/DEALS
// paths can build a `WHERE currency = $1 AND country_code = $2` predicate
// that matches the rows actually stored under that country. Without a
// mapping, the fallback ('SGD') used to mismatch on PH/ID/JP/DE/AU and
// the planner was full-scanning for non-SG/US cohorts. Active set is
// the union of the openapi /mcp enum, the fleet onboarding targets, and
// the BUY-73330 gate probe; expand deliberately (any value absent here
// silently returns zero rows + a 30s seq-scan timeout).
/** BUY-79642: flatten nested REST `{amount,currency}` or numeric/string prices. */
export function extractNumericPrice(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as { amount?: unknown; lowPrice?: unknown; price?: unknown };
    return extractNumericPrice(o.amount ?? o.lowPrice ?? o.price);
  }
  return null;
}

export const COUNTRY_CURRENCY: Record<string, string> = {
  SG: 'SGD', US: 'USD', GB: 'GBP', UK: 'GBP', VN: 'VND', TH: 'THB', MY: 'MYR',
  PH: 'PHP', ID: 'IDR', JP: 'JPY', DE: 'EUR', AU: 'AUD',
  // Single-currency regions stored under EUR/USD on the catalog:
  FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', IE: 'EUR', CA: 'CAD', MX: 'MXN', BR: 'BRL',
};

// BUY-72693: reject ASIN-derived image URLs from Amazon CDN.
// Synthetic rows carry image URLs like:
//   https://m.media-amazon.com/images/I/B10162255701._AC_SY360_.jpg
// where "B10162255701" is a fabricated 12-char key (ASIN + "01" suffix).
// Real Amazon media keys are base64-encoded (e.g. "71jG+e7roXL"), not
// "B" + digit sequences. Nulling the image_url here blocks 400s at the API
// level for ANY consumer of /v1/products/search (including MCP tools and
// third-party callers), not just the Next.js search UI.
function normalizeImageUrl(imageUrl: unknown): string | null {
  if (typeof imageUrl !== 'string' || imageUrl.trim() === '') return null;

  try {
    const parsed = new URL(imageUrl);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (hostname === 'source.unsplash.com') return null;

    // BUY-79816: Magento catalog placeholders (Best Denki 2918xxx-1.jpg) and
    // explicit placeholder path tokens. Gate at API projection so REST/MCP/SSR
    // share the same image_url (never a retailer watermark).
    if (
      pathname.includes('placeholder') ||
      pathname.includes('/no_selection') ||
      pathname.includes('noimage') ||
      pathname.includes('image_coming_soon') ||
      pathname.includes('/nophoto') ||
      pathname.includes('/watermark')
    ) {
      return null;
    }
    if (/\/media\/catalog\/product\/cache\/[0-9a-f]+\/\d\/\d\/2918\d{3}-1(?:_\d+)?\.jpe?g/.test(pathname)) {
      return null;
    }

    // BUY-72693: fail-closed on Amazon ASIN-derived media keys.
    if (hostname === 'm.media-amazon.com' || hostname.endsWith('.media-amazon.com')) {
      const imgMatch = pathname.match(/^\/images\/i\/([^/.]+)\./);
      if (imgMatch) {
        const mediaKey = imgMatch[1];
        // Reject "B" + ≥10 digits (with optional _XX suffix) — synthetic ASIN shape.
        if (/^b\d{10,}(?:_\d+)?$/.test(mediaKey)) return null;
      }
    }
  } catch {
    return imageUrl;
  }

  return imageUrl;
}


// BUY-69998: derive coarse region labels from ISO country codes so API +
// mcp-railway responses agree. The DB column `region` is unreliable: rows
// occasionally land with `region=sg` and `country_code=US` (or vice versa)
// when ingest runs across markets, contradicting FE fulfilment logic. Use
// the country_code as the source of truth and only fall back to the stored
// region when the country is unknown.
export function regionForCountry(countryCode: string | null | undefined): string | null {
  const cc = (countryCode || '').toUpperCase();
  if (!cc) return null;
  // BUY-79642: emit ISO country as region (sg/us/th/…), not the catalog shard
  // label 'sea'. Cart + agents treat product.region as the market; currency
  // isolation already happens separately.
  if (cc.length === 2) return cc.toLowerCase();
  return null;
}

export function normalizeCategoryPath(row: Record<string, unknown>): string[] | null {
  const rawCategoryPath = row.category_path ?? (row.metadata as Record<string, unknown> | null | undefined)?.category_path;
  const rawCategory = row.category ?? (row.metadata as Record<string, unknown> | null | undefined)?.category;

  const normalizeSegment = (segment: unknown): string | null => {
    const value = String(segment ?? '').trim();
    return value ? value : null;
  };

  if (Array.isArray(rawCategoryPath)) {
    const parts = rawCategoryPath.map(normalizeSegment).filter((segment): segment is string => Boolean(segment));
    if (parts.length > 0) return parts;
  }

  if (typeof rawCategoryPath === 'string') {
    const parts = rawCategoryPath
      .split(/\s*(?:>|\/|\\|,|\|)\s*/)
      .map(normalizeSegment)
      .filter((segment): segment is string => Boolean(segment));
    if (parts.length > 0) return parts;
  }

  if (typeof rawCategory === 'string') {
    const category = normalizeSegment(rawCategory);
    if (category) return [category];
  }

  return null;
}

// BUY-75921 v5: normalize product titles to remove keyword-stuffed strings.
// v4 (fc4116ccc): comma/pipe-segment filtering only. Failed because live catalog
// titles have NO commas — single continuous strings like
// "E6S Wireless Bluetooth Earphones TWS Bluetooth Headset Wireless Earbuds
// Noise Cancelling Earphones with Microphone Headphones" pass through unchanged.
// V5 adds single-segment trimming:
//   - For single-segment titles: trim trailing generic appendages by accumulating
//     words from the first meaningful/brandish anchor until a generic filler stops.
//   - For multi-segment titles: also trim the head segment's trailing generic tail.
//   - Brandish = capitalized word ≥2 chars not in the generic lexicon.
//   - Stops trimming at the first generic filler after the brand cluster.
//   - Prepositional tails ("for X, with Y") trigger a mid-segment cut.
//   - Falls back to the original whenever the result would be degenerate.
export function normalizeProductTitle(row: Record<string, unknown>): string {
  const rawTitle = ((row.title as string) || '').replace(/\s+/g, ' ').trim();
  if (rawTitle.length <= 40) return rawTitle;

  const GENERIC_WORDS = new Set([
    // earbud/headphone category
    'earbuds', 'earphones', 'headphones', 'headset', 'buds', 'ear',
    'wireless', 'bluetooth', 'tw', 'tws', 'true', 'in-ear', 'inear', 'in', 'on-ear', 'over-ear',
    'anc', 'noise', 'cancelling', 'canceling', 'cancellation', 'active', 'enc',
    'hi-fi', 'hifi', 'stereo', 'bass', 'deep', 'clear', 'calls', 'call', 'mic', 'mics',
    'microphone', 'hd', 'sound', 'audio', 'sport', 'sports', 'running', 'workout', 'gym',
    'waterproof', 'water', 'resistant', 'sweatproof', 'ipx7', 'ipx5', 'ipx6', 'ip68',
    'playtime', 'battery', 'charging', 'case', 'led', 'display', 'digital',
    // connectors/compat
    '3.5mm', 'usb', 'usb-c', 'type-c', 'jack', 'aux', 'mp3', 'player', 'players',
    'compatible', 'for', 'with', 'and', '&', 'the', 'of', 'pack',
    // watch/laptop/speaker/phone generic
    'smart', 'watch', 'fitness', 'tracker', 'laptop', 'notebook', 'computer', 'pc',
    'speaker', 'speakers', 'portable', 'subwoofer', 'soundbar', 'phone', 'phones',
    'charger', 'adapter', 'cable', 'cables', 'power', 'bank', 'fast',
    // marketing fluff
    'new', 'hot', 'sale', 'best', 'free', 'shipping', 'delivery', 'gift', 'original',
    'genuine', 'quality', 'premium', 'high', 'pro', 'max', 'mini', 'plus', 'ultra',
    // sizes/specs
    'inch', 'mm', 'mah', 'hours', 'hrs', 'gb', 'tb', 'rgb',
  ]);

  const isGenericToken = (w: string): boolean => {
    const lo = w.toLowerCase();
    return GENERIC_WORDS.has(lo) ||
      /^[\d.,:x\xd7*\-]+$/.test(w) ||
      /^ipx?\d/i.test(w) ||
      /^\d+(\.\d+)?(mm|cm|inch|in|gb|tb|mah|w|v|hz)$/i.test(w);
  };

  // Capitalized word, >= 2 chars, not in generic list — carries product identity.
  // The 2-char minimum (not 3) allows "HP" and "LG" as valid brand tokens.
  const isBrandish = (w: string): boolean => {
    const lo = w.toLowerCase();
    return w.length >= 2 && /^[A-Z]/.test(w) && /^[a-z]/i.test(w) && !GENERIC_WORDS.has(lo);
  };

  // Alphanumeric model number: e.g. E6S, TOZO-T10, M110, QCY-HT05.
  const isModelToken = (w: string): boolean =>
    /^[A-Z][A-Z0-9]{1,}[0-9][A-Za-z0-9]*$/.test(w) || /^[A-Z]{2,}[0-9]/.test(w);

  // Non-generic, non-numeric word with real content.
  const isMeaningful = (w: string): boolean => {
    if (isModelToken(w)) return true;
    const lo = w.toLowerCase();
    if (GENERIC_WORDS.has(lo)) return false;
    if (/^[\d.,:x\xd7*\-]+$/.test(w)) return false;
    return /^[a-z]/i.test(w) && w.length >= 3;
  };

  // Trims trailing generic-word appendages from a single-segment title string.
  // Finds the first meaningful/brandish/model anchor, then accumulates words
  // forward (including adjacent brandish words and connectors) until the first
  // generic filler word stops the accumulation. This keeps brand clusters like
  // "BOWERS & WILKINS" and "WH-1000XM5" intact.
  const trimTrailingGeneric = (segment: string): string => {
    const words = segment.split(/\s+/);
    if (words.length <= 2) return segment;

    // Find the first anchor: model token > meaningful word.
    let anchorIdx = -1;
    for (let i = 0; i < words.length; i++) {
      if (isModelToken(words[i])) { anchorIdx = i; break; }
    }
    if (anchorIdx < 0) {
      for (let i = 0; i < words.length; i++) {
        if (isMeaningful(words[i])) { anchorIdx = i; break; }
      }
    }
    if (anchorIdx < 0) return segment;

    // Accumulate from anchor forward: keep all brandish words and connectors,
    // stop ONLY at the first generic filler. This keeps "BOWERS & WILKINS Pi8"
    // together and "Sony WH-1000XM5" together.
    const kept: string[] = [];
    for (let i = anchorIdx; i < words.length; i++) {
      const w = words[i];
      if (isGenericToken(w)) break; // first generic filler stops accumulation
      kept.push(w);
    }
    if (kept.length === 0) return segment;
    const result = kept.join(' ');
    return result.length < 12 ? segment : result;
  };

  // Truncate at the first " for " or " with " (mid-segment prepositional tail).
  const cutPrepTail = (text: string): string => {
    const m = text.match(/\s+(?:for|with)\s+/i);
    if (m && m.index && m.index > 0) return text.slice(0, m.index).trim();
    return text;
  };

  const segments = rawTitle.split(/\s*[,|]\s*/).filter(Boolean);

  if (segments.length < 2) {
    // BUY-75921 v7: hard 50-char cap for single-segment titles.
    // Even after forward + backward trim, spec-dump titles like
    // "HP Omnibook 5 AI Laptop 16 inch 2K WUXGA 16GB RAM 512GB SSD Win 11 Home"
    // (71 chars, no comma to split) return unchanged because trimTrailingGeneric
    // walks forward from the first anchor and stops at "Laptop" (generic), keeping
    // only ~21 chars — and backward trim finds no trailing generics either.
    // Both trims return the same ~21-char result; the function picks it and returns
    // it unchanged.
    // Fix: when single-segment title > 50 chars, force a backward scan that drops
    // words from the END until the prefix is ≤50 chars. Catches laptop spec-dumps
    // AND any earbud strings that slip through forward+backward trim.
    if (rawTitle.length > 50) {
      const words = rawTitle.split(/\s+/);
      let endIdx = words.length;
      let dropped = 0;
      while (endIdx > 0 && dropped < 20 && words.slice(0, endIdx).join(' ').length > 50) {
        endIdx--;
        dropped++;
      }
      if (dropped > 0) {
        const capped = words.slice(0, endIdx).join(' ');
        if (capped.length >= 12) return capped;
      }
    }
    // Single segment: try forward trim first (anchor + accumulate forward).
    const trimmed = trimTrailingGeneric(rawTitle);
    // BUY-75921 v6: also try backward trim if forward trim didn't reduce the
    // title. Walks backward dropping generic-only words until a non-generic
    // word stops it. Catches "BUSFUIVA Beats Studio ... PA-BT05 Wireless
    // Headset" → drop "Wireless Headset" from the end. Capped at 8 drops.
    // First strips trailing parenthetical (color/condition) like "(Red)".
    const backTrim = (() => {
      let base = rawTitle.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (base.length < 12) base = rawTitle;
      const words = base.split(/\s+/);
      if (words.length <= 4) return base;
      let endIdx = words.length;
      let dropped = 0;
      while (endIdx > 0 && dropped < 8) {
        const w = words[endIdx - 1];
        if (!isGenericToken(w)) break;
        endIdx--;
        dropped++;
      }
      if (endIdx === words.length || endIdx === 0) return base;
      const r = words.slice(0, endIdx).join(' ');
      return r.length < 12 ? base : r;
    })();
    // Pick the shortest reasonable result. Guard against degenerate outputs.
    const candidates = [trimmed, backTrim].filter(t => t.length >= 12 && t.length <= rawTitle.length);
    if (candidates.length === 0) return rawTitle;
    return candidates.reduce((a, b) => (a.length <= b.length ? a : b));
  }

  // Multi-segment: trim the head segment, then apply trailing-segment drop logic.
  const rawHead = cutPrepTail(segments[0]);
  const trimmedHead = trimTrailingGeneric(rawHead);

  const kept = [trimmedHead];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const words = seg.toLowerCase().split(/[\s/&+().,'"\xb0]+/).filter(Boolean);
    const dupOfHead = (() => {
      const headWords = new Set(trimmedHead.toLowerCase().split(/\s+/));
      const overl = words.filter(w => headWords.has(w)).length;
      return words.length > 0 && overl / words.length >= 0.6;
    })();
    let segText = cutPrepTail(seg);
    if (!segText) continue;
    const keptWords = segText.toLowerCase().split(/[\s/&+().,'"\xb0]+/).filter(Boolean);
    const keptBrandish = segText.split(/\s+/).some(w => isBrandish(w));
    // BUY-75921 v6: drop segments that are long keyword-stuffing descriptions
    // (>8 words) AND contain ≥2 generic fillers. They read as filler, not as
    // identity. Real product segments are short ("IPX8 Waterproof") or
    // generic-light ("Sony WF-1000XM5"). Short 2-8 word segments unaffected.
    const keptGenerics = keptWords.filter(w => GENERIC_WORDS.has(w)).length;
    const isLongStuffing = keptWords.length > 8 && keptGenerics >= 2;
    if (dupOfHead || (!keptBrandish && keptWords.length <= 4) || isLongStuffing) continue;
    kept.push(segText);
  }

  const cleaned = kept.join(', ');
  if (cleaned.length < 12) return rawTitle;
  return cleaned;
}

// BUY-80652: filter REST fallback rows to native currency for the requested market.
export function filterNativeCurrencyRows(rows: Record<string, unknown>[], country: string): Record<string, unknown>[] {
  const expectedCurrency = COUNTRY_CURRENCY[country] || 'SGD';
  return rows.filter((row) => {
    const price = row.price;
    let rowCurrency = '';
    if (price && typeof price === 'object' && !Array.isArray(price)) {
      const p = price as { currency?: string };
      rowCurrency = (p.currency || '').toUpperCase();
    }
    // Drop mismatches AND missing currency (NULL was leaking USD Shopify).
    if (rowCurrency && rowCurrency !== expectedCurrency) return false;
    return true;
  });
}

export function extractRowCurrency(row: Record<string, unknown>): string {
  const price = row.price;
  if (price && typeof price === 'object' && !Array.isArray(price)) {
    const p = price as { currency?: string };
    return (p.currency || '').toUpperCase();
  }
  return '';
}

export function buildProduct(
  row: Record<string, unknown>,
  defaultCurrency: string,
  compact: boolean,
  // BUY-74689: optional batched lookup from `merchants.id` → {name, slug}. Callers that
  // resolve the map (every product-emitting handler) pass it in; legacy call sites
  // pass nothing and get `merchantName: null` (same as an orphaned merchant_id). The
  // platform slug (`merchant` / `source`) is preserved unchanged.
  merchantMap?: Record<string, MerchantMapEntry>,
  // BUY-71129 (re-applied, was clobbered by 554950c7): caller context for
  // thread-through attribution. api_key_id + key_hash travel on /r/ and
  // /api/click URLs as ?k= + ?aid= so the redirect handler can attribute the
  // conversion back to the originating agent even though the browser click
  // carries no Bearer header. Null/omitted = anonymous click, as before.
  caller?: {
    apiKeyId?: string | null;
    keyHash?: string | null;
  } | null,
): CanonicalProduct {
  // BUY-80679: use the market's canonical currency as the authoritative value.
  // The DB `currency` column is unreliable (partitions carry SGD contamination from
  // the SG/US ingest era). `row.currency` must NOT override the market-default
  // — otherwise MY serves SGD, TH serves SGD, GB serves USD, etc.
  const currency = defaultCurrency;
  const amount = extractNumericPrice(row.price);

  // BUY-60385: Sanitize anomalous prices from upstream affiliate/feed partners.
  // Validation catches two categories of data-quality failures observed in production:
  //   1. $0.00 prices — out-of-stock marker, missing price field, or parsing error
  //   2. Prices over $10,000 — feed corruption, currency conversion unit errors
  //   3. BUY-63738: Prices under $5 — observed $1.00 laptop prices are clearly
  //      invalid feed errors; real laptops start at ~$400. A $5 floor catches the
  //      obvious errors while still allowing cheap accessories ($2-3 cables, etc.).
  // Legitimate high-end products (luxury watches, high-end appliances, jewelry)
  // stay under $10k. When a price fails validation the amount is nullified so
  // the FE displays nothing instead of a deceptive value.
  const PRICE_MIN = 0.01;
  const PRICE_MAX = 10_000_000;
  const sanitizedAmount = (amount != null && Number.isFinite(amount) && amount >= PRICE_MIN && amount <= PRICE_MAX)
    ? amount
    : null;

  const affiliateUrl = resolvePrecomputedAffiliateUrl(row.affiliate_url);
  const productId = String(row.id);
  const merchant = (row.domain as string) || '';
  const isAmazonMerchant = merchant.toLowerCase().includes('amazon');

  // BUY-67318: hide all buy-side fields when the probe worker has confirmed
  // the listing is dead (HTTP 404/410 or other 4xx). The redirect handler
  // (/r/direct/{id}) already returns 410 in this case; this serializer step
  // prevents surfacing a buy button to that dead page from search/listings.
  // We still emit `url_status: 'dead'` so consumers can distinguish "no link"
  // (genuinely missing) from "link removed because dead" and surface a
  // tombstone / "no longer available" UI.
  const isUrlDead = (row.url_status as string | null | undefined) === 'dead';
  const destinationUrl = isUrlDead ? null : (affiliateUrl ?? (row.url as string));

  // BUY-52474: every /v1 product response now carries tracking URLs so the FE
  // naturally routes user clicks through /r/ (logs affiliate_clicks) and /api/click
  // (logs clicks). The raw merchant URL is still in `url` for agents/SEO use;
  // `affiliate_url` keeps its precomputed wrapper when present.
  const clickUrl = destinationUrl
    ? buildClickUrl({
        productId,
        destinationUrl,
        merchantId: merchant || null,
        keyHash: caller?.keyHash ?? null,
        agentId: caller?.apiKeyId ?? null,
      })
    : null;
  const affiliateRedirectUrl = destinationUrl
    ? buildAffiliateRedirectUrl({
        productId,
        source: 'product_card',
        keyHash: caller?.keyHash ?? null,
        agentId: caller?.apiKeyId ?? null,
      })
    : null;
  const hasAffiliateTracking = Boolean(affiliateUrl || affiliateRedirectUrl);

  // BUY-75921: apply title normalization to strip keyword-stuffing
  const title = normalizeProductTitle(row);
  const base: CanonicalProduct = {
    id: productId,
    title,
    name: title,
    price: { amount: sanitizedAmount, currency },
    merchant,
    url: destinationUrl as string | null,
    image_url: normalizeImageUrl(row.image_url),
    // BUY-69998: replace stored region when it disagrees with country_code.
    region: (() => {
      const rawRegion = (row.region as string) || null;
      const cc = ((row.country_code as string) || '').toUpperCase();
      const expected = regionForCountry(cc);
      if (!rawRegion || (expected && rawRegion.toLowerCase() !== expected)) {
        return expected ?? rawRegion;
      }
      return rawRegion;
    })(),
    country_code: (row.country_code as string) || null,
    category_path: normalizeCategoryPath(row),
    updated_at: (row.updated_at as string) || null,
    // BUY-74689: merchant_id from the row, real storefront name from the batched
    // merchants lookup. `merchant` / `merchant_id` (platform slug) preserved for
    // filtering and analytics — emit the resolved name only when the row exists.
    merchant_id: (row.merchant_id as string) || null,
    merchant_name: (() => {
      const mid = (row.merchant_id as string) || '';
      const entry = mid && merchantMap ? merchantMap[mid] : undefined;
      return entry?.name ?? null;
    })(),
    merchant_slug: (() => {
      const mid = (row.merchant_id as string) || '';
      const entry = mid && merchantMap ? merchantMap[mid] : undefined;
      return entry?.slug || null;
    })(),
    // BUY-74732: resolve scraped_via with explicit precedence — the row's own
    // column (catalog may stamp per-product), then the merchant's row
    // (legacy where only the merchant-level flag is set), then null. The FE
    // `<MerchantBadge>` renders ✓ only when the value is `'first_party'`.
    scraped_via: (() => {
      const rowSv = (row.scraped_via as string | null | undefined);
      if (typeof rowSv === 'string' && rowSv.trim()) return rowSv.trim();
      const mid = (row.merchant_id as string) || '';
      const entry = mid && merchantMap ? merchantMap[mid] : undefined;
      return entry?.scraped_via ?? null;
    })(),
    // CAT-08: expose stock status as a top-level boolean when known.
    ...(row.in_stock != null && { in_stock: row.in_stock as boolean }),
    ...(isAmazonMerchant && row.updated_at != null && { price_as_of: row.updated_at as string }),
    // BUY-75368: A2 weekly-report metric (% search responses carrying a
    // url_last_checked_at within 24h). Always emit the field (null when
    // never checked) so consumers can rely on its presence.
    ...(row.url_last_checked_at !== undefined && {
      url_last_checked_at: (row.url_last_checked_at as string | null) ?? null,
    }),
    ...(row.url_status !== undefined && {
      url_status: (row.url_status as string | null) ?? null,
    }),
    ...(affiliateUrl != null && { affiliate_url: affiliateUrl }),
    ...(clickUrl != null && { click_url: clickUrl }),
    ...(affiliateRedirectUrl != null && { affiliate_redirect_url: affiliateRedirectUrl }),
    has_affiliate_tracking: hasAffiliateTracking,
    is_affiliate: hasAffiliateTracking,
    ...(hasAffiliateTracking && {
      affiliate_disclosure: 'BuyWhere may earn a commission from purchases made through tracked product links.',
    }),
    // BUY-74262: expose the raw `source` column alongside the `merchant` alias.
    // The `source` column holds the retailer/feed origin (e.g. "amazon_us",
    // "shopify"). `merchant` is the same value but mapped from the `domain` alias
    // for backward compatibility. Agents filtering by `?source=...` need the
    // explicit `source` key in the response to verify the filter took effect.
    source: (row.source as string) || null,
  };

  if (compact) {
    const meta = row.metadata as Record<string, unknown> | null;
    const structured_specs: Record<string, unknown> = {};
    for (const k of ['brand', 'category', 'model', 'size', 'color', 'material', 'weight'] as const) {
      const v = meta?.[k];
      if (v != null) structured_specs[k] = v;
    }

    const comparison_attributes: ComparisonAttribute[] = [];
    if (structured_specs.brand != null)
      comparison_attributes.push({ key: 'brand', label: 'Brand', value: structured_specs.brand });
    if (structured_specs.category != null)
      comparison_attributes.push({ key: 'category', label: 'Category', value: structured_specs.category });
    if (amount != null)
      comparison_attributes.push({ key: 'price', label: `Price (${currency})`, value: amount });
    if (structured_specs.model != null)
      comparison_attributes.push({ key: 'model', label: 'Model', value: structured_specs.model });
    if (structured_specs.color != null)
      comparison_attributes.push({ key: 'color', label: 'Color', value: structured_specs.color });

    const rates = getCachedFxRates();
    const rate = rates[currency] ?? CURRENCY_RATES[currency] ?? null;
    const normalized_price_usd = amount != null && rate != null ? +(amount * rate).toFixed(4) : null;

    base.canonical_id = row.id as string;
    base.normalized_price_usd = normalized_price_usd;
    base.structured_specs = structured_specs;
    base.comparison_attributes = comparison_attributes;
  } else {
    // BUY-78233: restore product-level meta alias — both meta and metadata
    // must be exposed on non-compact products for API contract compatibility
    base.metadata = row.metadata as Record<string, unknown> | null;
    base.meta = row.metadata as Record<string, unknown> | null;
  }

  if (row.original_price != null) {
    base.original_price = parseFloat(row.original_price as string);
  }
  if (row.discount_pct != null) {
    base.discount_pct = parseFloat(row.discount_pct as string);
  }

  return base;
}

// BUY-71542 / P2.6 + BUY-72044 / P2.6A: optional P2.6 envelope. When the response is empty AND the caller derived an emptiness reason, attach the emptiness_reason/confidence/diagnostic triplet to meta. Non-empty responses ignore this (reasons are only meaningful for empty results).
export function buildSearchResponse(
  products: CanonicalProduct[],
  total: number,
  limit: number,
  offset: number,
  responseTimeMs: number,
  cached: boolean,
  degraded?: boolean,
  hasMore?: boolean,
  expectedCountryCode?: string | null,
  emptiness?: {
    emptiness_reason: EmptinessReason;
    confidence: SearchConfidence;
    diagnostic: EmptinessDiagnostic;
    degraded_kind?: import('../types/product').DegradedKind;
  } | null,
  mode?: 'keyword' | 'semantic' | 'hybrid',
): SearchResponse {
  const isEmpty = products.length === 0;
  const status: SearchResponse['meta']['status'] | undefined = degraded ? 'degraded' : undefined;
  // BUY-76440: mode-identity. When the search handler passes the mode it actually
  // ran, surface it so integrators can verify semantic/hybrid really executed the
  // embedding-ranked path. mapModeEngine pairs each mode with its engine name.
  const mode_used_engine = mode
    ? (mode === 'semantic' ? 'semantic (pgvector hnsw)'
       : mode === 'hybrid' ? 'hybrid (rrf + pgvector hnsw)'
       : 'keyword (fts)')
    : undefined;
  return {
    data: products,
    // F33 (2026-08-22): products/results/items are CONTRACT aliases of data — clients
    // integrated against response.products broke when the envelope went data-only.
    // By-reference aliases; keep all four until a versioned deprecation.
    products,
    results: products,
    items: products,
    meta: {
      total,
      limit,
      offset,
      response_time_ms: responseTimeMs,
      cached,
      ...(mode != null && { mode_used: mode, mode_used_engine }),
      ...(degraded != null && { degraded }),
      ...(status && { status }),
      ...(hasMore != null && { has_more: hasMore }),
      // BUY-71542 / P2.6 + BUY-72044 / P2.6A: surface the empty-result triplet
      // when (a) the caller derived one and (b) the response is genuinely empty.
      // Non-empty responses MUST NOT carry an emptiness_reason per spec §2.1.
      ...(isEmpty && emptiness && {
        emptiness_reason: emptiness.emptiness_reason,
        confidence: emptiness.confidence,
        diagnostic: emptiness.diagnostic,
        degraded_kind: emptiness.degraded_kind,
        ...(emptiness.degraded_kind && { degraded_reason: emptiness.diagnostic.timed_out_stage ?? 'catalog_search' }),
        // BUY-79690: echo normalized dest whenever the caller passed one (country=/country_code=/deliver_to=),
        // including empty 200s. diagnostic.deliver_to_present===true means the caller passed a signal.
        ...(emptiness.diagnostic.deliver_to_present && expectedCountryCode && {
          deliver_to: String(expectedCountryCode).toUpperCase(),
        }),
      }),
      // BUY-79690: echo normalized dest whenever the caller passed one, including
      // empty 200s via country=/country_code= (not only deliver_to=).
      ...(expectedCountryCode && { deliver_to: String(expectedCountryCode).toUpperCase() }),
    },
  };
}

/**
 * BUY-71542 / P2.6 + BUY-72044 / P2.6A: build the emptiness_reason/confidence/diagnostic triplet
 * for an empty MCP response. Centralized so every tool can call this with
 * the signals it actually observed — heuristics per spec §4.
 */
export interface EmptinessSignals {
  /** Did the catalog have ANY rows for this region/country? */
  regionHasAnyData: boolean;
  /** Did the catalog have ANY rows for this category (when the caller asked for one)? */
  categoryHasAnyData: boolean;
  /** Did a downstream call (DB / vector / redis) raise an error? */
  apiError: boolean;
  /** Did we hit a rate limit / quota? */
  rateLimited: boolean;
  /** Is the requested region one we ever index? */
  regionSupported: boolean;
  /** Was a category filter present and recognized? */
  categoryRequested: boolean;
  /** Caller-passed category string (lowercased/trimmed). */
  requestedCategory?: string | null;
  /** Caller-passed country code (uppercased). */
  requestedCountry?: string | null;
  /** Optional rate_limit_remaining signal from the rate-limiter. */
  rateLimitRemaining?: number | null;
  /**
   * BUY-72044 / P2.6A: did the caller pass any of deliver_to/country_code/country?
   * Drives `diagnostic.deliver_to_present`. When false AND the response is empty,
   * this signals the caller likely needs to re-issue with a buyer market.
   */
  deliverToPresent: boolean;
  /**
   * BUY-72044 / P2.6A: would the same query (no country filter applied) have produced
   * ≥1 row globally? Used to distinguish "catalog truly has nothing" (no_data) from
   * "catalog has matches but none for the buyer's region" (deliver_to_missing when
   * deliverToPresent is false). Set to `null` when no parallel probe was run.
   */
  unfilteredHasAnyData?: boolean | null;
  /** BUY-72044 / P2.6A: ambiguous-query flag for the confidence=low override. */
  queryAmbiguous?: boolean | null;
  /**
   * BUY-74597: if the handler hit a timeout / auth failure / upstream exception /
   * circuit open, set this to the appropriate classification so deriveEmptiness
   * returns the degraded envelope and telemetry can count it separately.
   */
  degradedKind?: 'timeout' | 'partial_timeout' | 'auth_failure' | 'upstream_exception' | 'circuit_open' | null;
  /** BUY-74597: when degradedKind is timeout/partial_timeout, name the stage that failed. */
  timedOutStage?: string | null;
}

/** Known country codes the catalog actively indexes (covers all 5 SEA + US). */
export const SUPPORTED_REGIONS = new Set(['SG', 'US', 'MY', 'TH', 'VN', 'PH', 'ID']);

/**
 * Determine emptiness_reason + confidence + diagnostic from observed signals.
 *
 * Heuristics (per spec §4, plus BUY-72044 / P2.6A amendment):
 * - api_error  ⇒ reason=api_error, confidence=low, engine_status=error.
 * - rateLimited ⇒ reason=quota, confidence=low, engine_status=degraded.
 * - region not supported ⇒ reason=region_unsupported, confidence=low.
 * - category requested but no rows for category ⇒ reason=category_unsupported,
 *   confidence=low (caller may want to widen the query).
 * - region supported but no rows at all ⇒ reason=no_data, confidence=high.
 * - region has rows but query/filters exclude all of them ⇒ reason=no_match,
 *   confidence=high.
 * - BUY-72044 / P2.6A: caller omitted deliver_to/country_code/country AND the
 *   unfiltered probe found at least one matching row somewhere ⇒ reason=deliver_to_missing.
 *   `confidence=low` when the query is ambiguous AND the catalog has ≤5 matching
 *   rows (caller may need to widen); otherwise `confidence=high`.
 */
export function deriveEmptiness(signals: EmptinessSignals): {
  emptiness_reason: EmptinessReason;
  confidence: SearchConfidence;
  diagnostic: EmptinessDiagnostic;
  degraded_kind?: import('../types/product').DegradedKind;
} {
  // BUY-72044 / P2.6A: diagnostic.deliver_to_present is populated on every branch
  // (true|false, never null) so the agent can verify the engine saw the absence
  // of a buyer-market filter.
  const baseDiag = {
    deliver_to_present: signals.deliverToPresent,
  };

  // BUY-74597: timeout / auth failure / circuit open / upstream exception take
  // precedence over other empty-result heuristics. They always return
  // status=degraded, confidence=low, and a stage diagnostic.
  // BUY-79931: timeout is degraded_kind only. P2.6 emptiness_reason enum
  // is locked (no_data|no_match|api_error|quota|region_unsupported|
  // category_unsupported|deliver_to_missing|invalid_deliver_to). Timeouts
  // and infra failures map to api_error so REST and MCP share a class.
  if (signals.degradedKind === 'timeout' || signals.degradedKind === 'partial_timeout') {
    return {
      emptiness_reason: 'api_error',
      confidence: 'low',
      diagnostic: {
        engine_status: 'degraded',
        indexed_for_region: signals.regionSupported,
        category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
        rate_limit_remaining: signals.rateLimitRemaining ?? null,
        timed_out_stage: signals.timedOutStage ?? null,
        ...baseDiag,
      },
      degraded_kind: signals.degradedKind === 'partial_timeout' ? 'partial_timeout' : 'timeout',
    };
  }
  if (signals.degradedKind === 'auth_failure') {
    return {
      emptiness_reason: 'api_error',
      confidence: 'low',
      diagnostic: {
        engine_status: 'error',
        indexed_for_region: signals.regionSupported,
        category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
        rate_limit_remaining: signals.rateLimitRemaining ?? null,
        timed_out_stage: null,
        ...baseDiag,
      },
      degraded_kind: 'auth_failure',
    };
  }
  if (signals.degradedKind === 'upstream_exception' || signals.degradedKind === 'circuit_open') {
    return {
      emptiness_reason: 'api_error',
      confidence: 'low',
      diagnostic: {
        engine_status: 'degraded',
        indexed_for_region: signals.regionSupported,
        category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
        rate_limit_remaining: signals.rateLimitRemaining ?? null,
        timed_out_stage: signals.timedOutStage ?? null,
        ...baseDiag,
      },
      degraded_kind: signals.degradedKind,
    };
  }

  if (signals.apiError) {
    return {
      emptiness_reason: 'api_error',
      confidence: 'low',
      diagnostic: {
        engine_status: 'error',
        indexed_for_region: signals.regionSupported,
        category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
        rate_limit_remaining: signals.rateLimitRemaining ?? null,
        ...baseDiag,
      },
    };
  }
  if (signals.rateLimited) {
    return {
      emptiness_reason: 'quota',
      confidence: 'low',
      diagnostic: {
        engine_status: 'degraded',
        indexed_for_region: signals.regionSupported,
        category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
        rate_limit_remaining: signals.rateLimitRemaining ?? 0,
        ...baseDiag,
      },
    };
  }
  if (signals.requestedCountry && !signals.regionSupported) {
    return {
      emptiness_reason: 'region_unsupported',
      confidence: 'low',
      diagnostic: {
        engine_status: 'ok',
        indexed_for_region: false,
        category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
        rate_limit_remaining: signals.rateLimitRemaining ?? null,
        invalid_deliver_to: true,
        ...baseDiag,
      },
    };
  }
  // BUY-79690: empty + no dest at all is deliver_to_missing (no unfiltered probe required).
  if (!signals.deliverToPresent) {
    return {
      emptiness_reason: 'deliver_to_missing',
      confidence: 'high',
      diagnostic: {
        engine_status: 'ok',
        indexed_for_region: signals.regionSupported,
        category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
        rate_limit_remaining: signals.rateLimitRemaining ?? null,
        ...baseDiag,
      },
    };
  }
  if (signals.categoryRequested && signals.regionHasAnyData && !signals.categoryHasAnyData) {
    return {
      emptiness_reason: 'category_unsupported',
      confidence: 'low',
      diagnostic: {
        engine_status: 'ok',
        indexed_for_region: true,
        category_recognized: false,
        rate_limit_remaining: signals.rateLimitRemaining ?? null,
        ...baseDiag,
      },
    };
  }
  if (!signals.regionHasAnyData) {
    return {
      emptiness_reason: 'no_data',
      confidence: 'high',
      diagnostic: {
        engine_status: 'ok',
        indexed_for_region: signals.regionSupported,
        category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
        rate_limit_remaining: signals.rateLimitRemaining ?? null,
        ...baseDiag,
      },
    };
  }
  return {
    emptiness_reason: 'no_match',
    confidence: 'high',
    diagnostic: {
      engine_status: 'ok',
      indexed_for_region: true,
      category_recognized: signals.categoryRequested && signals.categoryHasAnyData,
      rate_limit_remaining: signals.rateLimitRemaining ?? null,
      ...baseDiag,
    },
  };
}
