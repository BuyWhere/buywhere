import { CanonicalProduct, ComparisonAttribute, SearchResponse } from '../types/product';
import { resolvePrecomputedAffiliateUrl } from './affiliateWrapper';
import { buildAffiliateRedirectUrl, buildClickUrl } from './instrumentation';

// BUY-63045: in-memory cache of known-dead destination URLs, refreshed by linkHealthChecker.
// Products whose destination_url is in this set are filtered from search results.
const deadUrls = new Set<string>();

export function markDeadUrl(url: string): void { deadUrls.add(url); }
export function clearDeadUrl(url: string): void { deadUrls.delete(url); }
export function isDeadUrl(url: string): boolean { return deadUrls.has(url); }
export function filterDeadProducts(products: CanonicalProduct[]): CanonicalProduct[] {
  if (deadUrls.size === 0) return products;
  return products.filter((p) => !p.url || !deadUrls.has(p.url));
}

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
  // BUY-71129 (re-applied): caller context for thread-through attribution. See api version.
  caller?: {
    apiKeyId?: string | null;
    keyHash?: string | null;
  } | null,
): CanonicalProduct {
  const currency = (row.currency as string) || defaultCurrency;
  const amount = row.price != null ? parseFloat(row.price as string) : null;

  const affiliateUrl = resolvePrecomputedAffiliateUrl(row.affiliate_url);
  const productId = String(row.id);
  const merchant = (row.domain as string) || '';
  const destinationUrl = affiliateUrl ?? (row.url as string);

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

  const base: CanonicalProduct = {
    id: productId,
    title: row.title as string,
    price: { amount, currency },
    merchant,
    url: destinationUrl,
    image_url: (row.image_url as string) || null,
    region: (row.region as string) || null,
    country_code: (row.country_code as string) || null,
    category_path: Array.isArray(row.category_path) ? (row.category_path as string[]) : null,
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
  // BUY-63045: filter out products whose destination URLs are known-dead
  const filtered = filterDeadProducts(products);
  return {
    results: filtered,
    total,
    page: { limit, offset },
    response_time_ms: responseTimeMs,
    cached,
  };
}
