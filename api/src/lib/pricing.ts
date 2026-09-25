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
 *
 * BUY-81096 follow-up: currencies near USD parity (USD/SGD/GBP/EUR/AUD) keep the
 * pre-existing flat 50,000 ceiling. The original defect was a USD-denominated cap
 * applied to currencies whose units are worth far less; it never affected these,
 * and deriving their ceiling as warnHigh*5 silently LOOSENED five controls that
 * were not broken. Measured: 32 USD rows above 50,000 created in two days (max
 * 180,999), of which 31 sit in the 50k-75k band a raised USD ceiling would newly
 * admit. Most are rupee amounts wearing a USD label -- a currency ATTRIBUTION
 * defect a ceiling cannot fix and must not be widened for. Only high-unit
 * currencies get a derived (warnHigh*5) ceiling.
 */
export const PRICE_BANDS: Record<string, { warnLow: number; warnHigh: number; hardHigh: number }> = {
  USD: { warnLow: 0.50, warnHigh: 15_000, hardHigh: 50_000 },
  SGD: { warnLow: 0.50, warnHigh: 20_000, hardHigh: 50_000 },
  GBP: { warnLow: 0.40, warnHigh: 12_000, hardHigh: 50_000 },
  EUR: { warnLow: 0.45, warnHigh: 14_000, hardHigh: 50_000 },
  AUD: { warnLow: 0.75, warnHigh: 22_000, hardHigh: 50_000 },
  JPY: { warnLow: 10, warnHigh: 5_000_000, hardHigh: 25_000_000 },
  MYR: { warnLow: 2, warnHigh: 65_000, hardHigh: 325_000 },
  PHP: { warnLow: 25, warnHigh: 800_000, hardHigh: 4_000_000 },
  THB: { warnLow: 15, warnHigh: 500_000, hardHigh: 2_500_000 },
  IDR: { warnLow: 1_500, warnHigh: 750_000_000, hardHigh: 3_750_000_000 },
  KRW: { warnLow: 500, warnHigh: 70_000_000, hardHigh: 350_000_000 },
  VND: { warnLow: 500, warnHigh: 80_000_000, hardHigh: 400_000_000 }, // BUY-81096
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

  // BUY-81096: resolve currency BEFORE applying any ceiling. The flat
  // MAX_PRICE is USD-denominated; applying it first silently hard-rejected
  // SEA inventory whose local-unit prices are numerically large
  // (250,000 IDR is about USD 15, not 250,000 dollars).
  const cur = (currency || 'SGD').toUpperCase();
  const band = PRICE_BANDS[cur];

  if (band) {
    if (price > band.hardHigh) {
      return {
        verdict: 'hard_reject',
        reason: `price ${price} ${cur} exceeds hard ceiling ${band.hardHigh} ${cur}`,
      };
    }
  } else if (price > MAX_PRICE) {
    // No band for this currency -- fall back to the flat ceiling.
    return { verdict: 'hard_reject', reason: `price ${price} exceeds maximum ${MAX_PRICE}` };
  }

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
