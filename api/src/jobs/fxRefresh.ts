import { Pool } from 'pg';
import { db } from '../config';

export interface FxRateRecord {
  base_currency: string;
  quote_currency: string;
  rate: number;
  source: 'frankfurter' | 'open.er-api';
  fetched_at: Date;
}

export interface FxRefreshResult {
  success: boolean;
  ratesUpserted: number;
  errors: string[];
  sources: string[];
  durationMs: number;
}

const BASE_CURRENCY = 'EUR';
const TARGET_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'MYR', 'IDR', 'THB', 'PHP', 'VND', 'SGD'] as const;

type TargetCurrency = (typeof TARGET_CURRENCIES)[number];
type FxRateSource = FxRateRecord['source'];

/** frankfurter.app returns ECB rates; base currency is configurable (we use EUR). */
async function fetchFromFrankfurter(base: string): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  const url = `https://api.frankfurter.dev/v1/latest?from=${base}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`frankfurter ${res.status} for ${base}`);
  }

  const data = (await res.json()) as { base: string; rates: Record<string, number> };
  for (const [currency, rate] of Object.entries(data.rates)) {
    if (typeof rate === 'number') {
      rates.set(currency, rate);
    }
  }

  // frankfurter also gives us 1 base = X target, so base->target = rate
  return rates;
}

/**
 * open.er-api.org free tier — used as fallback for currencies frankfurter
 * doesn't carry (e.g. VND). Returns a rates map for a given base.
 */
async function fetchFromOpenErApi(base: string): Promise<Map<string, number>> {
  const url = `https://open.er-api.com/v6/latest/${base}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`open.er-api ${res.status}`);
  }

  const data = (await res.json()) as { rates?: Record<string, number> };
  const rates = new Map<string, number>();
  for (const [currency, rate] of Object.entries(data.rates ?? {})) {
    if (typeof rate === 'number') {
      rates.set(currency, rate);
    }
  }
  return rates;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function upsertRate(pool: Pool, record: FxRateRecord): Promise<void> {
  await pool.query(
    `INSERT INTO fx_rates (base_currency, quote_currency, rate, source, fetched_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (base_currency, quote_currency)
     DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at`,
    [record.base_currency, record.quote_currency, record.rate, record.source, record.fetched_at],
  );
}

export async function runFxRefresh(): Promise<FxRefreshResult> {
  const start = Date.now();
  const errors: string[] = [];
  const sources = new Set<FxRateSource>();
  let ratesUpserted = 0;
  const pool = db;
  const fetchedAt = new Date();

  let frankfurterRates = new Map<string, number>();
  let openErRates: Map<string, number> | null = null;
  let frankfurterFetchError: string | null = null;

  try {
    // Primary: fetch from frankfurter using EUR as the pivot base (most supported).
    try {
      frankfurterRates = await fetchFromFrankfurter(BASE_CURRENCY);
    } catch (err) {
      frankfurterFetchError = `frankfurter fetch failed for ${BASE_CURRENCY}: ${toErrorMessage(err)}`;
    }

    const getOpenErRate = async (target: string): Promise<number | undefined> => {
      if (!openErRates) {
        openErRates = await fetchFromOpenErApi(BASE_CURRENCY);
      }
      return openErRates.get(target);
    };

    for (const targetCurrency of TARGET_CURRENCIES) {
      if (targetCurrency === BASE_CURRENCY) {
        await upsertRate(pool, {
          base_currency: BASE_CURRENCY,
          quote_currency: BASE_CURRENCY,
          rate: 1,
          source: 'frankfurter',
          fetched_at: fetchedAt,
        });
        ratesUpserted++;
        sources.add('frankfurter');
        continue;
      }

      const frankfurterRate = frankfurterRates.get(targetCurrency);
      if (frankfurterRate == null) {
        try {
          const fallbackRate = await getOpenErRate(targetCurrency);
          if (fallbackRate == null) {
            errors.push(`open.er-api missing rate for ${BASE_CURRENCY}->${targetCurrency}`);
            continue;
          }

          await upsertRate(pool, {
            base_currency: BASE_CURRENCY,
            quote_currency: targetCurrency as TargetCurrency,
            rate: fallbackRate,
            source: 'open.er-api',
            fetched_at: fetchedAt,
          });
          ratesUpserted++;
          sources.add('open.er-api');
        } catch (err) {
          errors.push(`open.er-api fallback for ${BASE_CURRENCY}->${targetCurrency} failed: ${toErrorMessage(err)}`);
          continue;
        }

        continue;
      }

      await upsertRate(pool, {
        base_currency: BASE_CURRENCY,
        quote_currency: targetCurrency as TargetCurrency,
        rate: frankfurterRate,
        source: 'frankfurter',
        fetched_at: fetchedAt,
      });
      ratesUpserted++;
      sources.add('frankfurter');
    }

    // USD is always 1.0 (base currency for normalized_price_usd)
    await upsertRate(pool, {
      base_currency: 'USD',
      quote_currency: 'USD',
      rate: 1,
      source: 'frankfurter',
      fetched_at: fetchedAt,
    });
    ratesUpserted++;

    if (errors.length === 0 && frankfurterFetchError != null) {
      console.warn(`[fx-refresh] Primary source failed but fallback completed refresh: ${frankfurterFetchError}`);
    }

    return {
      success: errors.length === 0,
      ratesUpserted,
      errors,
      sources: Array.from(sources),
      durationMs: Date.now() - start,
    };
  } finally {
    // Keep the shared pool alive for in-process callers.
  }
}
