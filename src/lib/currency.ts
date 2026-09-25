// BUY-81045: Shared currency formatter for every product card, hero price, and
// comparison widget.
//
// ROOT BUG FIXED:
// `Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" })` renders
// as bare "$1,499.00" because the en-SG locale (and every browser ICU shipped
// as of 2026) outputs the dollar sign symbol `$` for SGD — exactly identical
// to USD. Shoppers on /laptop-singapore could not distinguish SGD from USD
// cards, which compounded earlier currency-contamination incidents (see
// BUY-71638, BUY-71643, BUY-82928).
//
// FIX: render SGD explicitly. We pick `currencyDisplay: "code"` so the output
// is `SGD 1,499.00` — unambiguous, locale-safe, and what the QA defect
// ("Singapore-localized card prices use S$ or explicit SGD") asked for.
//
// All other currencies fall through to the locale-default symbol so USD stays
// `$1,499.00`, EUR stays `€1.499,00`, JPY stays `¥1,499`, etc. — no regressions.

const DISAMBIGUATE_CURRENCIES = new Set(["SGD", "MYR", "HKD", "NTD", "BND"]);

export function formatPriceForCurrency(
  price: number,
  currency: string,
  maximumFractionDigits = 2,
): string {
  if (!Number.isFinite(price)) {
    return "Price unavailable";
  }
  try {
    const currencyUpper = String(currency || "").toUpperCase();
    const useCodeDisplay = DISAMBIGUATE_CURRENCIES.has(currencyUpper);
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyUpper || "USD",
      maximumFractionDigits,
      ...(useCodeDisplay ? { currencyDisplay: "code" as const } : {}),
    }).format(price);
    // Intl emits "SGD 1,499.00" for code display — keep that as the public
    // contract. (This branch never triggers for USD/EUR/etc., they stay as
    // the locale default.)
    return formatted;
  } catch {
    return `${currency} ${price.toFixed(maximumFractionDigits)}`;
  }
}

// Exported for direct unit-test coverage (see
// src/lib/currency.sgdDisplay.test.ts).
export const __test__ = { formatPriceForCurrency, DISAMBIGUATE_CURRENCIES };
