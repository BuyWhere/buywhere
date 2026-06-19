"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFxRefresh = runFxRefresh;
const config_1 = require("../config");
const TARGET_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'MYR', 'IDR', 'THB', 'PHP', 'VND', 'SGD'];
const FRANKFURTER_API = 'https://api.frankfurter.app/latest';
const OPEN_ER_API = 'https://open.er-api.com/v6/latest/USD';
const TIMEOUT_MS = 12000;
function normalizeCurrency(value) {
    return value.toUpperCase().trim();
}
async function fetchJson(url) {
    const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
            accept: 'application/json',
        },
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
    }
    return response.json();
}
async function fetchFrankfurterRates() {
    const symbols = TARGET_CURRENCIES.filter((currency) => currency !== 'USD').join(',');
    const frankfurterUrl = `${FRANKFURTER_API}?from=USD&to=${encodeURIComponent(symbols)}`;
    const payload = await fetchJson(frankfurterUrl);
    const result = new Map();
    for (const targetCurrency of TARGET_CURRENCIES.filter((currency) => currency !== 'USD')) {
        const rate = payload.rates[targetCurrency];
        if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
            result.set(normalizeCurrency(targetCurrency), 1 / rate);
        }
    }
    return result;
}
async function fetchOpenErRates() {
    const payload = await fetchJson(OPEN_ER_API);
    const rates = payload.rates || {};
    const result = new Map();
    for (const targetCurrency of TARGET_CURRENCIES.filter((currency) => currency !== 'USD')) {
        const rate = rates[targetCurrency];
        if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
            result.set(normalizeCurrency(targetCurrency), 1 / rate);
        }
    }
    return result;
}
async function logFxRefreshRun(summary) {
    const sql = `
    INSERT INTO fx_rate_refresh_log
      (ran_at, requested_currencies, frankfurter_rates, fallback_rates, missing_currencies, upserted, errors)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7)
  `;
    await config_1.db.query(sql, [
        summary.ran_at,
        summary.requested_currencies,
        summary.frankfurter_rates,
        summary.fallback_rates,
        summary.missing_currencies,
        summary.upserted,
        JSON.stringify(summary.errors),
    ]);
}
async function upsertRates(rates) {
    if (rates.length === 0) {
        return 0;
    }
    const values = [];
    const params = [];
    let idx = 1;
    for (const row of rates) {
        values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, NOW())`);
        params.push(row.base_currency, row.quote_currency, row.rate, row.source);
        idx += 4;
    }
    const query = `
    INSERT INTO fx_rates
      (base_currency, quote_currency, rate, source, updated_at)
    VALUES
      ${values.join(', ')}
    ON CONFLICT (base_currency, quote_currency)
      DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at
  `;
    await config_1.db.query(query, params);
    return rates.length;
}
async function runFxRefresh() {
    const ran_at = new Date();
    const requested_currencies = [...TARGET_CURRENCIES];
    const summary = {
        ran_at,
        requested_currencies,
        frankfurter_rates: [],
        fallback_rates: [],
        missing_currencies: [],
        upserted: 0,
        errors: [],
    };
    const resolvedRates = new Map();
    const missingFromFrankfurter = new Set(TARGET_CURRENCIES.filter((currency) => currency !== 'USD'));
    try {
        const frankfurterRates = await fetchFrankfurterRates();
        for (const [currency, rate] of frankfurterRates.entries()) {
            if (rate > 0) {
                const normalized = normalizeCurrency(currency);
                resolvedRates.set(normalized, {
                    base_currency: normalized,
                    quote_currency: 'USD',
                    rate,
                    source: 'frankfurter.app',
                });
                summary.frankfurter_rates.push(normalized);
                missingFromFrankfurter.delete(normalized);
            }
        }
    }
    catch (error) {
        summary.errors.push(`frankfurter fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    summary.missing_currencies = [...missingFromFrankfurter];
    if (summary.missing_currencies.length > 0) {
        try {
            const openRates = await fetchOpenErRates();
            const stillMissing = [];
            for (const missingCurrency of summary.missing_currencies) {
                const rate = openRates.get(missingCurrency);
                if (rate != null && rate > 0) {
                    resolvedRates.set(missingCurrency, {
                        base_currency: missingCurrency,
                        quote_currency: 'USD',
                        rate,
                        source: 'open.er-api.com',
                    });
                    summary.fallback_rates.push(missingCurrency);
                }
                else {
                    stillMissing.push(missingCurrency);
                }
            }
            summary.missing_currencies = stillMissing;
        }
        catch (error) {
            summary.errors.push(`open-er-api fallback failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    resolvedRates.set('USD', { base_currency: 'USD', quote_currency: 'USD', rate: 1, source: 'identity' });
    const rows = requested_currencies
        .map((currency) => resolvedRates.get(currency))
        .filter((value) => value != null);
    try {
        summary.upserted = await upsertRates(rows);
    }
    catch (error) {
        summary.errors.push(`fx_rates upsert failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        await logFxRefreshRun(summary);
    }
    catch (error) {
        summary.errors.push(`fx rate refresh log failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return summary;
}
if (require.main === module) {
    runFxRefresh()
        .then((summary) => {
        console.log('[fx-refresh] complete', JSON.stringify({
            ...summary,
            upserted: summary.upserted,
            missing: summary.missing_currencies.length,
        }));
        process.exit(0);
    })
        .catch((error) => {
        console.error('[fx-refresh] failed', error);
        process.exit(1);
    });
}
