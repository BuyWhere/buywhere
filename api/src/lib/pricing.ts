/**
 * BUY-73321: Server-side price validation to filter anomalous merchant data.
 *
 * Outlier detection uses hard bounds (absolute min/max) plus per-currency
 * sanity ranges. Products outside the valid range are rejected at ingest
 * time; products inside the warning band are allowed but logged.
 *
 * Bounds rationale:
 *   - $0.01 absolute minimum: free / $0 items are data errors in a price-comparison catalog.
 *   - $50,000 absolute maximum: covers all consumer goods; anything above is a scraping error.
 *   - Currency-adjusted warning bands catch near-zero prices (e.g. $9 Beats Solo3)
 *     and inflated prices (e.g. $1,099 K-POP headphones) without blocking legit luxury items.
 */

/** Absolute hard floor — reject anything at or below this. */
export const MIN_PRICE = 0.01;

/** Absolute hard ceiling — reject anything at or above this. */
export const MAX_PRICE = 50_000;

/**
 * Per-currency warning bands.  Prices inside the band are accepted;
 * prices outside are flagged as price_outlier and returned as ingest
 * errors so the scraper can be fixed.
 */
export const PRICE_BANDS: Record<string, { warnLow: number; warnHigh: number }> = {
  USD: { warnLow: 0.50, warnHigh: 15_000 },
  SGD: { warnLow: 0.50, warnHigh: 20_000 },
  GBP: { warnLow: 0.40, warnHigh: 12_000 },
  EUR: { warnLow: 0.45, warnHigh: 14_000 },
  AUD: { warnLow: 0.75, warnHigh: 22_000 },
  JPY: { warnLow: 10, warnHigh: 5_000_000 },
  MYR: { warnLow: 2, warnHigh: 65_000 },
  PHP: { warnLow: 25, warnHigh: 800_000 },
  THB: { warnLow: 15, warnHigh: 500_000 },
  IDR: { warnLow: 1_500, warnHigh: 750_000_000 },
  KRW: { warnLow: 500, warnHigh: 70_000_000 },
};

export type PriceVerdict = 'ok' | 'hard_reject' | 'outlier';

export interface PriceCheckResult {
  verdict: PriceVerdict;
  reason?: string;
}

/**
 * Validate a single price against hard bounds and currency-aware
 * sanity ranges.
 */
export function validatePrice(price: number, currency?: string): PriceCheckResult {
  if (!Number.isFinite(price)) {
    return { verdict: 'hard_reject', reason: 'price is not a finite number' };
  }
  if (price < MIN_PRICE) {
    return { verdict: 'hard_reject', reason: `price ${price} is below minimum ${MIN_PRICE}` };
  }
  if (price > MAX_PRICE) {
    return { verdict: 'hard_reject', reason: `price ${price} exceeds maximum ${MAX_PRICE}` };
  }

  const cur = (currency || 'SGD').toUpperCase();
  const band = PRICE_BANDS[cur];
  if (band) {
    if (price < band.warnLow) {
      return {
        verdict: 'outlier',
        reason: `price ${price} ${cur} is below warning low ${band.warnLow} ${cur}`,
      };
    }
    if (price > band.warnHigh) {
      return {
        verdict: 'outlier',
        reason: `price ${price} ${cur} exceeds warning high ${band.warnHigh} ${cur}`,
      };
    }
  }

  return { verdict: 'ok' };
}
