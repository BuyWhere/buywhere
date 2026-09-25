/**
 * Shared currency formatting utilities.
 * BUY-81045: SGD prices were rendering as bare "$" instead of "SGD" or "S$".
 * Solution: use currencyDisplay:"code" for SGD to show "SGD 1,499" instead of "$1,499".
 */

const CURRENCY_LOCALE_MAP: Record<string, string> = {
  SGD: "en-SG",
  USD: "en-US",
};

/**
 * Format a price with proper currency symbol/code.
 * - SGD displays as "SGD 1,499" (currencyDisplay:"code") to avoid ambiguity with USD
 * - Other currencies use standard locale formatting
 */
export function formatPriceForCurrency(amount: number, currency: string): string {
  const locale = CURRENCY_LOCALE_MAP[currency] || "en-US";

  // BUY-81045: Use currencyDisplay:"code" for SGD to show explicit "SGD" instead of ambiguous "$"
  const currencyDisplay = currency === "SGD" ? "code" : "symbol";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Fallback for unknown currencies
    return `${currency} ${amount.toFixed(0)}`;
  }
}

/**
 * Format a price with explicit decimal places (for deals/savings)
 */
export function formatPriceWithDecimals(amount: number, currency: string): string {
  const locale = CURRENCY_LOCALE_MAP[currency] || "en-US";
  const currencyDisplay = currency === "SGD" ? "code" : "symbol";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
