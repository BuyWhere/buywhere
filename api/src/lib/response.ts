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
  // Legitimate high-end products (luxury watches, high-end appliances, jewelry)
  // stay under $10k. When a price fails validation the amount is nullified so
  // the FE displays nothing instead of a deceptive value.
  const PRICE_MAX = 10_000;
  const sanitizedAmount = (amount != null && amount > 0 && amount <= PRICE_MAX)
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

  const base: CanonicalProduct = {
    id: productId,
    title: row.title as string,
    price: { amount: sanitizedAmount, currency },
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
): SearchResponse {
  return {
    results: products,
    total,
    page: { limit, offset },
    response_time_ms: responseTimeMs,
    cached,
  };
}
