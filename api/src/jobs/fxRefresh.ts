/**
 * fxRefresh.ts — Pull live FX rates and upsert into fx_rates (BUY-52476).
 *
 * Primary source: frankfurter.app (free, keyless, ECB reference rates).
 *   https://api.frankfurter.app/latest?from=EUR&to=SGD,USD,EUR,GBP,JPY,MYR,IDR,THB,PHP
 *   Response: { base: "EUR", date: "YYYY-MM-DD", rates: { SGD: 1.61, USD: 1.10, ... } }
 *
 * Fallback source (for currencies frankfurter doesn't carry, e.g. VND):
 *   open.er-api.com (free, keyless, USD-base, broader index).
 *   https://open.er-api.com/v6/latest/USD
 *
 * The table is rate_sgd (rate to convert 1 unit of currency → SGD), so we
 * invert the response:
 *   frankfurter (EUR base): rate_sgd[c] = rates.SGD / rates[c]
 *   open.er-api  (USD base): rate_sgd[c] = rates.SGD / rates[c]
 *
 * `as_of` is set to NOW() at the moment of the fetch on the API process
 * (server-time, not the ECB business-date in the response), per the
 * Wave 1/4.4 success criteria: "record as_of server-time at the moment
 * of fetch".
 *
 * Idempotent: UPSERT on PK currency. Safe to call more often than 6h.
 */

import { db } from '../config';

export interface FxRefreshResult {
  ran_at: Date;
  source_url: string;
  fetched_currencies: string[];
  upserted_count: number;
  failed_currencies: string[];
  duration_ms: number;
  error?: string;
}

const FRANKFURTER_URL = process.env.FX_REFRESH_URL || 'https://api.frankfurter.app/latest';
const OPEN_ER_API_URL  = process.env.FX_REFRESH_FALLBACK_URL || 'https://open.er-api.com/v6/latest/USD';

// frankfurter.app coverage as of 2026-06-17: EUR, USD, GBP, JPY, MYR, IDR, THB, PHP, SGD
// (no VND, no KRW). open.er-api.com covers VND and many more.
const FRANKFURTER_CURRENCIES = new Set([
  'EUR', 'USD', 'GBP', 'JPY', 'MYR', 'IDR', 'THB', 'PHP', 'SGD',
]);

// The full currency basket the Wave 1/4.4 success criteria specifies.
// Add more here when new markets come online.
const TARGET_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'MYR', 'IDR', 'THB', 'PHP', 'VND', 'SGD'] as const;

interface FetchedRates {
  source: 'frankfurter' | 'open.er-api';
  sgdRate: number; // base→SGD multiplier from the source
  rates: Record<string, number>; // base→currency multiplier
}

async function fetchFrankfurter(symbols: string[]): Promise<FetchedRates> {
  const toCsv = symbols.join(',');
  const url = `${FRANKFURTER_URL}?from=EUR&to=${toCsv}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`frankfurter HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  const payload = (await response.json()) as {
    base?: string;
    rates?: Record<string, number>;
  };
  if (payload.base !== 'EUR' || !payload.rates || typeof payload.rates.SGD !== 'number' || payload.rates.SGD <= 0) {
    throw new Error(`Unexpected frankfurter payload: ${JSON.stringify(payload).slice(0, 200)}`);
  }
  return { source: 'frankfurter', sgdRate: payload.rates.SGD, rates: payload.rates };
}

