/**
 * fxRates.ts — In-memory cache of fx_rates for /v1/products price conversion
 * (BUY-52476). Mirrors the readReplica.ts pattern: cache once per process,
 * fall back to DB on cache miss, refresh TTL'd by FX_CACHE_TTL_MS.
 *
 * The /v1/products compact-mode price-conversion read-path calls
 * getRateUsd(currency) to compute normalized_price_usd, and records the
 * fx_rates.as_of timestamp into products.fx_as_of via recordConversion().
 *
 * Why USD-denominated: the existing public response emits
 *   { normalized_price_usd: number }
 * in compact mode (see api/src/lib/response.ts). The fx_rates table is
 * SGD-denominated (rate_sgd), so we convert via USD as the intermediate:
 *   rateUsd[c] = rate_sgd[c] / rate_sgd[USD]
 * which is equivalent to "1 c = X USD" using the same fx_rates snapshot.
 *
 * Lazy write semantics: recordConversion() only writes if the cached
 * fx_as_of is newer than what's already on the row, so the per-row UPDATE
 * is a no-op after the first conversion until the next 6h refresh.
 */

import { db } from '../config';

export interface FxRateSnapshot {
  // currency (e.g. 'USD') -> rate to convert 1 unit to USD (e.g. SGD→USD = 0.78).
  // USD itself maps to 1.0 (1 USD = 1 USD).
  ratesUsd: Record<string, number>;
  // Server-time when these rates were fetched.
  asOf: Date;
  // Source label for logging ('frankfurter' | 'open.er-api').
  source: string;
}

const CACHE_TTL_MS = parseInt(process.env.FX_CACHE_TTL_MS || '300000', 10); // 5 min

let cached: FxRateSnapshot | null = null;
let cacheExpiresAt = 0;
let inflightFetch: Promise<FxRateSnapshot | null> | null = null;

async function loadFromDb(): Promise<FxRateSnapshot | null> {
  try {
    // Order USD first so we can compute rateUsd for everything else.
    const result = await db.query<{ currency: string; rate_sgd: string; as_of: Date }>(
      `SELECT currency, rate_sgd, as_of FROM fx_rates ORDER BY currency`
    );
    if (result.rows.length === 0) return null;

    const rateSgd: Record<string, number> = {};
    let asOf: Date | null = null;
    for (const r of result.rows) {
      rateSgd[r.currency] = parseFloat(r.rate_sgd);
      if (asOf === null || r.as_of < asOf) asOf = r.as_of;
    }
    if (asOf === null) return null;

    const usdSgd = rateSgd.USD;
    if (typeof usdSgd !== 'number' || usdSgd <= 0) {
      console.warn('[fx-rates] fx_rates.USD is missing or invalid; USD normalization disabled');
      return null;
    }

    const ratesUsd: Record<string, number> = {};
    for (const [currency, rate] of Object.entries(rateSgd)) {
      // 1 c = rateSgd[c] SGD. 1 USD = usdSgd SGD. So 1 c = rateSgd[c]/usdSgd USD.
      ratesUsd[currency] = rate / usdSgd;
    }
    ratesUsd.USD = 1.0; // exact

    return {
      ratesUsd,
      asOf,
      source: 'fx_rates',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[fx-rates] DB load failed: ${message}`);
    return null;
  }
}

/** Get the current FX snapshot, loading from DB on cache miss/expiry. */
export async function getSnapshot(): Promise<FxRateSnapshot | null> {
  const now = Date.now();
  if (cached && now < cacheExpiresAt) return cached;
  if (inflightFetch) return inflightFetch;

  inflightFetch = (async () => {
    const fresh = await loadFromDb();
    if (fresh) {
      cached = fresh;
      cacheExpiresAt = now + CACHE_TTL_MS;
    }
    inflightFetch = null;
    return fresh;
  })();
  return inflightFetch;
}

/** Get USD rate for a currency, e.g. getRateUsd('MYR') ≈ 0.24 (1 MYR = 0.24 USD). */
export async function getRateUsd(currency: string): Promise<number | null> {
  const snap = await getSnapshot();
  if (!snap) return null;
  const r = snap.ratesUsd[currency];
  return typeof r === 'number' && Number.isFinite(r) ? r : null;
}

/** Get the as_of timestamp of the rates we're using. */
export async function getRatesAsOf(): Promise<Date | null> {
  const snap = await getSnapshot();
  return snap?.asOf ?? null;
}

/**
 * Stamp products.fx_as_of with the current fx_rates.as_of iff it's newer
 * than what's already on the row. This is the "lazy audit trail" write —
 * fire-and-forget from the read path so it never blocks the response.
 *
 * Returns true when a write happened, false when no-op (already current),
 * null when no fx snapshot is loaded.
 */
export async function recordConversion(
  productId: string | number,
  asOf: Date
): Promise<boolean | null> {
  try {
    const result = await db.query(
      `UPDATE products
         SET fx_as_of = $1
       WHERE id = $2
         AND (fx_as_of IS NULL OR fx_as_of < $1)`,
      [asOf, productId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Non-fatal: the read path is hot, so we don't surface this.
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[fx-rates] recordConversion failed for ${productId}: ${message}`);
    }
    return null;
  }
}

/** Invalidate cache (e.g. after a manual fxRefresh for tests). */
export function invalidateFxCache(): void {
  cached = null;
  cacheExpiresAt = 0;
}
