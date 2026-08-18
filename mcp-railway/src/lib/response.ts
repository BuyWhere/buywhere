import { CanonicalProduct, ComparisonAttribute, ProductPrice, SearchResponse } from '../types/product';
import { resolvePrecomputedAffiliateUrl } from './affiliateWrapper';
import { buildAffiliateRedirectUrl, buildClickUrl } from './instrumentation';

export const CURRENCY_RATES: Record<string, number> = {
  // Convention: USD per 1 unit of the foreign currency (amount * rate = USD).
  USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79,
  // BUY-66199: EUR added so EUR-priced rows (e.g. .eu merchants mislabeled
  // country_code=US) can still normalize to USD. find_best_price already
  // exposes normalized_price_usd; search_products non-compact now does too.
  EUR: 1.09,
};

export const COUNTRY_CURRENCY: Record<string, string> = {
  SG: 'SGD', US: 'USD', GB: 'GBP', VN: 'VND', TH: 'THB', MY: 'MYR',
};

// BUY-65559 / BUY-65685: Sentinel-price guard (parallel to PR #36 in @buywhere/mcp).
// Catalog rows where `price.amount < 10` (or non-finite / null) are produced by
// the BuyWhere ingest pipeline when the merchant page had no parseable price;
// the scraper writes `1` as a placeholder, which AI agents then render as
// `.00` ("Price: $1.00 SGD"). Until BUY-52807 ships an ingest-time sanity bound,
// surface a "see merchant" hint so MCP clients (AI agents) do not quote a fake
// price. The JSON-RPC surface is the dominant AI-agent touchpoint (mcp.buywhere.ai /
// Railway mcp-server, far higher traffic than the npm @buywhere/mcp consumers).
// We replace the structured `price` object with a sentinel string in the JSON
// output so AI agents cannot accidentally format `price.amount` as `.00`.
export const PRICE_SENTINEL_MIN = 10;
export const PRICE_UNAVAILABLE_TEXT =
  'see merchant (price unavailable in catalog) — click through to confirm';

export function isSentinelPrice(amount: unknown): boolean {
  return typeof amount !== 'number' || !Number.isFinite(amount) || amount < PRICE_SENTINEL_MIN;
}

/**
 * Format the `price` field for JSON-RPC tool outputs. When the amount is a
 * sentinel (placeholder from the ingest pipeline), return a short string so
 * AI agents display a "see merchant" hint instead of formatting a fake price.
 * Otherwise return the standard `{amount, currency}` object.
 */
export function formatPriceField(amount: number | null, currency: string): ProductPrice | string {
  if (isSentinelPrice(amount)) {
    return PRICE_UNAVAILABLE_TEXT;
  }
  return { amount: amount as number, currency };
}

/**
 * BUY-65693: format the `price` field for the flat `find_similar` response shape.
 *
 * Unlike the other JSON-RPC tools (which nest `{price: {amount, currency}}`),
 * `handleFindSimilar` returns each similar product as a flat object with
 * `price` and `currency` as sibling fields. We can't reuse `formatPriceField`
 * 1:1 because callers must assign the helper's return to the `price` slot —
 * so the helper returns either the sentinel string OR the structured
 * `{amount, currency}` object, and the caller drops the now-redundant sibling
 * `currency` field at the same time.
 */
export function formatSimilarPriceField(
  amount: number | null,
  currency: string,
): ProductPrice | string {
  return formatPriceField(amount, currency);
}


// F2 (2026-08-18): Amazon Associates monetization — outbound amazon.com URLs get
// our tracking tag when none is present. Applied at serialization so url,
// click_url and affiliate redirects all inherit it. amazon.sg intentionally
// EXCLUDED until the separate buywhere-22 account is confirmed (ledger R3).
// buywhere-20 (US) and buywhere-22 (SG) are one linked account (Richmond,
// 2026-08-18); reporting is per-program, so each storefront must carry ITS tag.
// The correct tag is FORCED — this also repairs precomputed affiliate links that
// were bulk-built in April with the US tag on amazon.sg. Other-country amazon
// domains are left untouched (no program tag for them yet).
const AMAZON_TAGS: Record<string, string> = {
  'amazon.com': 'buywhere-20',
  'amazon.sg': 'buywhere-22',
};
function wrapAmazonAffiliateTag(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    for (const [domain, tag] of Object.entries(AMAZON_TAGS)) {
      if (host === domain || host.endsWith('.' + domain)) {
        if (u.searchParams.get('tag') !== tag) {
          u.searchParams.set('tag', tag);
          return u.toString();
        }
        break;
      }
    }
  } catch { /* malformed URL — pass through untouched */ }
  return url;
}

export function buildProduct(
  row: Record<string, unknown>,
  defaultCurrency: string,
  compact: boolean,
): CanonicalProduct {
  const currency = (row.currency as string) || defaultCurrency;
  const amount = row.price != null ? parseFloat(row.price as string) : null;

  const affiliateUrl = resolvePrecomputedAffiliateUrl(row.affiliate_url);
  const productId = String(row.id);
  const merchant = (row.domain as string) || '';
  const destinationUrl = wrapAmazonAffiliateTag(affiliateUrl ?? (row.url as string));

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

  // BUY-66199: normalized_price_usd is computed for BOTH compact and
  // non-compact responses. Previously it was compact-only, so a US-market
  // search_products caller saw only the row's native currency (e.g. EUR for a
  // .eu merchant mislabeled country_code=US) with no USD reference — making
  // prices misleading. Mirrors find_best_price, which always exposes USD.
  const rate = CURRENCY_RATES[currency] ?? null;
  const normalized_price_usd = amount != null && rate != null ? +(amount * rate).toFixed(4) : null;

  const base: CanonicalProduct = {
    id: productId,
    title: row.title as string,
    price: formatPriceField(amount, currency), // string when sentinel, see BUY-65559
    normalized_price_usd,
    merchant,
    url: destinationUrl,
    image_url: (row.image_url as string) || null,
    region: (row.region as string) || null,
    country_code: (row.country_code as string) || null,
    updated_at: (row.updated_at as string) || null,
    ...(affiliateUrl != null && { affiliate_url: affiliateUrl }),
    ...(clickUrl != null && { click_url: clickUrl }),
    ...(affiliateRedirectUrl != null && { affiliate_redirect_url: affiliateRedirectUrl }),
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
      comparison_attributes.push({
        key: 'price',
        label: `Price (${currency})`,
        value: isSentinelPrice(amount) ? PRICE_UNAVAILABLE_TEXT : amount,
      });
    if (structured_specs.model != null)
      comparison_attributes.push({ key: 'model', label: 'Model', value: structured_specs.model });
    if (structured_specs.color != null)
      comparison_attributes.push({ key: 'color', label: 'Color', value: structured_specs.color });

    base.canonical_id = row.id as string;
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
  hasMore?: boolean,
): SearchResponse {
  return {
    // BUY-71275: preserve stable agent contract while staying compatible with
    // the newer REST-style envelopes that appeared during the 08:20Z regression.
    products,
    results: products,
    items: products,
    data: products,
    total,
    page: { limit, offset },
    response_time_ms: responseTimeMs,
    cached,
    ...(hasMore != null && { has_more: hasMore }),
  };
}
