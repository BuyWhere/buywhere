import { CanonicalProduct, ComparisonAttribute, SearchResponse } from '../types/product';
import { resolvePrecomputedAffiliateUrl } from './affiliateWrapper';
import { buildAffiliateRedirectUrl, buildClickUrl } from './instrumentation';

import { getCachedFxRates } from './fxRatesLoader';
export const CURRENCY_RATES: Record<string, number> = {
  USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79,
};

export const COUNTRY_CURRENCY: Record<string, string> = {
  SG: 'SGD', US: 'USD', GB: 'GBP', VN: 'VND', TH: 'THB', MY: 'MYR',
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

export function buildProduct(
  row: Record<string, unknown>,
  defaultCurrency: string,
  compact: boolean,
): CanonicalProduct {
  const currency = (row.currency as string) || defaultCurrency;
  const amount = row.price != null ? parseFloat(row.price as string) : null;

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
  const PRICE_MIN = 5;
  const PRICE_MAX = 10_000;
  const sanitizedAmount = (amount != null && amount >= PRICE_MIN && amount <= PRICE_MAX)
    ? amount
    : null;

  const affiliateUrl = resolvePrecomputedAffiliateUrl(row.affiliate_url);
  const productId = String(row.id);
  const merchant = (row.domain as string) || '';
  const destinationUrl = affiliateUrl ?? (row.url as string);

  // BUY-52474: every /v1 product response now carries tracking URLs so the FE
  // naturally routes user clicks through /r/ (logs affiliate_clicks) and /api/click
  // (logs clicks). The raw merchant URL is still in `url` for agents/SEO use;
  // `affiliate_url` keeps its precomputed wrapper when present.
  const clickUrl = destinationUrl
    ? buildClickUrl({ productId, destinationUrl, merchantId: merchant || null })
    : null;
  const affiliateRedirectUrl = destinationUrl
    ? buildAffiliateRedirectUrl({ productId, source: 'product_card' })
    : null;
  const hasAffiliateTracking = Boolean(affiliateUrl || affiliateRedirectUrl);

  const base: CanonicalProduct = {
    id: productId,
    title: row.title as string,
    price: { amount: sanitizedAmount, currency },
    merchant,
    // BUY-74262: expose source field for per-source grouping/filtering
    source: (row.domain as string) || null,
    url: destinationUrl,
    image_url: normalizeImageUrl(row.image_url),
    region: (row.region as string) || null,
    country_code: (row.country_code as string) || null,
    updated_at: (row.updated_at as string) || null,
    // CAT-08: expose stock status as a top-level boolean when known.
    ...(row.in_stock != null && { in_stock: row.in_stock as boolean }),
    ...(affiliateUrl != null && { affiliate_url: affiliateUrl }),
    ...(clickUrl != null && { click_url: clickUrl }),
    ...(affiliateRedirectUrl != null && { affiliate_redirect_url: affiliateRedirectUrl }),
    has_affiliate_tracking: hasAffiliateTracking,
    is_affiliate: hasAffiliateTracking,
    ...(hasAffiliateTracking && {
      affiliate_disclosure: 'BuyWhere may earn a commission from purchases made through tracked product links.',
    }),
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
    base.metadata = row.metadata as Record<string, unknown> | null;
  }

  if (row.original_price != null) {
    base.original_price = parseFloat(row.original_price as string);
  }
  if (row.discount_pct != null) {
    base.discount_pct = parseFloat(row.discount_pct as string);
  }

  return base;
}

export function buildSearchResponse(
  products: CanonicalProduct[],
  total: number,
  limit: number,
  offset: number,
  responseTimeMs: number,
  cached: boolean,
  degraded?: boolean,
  hasMore?: boolean,
): SearchResponse {
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
      ...(degraded != null && { degraded }),
      ...(hasMore != null && { has_more: hasMore }),
    },
  };
}
