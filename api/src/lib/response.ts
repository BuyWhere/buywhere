import { CanonicalProduct, ComparisonAttribute, NearMissPredicateFail, SearchResponse } from '../types/product';
import { resolvePrecomputedAffiliateUrl } from './affiliateWrapper';
import { buildAffiliateRedirectUrl, buildClickUrl } from './instrumentation';

import { getCachedFxRates } from './fxRatesLoader';
export const CURRENCY_RATES: Record<string, number> = {
  USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79,
};

export const COUNTRY_CURRENCY: Record<string, string> = {
  SG: 'SGD', US: 'USD', GB: 'GBP', VN: 'VND', TH: 'THB', MY: 'MYR',
  ID: 'IDR', PH: 'PHP', HK: 'HKD', TW: 'TWD', AU: 'AUD',
};

const ISO_4217_RE = /^[A-Z]{3}$/;
const ISO_4217_CURRENCIES = new Set([
  'AUD', 'GBP', 'HKD', 'IDR', 'MYR', 'PHP', 'SGD', 'THB', 'TWD', 'USD', 'VND',
]);
const MINIMUM_UTILITY_ALLOWED_AVAILABILITY = new Set(['in_stock', 'out_of_stock', 'preorder', 'discontinued', 'unknown']);

function hiddenProductField(product: CanonicalProduct, key: string): unknown {
  return (product as unknown as Record<string, unknown>)[key];
}

function hasUsableImageUrl(imageUrl: string | null): boolean {
  if (!imageUrl) return false;
  if (imageUrl.startsWith('data:image/svg+xml')) return true; // BUY-63954 branded SVG fallback
  return true; // BUY-63507 content probing is upstream; this hook consumes its selected URL.
}

export function evaluateNearMiss(
  products: CanonicalProduct[],
  expectedCountryCode?: string | null,
): { near_miss: boolean; near_miss_predicate_fails: NearMissPredicateFail[] } {
  if (products.length !== 1) return { near_miss: false, near_miss_predicate_fails: [] };

  const product = products[0];
  const fails: NearMissPredicateFail[] = [];
  const currency = product.price?.currency;
  const countryCode = (expectedCountryCode || product.country_code || '').toUpperCase();
  const expectedCurrency = COUNTRY_CURRENCY[countryCode];

  if (product.price?.amount == null || product.price.amount <= 0 || (expectedCurrency && currency !== expectedCurrency)) {
    fails.push('price');
  }
  if (!currency || !ISO_4217_RE.test(currency) || !ISO_4217_CURRENCIES.has(currency)) {
    fails.push('currency');
  }
  if (!product.availability || !MINIMUM_UTILITY_ALLOWED_AVAILABILITY.has(product.availability.status)) {
    fails.push('availability');
  }
  if (!hasUsableImageUrl(product.image_url)) {
    fails.push('image_url');
  }
  if (!product.url || hiddenProductField(product, 'url_status') === 'dead') {
    fails.push('merchant_url');
  }

  return { near_miss: fails.length > 0, near_miss_predicate_fails: fails };
}

function normalizeImageUrl(imageUrl: unknown): string | null {
  if (typeof imageUrl !== 'string' || imageUrl.trim() === '') return null;

  try {
    const parsed = new URL(imageUrl);
    if (parsed.hostname.toLowerCase() === 'source.unsplash.com') return null;
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

  const inStock = row.in_stock != null
    ? row.in_stock as boolean
    : sanitizedAmount != null && sanitizedAmount > 0;

  const base: CanonicalProduct = {
    id: productId,
    title: row.title as string,
    price: { amount: sanitizedAmount, currency },
    merchant,
    url: destinationUrl,
    image_url: normalizeImageUrl(row.image_url),
    region: (row.region as string) || null,
    country_code: (row.country_code as string) || null,
    updated_at: (row.updated_at as string) || null,
    // CAT-08: expose stock status as a top-level boolean when known.
    ...(row.in_stock != null && { in_stock: row.in_stock as boolean }),
    // BUY-70574/BUY-70043: basket verification consumes availability.in_stock.
    // When feeds omit explicit stock, positive-price catalog rows are minimally
    // considered available so agent commerce flows have a usable availability signal.
    availability: {
      in_stock: inStock,
      status: inStock ? 'in_stock' : 'out_of_stock',
    },
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

  Object.defineProperty(base, 'url_status', {
    value: (row as Record<string, unknown>).url_status ?? null,
    enumerable: false,
  });

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
  expectedCountryCode?: string | null,
): SearchResponse {
  const nearMiss = evaluateNearMiss(products, expectedCountryCode);
  return {
    data: products,
    meta: {
      total,
      limit,
      offset,
      response_time_ms: responseTimeMs,
      cached,
      near_miss: nearMiss.near_miss,
      near_miss_predicate_fails: nearMiss.near_miss_predicate_fails,
      ...(degraded != null && { degraded }),
      ...(hasMore != null && { has_more: hasMore }),
    },
  };
}
