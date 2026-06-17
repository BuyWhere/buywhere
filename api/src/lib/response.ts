import { CanonicalProduct, ComparisonAttribute, SearchResponse } from '../types/product';
import { resolvePrecomputedAffiliateUrl } from './affiliateWrapper';

export const CURRENCY_RATES: Record<string, number> = {
  USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79,
};

export const COUNTRY_CURRENCY: Record<string, string> = {
  SG: 'SGD', US: 'USD', GB: 'GBP', VN: 'VND', TH: 'THB', MY: 'MYR',
};

/**
 * Optional FX snapshot passed in from the /v1/products read-path
 * (BUY-52476). When provided AND has a rate for the product's currency,
 * buildProduct uses it for normalized_price_usd and stamps fx_as_of onto
 * the row (lazy audit trail). Otherwise we fall back to the static
 * CURRENCY_RATES table above — zero behaviour change for callers that
 * don't opt in.
 */
export interface FxSnapshotForResponse {
  ratesUsd: Record<string, number>; // currency -> 1 c = X USD
  asOf: Date;
}

export function buildProduct(
  row: Record<string, unknown>,
  defaultCurrency: string,
  compact: boolean,
  fxSnapshot?: FxSnapshotForResponse | null,
): CanonicalProduct {
  const currency = (row.currency as string) || defaultCurrency;
  const amount = row.price != null ? parseFloat(row.price as string) : null;

  const affiliateUrl = resolvePrecomputedAffiliateUrl(row.affiliate_url);
  const base: CanonicalProduct = {
    id: row.id as string,
    title: row.title as string,
    price: { amount, currency },
    merchant: row.domain as string,
    url: affiliateUrl ?? (row.url as string),
    image_url: (row.image_url as string) || null,
    region: (row.region as string) || null,
    country_code: (row.country_code as string) || null,
    updated_at: (row.updated_at as string) || null,
    ...(affiliateUrl != null && { affiliate_url: affiliateUrl }),
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

    // BUY-52476: prefer the live fx_rates snapshot when present; fall back
    // to the static CURRENCY_RATES (Q1-2026 approximate) for backward compat.
    const fxRate = fxSnapshot?.ratesUsd[currency];
    const staticRate = CURRENCY_RATES[currency];
    const rate = (typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0)
      ? fxRate
      : (staticRate ?? null);
    const fxAsOf = (typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0 && fxSnapshot)
      ? fxSnapshot.asOf.toISOString()
      : null;
    const normalized_price_usd = amount != null && rate != null ? +(amount * rate).toFixed(4) : null;

    base.canonical_id = row.id as string;
    base.normalized_price_usd = normalized_price_usd;
    // BUY-52476: surface fx provenance in the response so consumers can audit
    // which fx_rates snapshot was used for the normalized price.
    if (fxAsOf != null) {
      (base as unknown as Record<string, unknown>).fx_as_of = fxAsOf;
    }
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
