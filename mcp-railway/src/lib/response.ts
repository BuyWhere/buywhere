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
  PH: 'PHP', ID: 'IDR',
};

// BUY-69998: Map ISO country codes to the coarse region labels agents expect
// (sea/us/global). Without this, mcp-railway search responses surfaced
// `country_code=US` rows tagged with `region=sg`, contradicting the FE/agent
// contract that branch on `region` to pick fulfillment logic. The downstream
// SQL filter remains on country_code; this is purely a response-shape fix.
export const PRICE_SENTINEL_MIN = 0.01;
export const PRICE_UNAVAILABLE_TEXT =
  'see merchant (price unavailable in catalog) — click through to confirm';

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

export function isSentinelPrice(amount: unknown): boolean {
  return typeof amount !== 'number' || !Number.isFinite(amount) || amount < PRICE_SENTINEL_MIN;
}

export function formatPriceField(amount: number | null, currency: string) {
  // BUY-79642: never collapse a finite price into a string — FBP REST
  // fallback reads price.amount and would otherwise emit amount=null.
  if (amount == null || !Number.isFinite(amount)) {
    return { amount: null, currency };
  }
  return { amount, currency };
}

export function formatSimilarPriceField(
  amount: number | null,
  currency: string,
) {
  return formatPriceField(amount, currency);
}

export function regionForCountry(countryCode: string | null | undefined): string | null {
  const cc = (countryCode || '').toUpperCase();
  if (!cc) return null;
  // BUY-79642: ISO country as region (sg/us/th), not catalog shard 'sea'.
  if (cc.length === 2) return cc.toLowerCase();
  return null;
}

export function buildProduct(
  row: Record<string, unknown>,
  defaultCurrency: string,
  compact: boolean,
): CanonicalProduct {
  const currency = (row.currency as string) || defaultCurrency;
  const amount = extractNumericPrice(row.price);

  const affiliateUrl = resolvePrecomputedAffiliateUrl(row.affiliate_url);
  const productId = String(row.id);
  const merchant = (row.domain as string) || '';
  const isAmazonMerchant = merchant.toLowerCase().includes('amazon');
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

  // BUY-66199: normalized_price_usd is computed for BOTH compact and
  // non-compact responses. Previously it was compact-only, so a US-market
  // search_products caller saw only the row's native currency (e.g. EUR for a
  // .eu merchant mislabeled country_code=US) with no USD reference — making
  // prices misleading. Mirrors find_best_price, which always exposes USD.
  const rate = CURRENCY_RATES[currency] ?? null;
  const normalized_price_usd = amount != null && rate != null ? +(amount * rate).toFixed(4) : null;

  const title = row.title as string;
  const base: CanonicalProduct = {
    id: productId,
    title,
    // BUY-79449 / BUY-78151: schema.org Product.name is the agent-facing alias of title.
    name: title,
    price: formatPriceField(amount, currency) as unknown as ProductPrice, // string when sentinel, see BUY-65559
    normalized_price_usd,
    merchant,
    url: destinationUrl,
    image_url: (row.image_url as string) || null,
    // BUY-69998: derive region from country_code when the row is missing or
    // contradictory (mcp-railway used to surface `region=sg` on US rows,
    // confusing FE fulfilment logic). Keep the row's own region when present
    // AND consistent with the country_code; otherwise replace it.
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
    updated_at: (row.updated_at as string) || null,
    // BUY-75368: A2 weekly-report needs url_last_checked_at + url_status on
    // every search result so Cart can compute the %-of-24h-fresh metric
    // straight off the response.
    ...(row.url_last_checked_at !== undefined && {
      url_last_checked_at: (row.url_last_checked_at as string | null) ?? null,
    }),
    ...(row.url_status !== undefined && {
      url_status: (row.url_status as string | null) ?? null,
    }),
    ...(isAmazonMerchant && row.updated_at != null && { price_as_of: row.updated_at as string }),
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
      comparison_attributes.push({ key: 'price', label: `Price (${currency})`, value: amount });
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
    results: products,
    total,
    page: { limit, offset },
    response_time_ms: responseTimeMs,
    cached,
    ...(hasMore != null && { has_more: hasMore }),
  };
}