async function fetchOpenErApi(): Promise<FetchedRates> {
  const response = await fetch(OPEN_ER_API_URL, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`open.er-api HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  const payload = (await response.json()) as {
    result?: string;
    base_code?: string;
    rates?: Record<string, number>;
  };
  if (payload.result !== 'success' || payload.base_code !== 'USD' || !payload.rates) {
    throw new Error(`Unexpected open.er-api payload: ${JSON.stringify(payload).slice(0, 200)}`);
  }
  if (typeof payload.rates.SGD !== 'number' || payload.rates.SGD <= 0) {
    throw new Error(`open.er-api response missing SGD rate: ${JSON.stringify(payload.rates).slice(0, 200)}`);
  }
  return { source: 'open.er-api', sgdRate: payload.rates.SGD, rates: payload.rates };
}

export async function runFxRefresh(): Promise<FxRefreshResult> {
  const startedAt = Date.now();
  const ran_at = new Date();

  const frankfurterSymbols = TARGET_CURRENCIES.filter((c) => c !== 'EUR' && FRANKFURTER_CURRENCIES.has(c));
  const fallbackSymbols    = TARGET_CURRENCIES.filter((c) => !FRANKFURTER_CURRENCIES.has(c));

  let source_url: string;
  let primary: FetchedRates | null = null;
  try {
    primary = await fetchFrankfurter(frankfurterSymbols);
    source_url = `${FRANKFURTER_URL}?from=EUR&to=${frankfurterSymbols.join(',')}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[fx-refresh] primary source failed, falling back: ${message}`);
    source_url = OPEN_ER_API_URL;
  }

  let fallback: FetchedRates | null = null;
  if (fallbackSymbols.length > 0) {
    try {
      fallback = await fetchOpenErApi();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[fx-refresh] fallback source failed: ${message}`);
    }
  }

  if (!primary && !fallback) {
    return {
      ran_at,
      source_url,
      fetched_currencies: [],
      upserted_count: 0,
      failed_currencies: [...TARGET_CURRENCIES],
      duration_ms: Date.now() - startedAt,
      error: 'Both primary and fallback FX sources failed',
    };
  }

  // Build (currency, rate_sgd) pairs. SGD itself = 1.0.
  const rows: Array<{ currency: string; rate_sgd: number; source: string }> = [];
  const fetched_currencies: string[] = [];
  const failed_currencies: string[] = [];

  for (const currency of TARGET_CURRENCIES) {
    let rateEur: number | null = null;
    let src: string | null = null;

    if (currency === 'EUR') {
      rateEur = 1; src = primary?.source ?? 'frankfurter';
    } else if (FRANKFURTER_CURRENCIES.has(currency) && primary) {
      const r = primary.rates[currency];
      if (typeof r === 'number' && r > 0) { rateEur = r; src = primary.source; }
    } else if (fallback) {
      // For fallback currencies (USD-base), convert: 1 USD = rates[c] c,
      // and 1 USD = sgdRate SGD. So rate_sgd[c] = sgdRate / rates[c].
      // For EUR we'd need rates.EUR; both sources provide it.
      const r = fallback.rates[currency];
      if (typeof r === 'number' && r > 0) {
        // Express 1 unit of c in terms of USD-base, then convert to SGD.
        // sgdRate is 1 USD→SGD. rates[c] is 1 USD→c. So 1 c→USD = 1/rates[c].
        // 1 c→SGD = (1/rates[c]) * sgdRate.
        const rate_sgd_direct = fallback.sgdRate / r;
        rows.push({ currency, rate_sgd: rate_sgd_direct, source: fallback.source });
        fetched_currencies.push(currency);
        continue;
      }
    }

    if (rateEur == null || src == null) {
      failed_currencies.push(currency);
      console.warn(`[fx-refresh] missing ${currency} rate in ${primary ? 'primary' : 'fallback'} response`);
      continue;
    }
    // rateEur is 1 EUR→c. sgdRate is 1 EUR→SGD. So 1 c→SGD = sgdRate/rateEur.
    const sgdFromPrimary = primary ? primary.sgdRate / rateEur : 0;
    if (!Number.isFinite(sgdFromPrimary) || sgdFromPrimary <= 0) {
      failed_currencies.push(currency);
      continue;
    }
    rows.push({ currency, rate_sgd: sgdFromPrimary, source: src });
    fetched_currencies.push(currency);
  }

  // UPSERT all rows in one statement. ON CONFLICT (currency) DO UPDATE
  // replaces the old rate + as_of atomically. SET as_of = NOW() at
  // statement-execution time (= this server's current time).
  if (rows.length > 0) {
    const valuesSql: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < rows.length; i++) {
      const base = i * 2;
      valuesSql.push(`($${base + 1}, $${base + 2}, NOW())`);
      params.push(rows[i].currency, rows[i].rate_sgd);
    }
    await db.query(
      `INSERT INTO fx_rates (currency, rate_sgd, as_of) VALUES ${valuesSql.join(', ')}
       ON CONFLICT (currency) DO UPDATE
         SET rate_sgd = EXCLUDED.rate_sgd,
             as_of    = EXCLUDED.as_of`,
      params
    );
  }

  const result: FxRefreshResult = {
    ran_at,
    source_url,
    fetched_currencies,
    upserted_count: rows.length,
    failed_currencies,
    duration_ms: Date.now() - startedAt,
  };
  console.log(
    `[fx-refresh] Upserted ${rows.length} rate(s): ${rows.map((r) => `${r.currency}=${r.rate_sgd.toFixed(6)}`).join(' ')} ` +
    `(duration=${result.duration_ms}ms)`
  );
  if (failed_currencies.length > 0) {
    console.warn(`[fx-refresh] Failed currencies: ${failed_currencies.join(', ')}`);
  }
  return result;
}
