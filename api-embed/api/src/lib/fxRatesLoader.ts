import { db } from '../config';

export const FALLBACK_RATES: Record<string, number> = {
  USD: 1, SGD: 0.74, VND: 0.000039, THB: 0.028, MYR: 0.22, GBP: 0.79,
};

let cachedRates: Record<string, number> = { ...FALLBACK_RATES };
let lastFetch = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function loadFxRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if ((now - lastFetch) < CACHE_TTL_MS) {
    return cachedRates;
  }

  try {
    const result = await db.query(
      `SELECT base_currency, quote_currency, rate 
       FROM fx_rates 
       WHERE base_currency = 'EUR'
       AND fetched_at > NOW() - INTERVAL '24 hours'
       ORDER BY fetched_at DESC`
    );

    const eurRates: Record<string, number> = {};
    for (const row of result.rows) {
      eurRates[row.quote_currency] = parseFloat(row.rate);
    }

    const rates: Record<string, number> = { USD: 1 };
    const eurToUsd = eurRates['USD'];
    
    if (eurToUsd) {
      for (const [currency, eurRate] of Object.entries(eurRates)) {
        if (currency !== 'USD' && eurRate > 0) {
          rates[currency] = eurToUsd / eurRate;
        }
      }
    }

    cachedRates = rates;
    lastFetch = now;
    return rates;
  } catch (err) {
    console.error('[fx-rates-loader] Failed to load from database:', err);
    return cachedRates;
  }
}

export function getCachedFxRates(): Record<string, number> {
  return cachedRates;
}

export function getRate(currency: string, rates: Record<string, number>): number | null {
  return rates[currency] ?? FALLBACK_RATES[currency] ?? null;
}
