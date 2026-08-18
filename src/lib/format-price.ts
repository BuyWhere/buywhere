/**
 * Formats a price value with the correct currency symbol.
 *
 * BUY-64057: en-SG locale uses "$" symbol for SGD, but we want "S$" for clarity
 * to distinguish Singapore prices from US prices.
 */
export function formatPrice(price: number | null, currency: string): string {
  if (price === null) {
    return "Price unavailable";
  }

  // BUY-64057: en-SG locale uses "$" symbol for SGD, but we want "S$" for clarity.
  // Format manually for SGD to show the proper currency symbol.
  if (currency === "SGD") {
    return "S$" + price.toLocaleString("en-SG", { maximumFractionDigits: 0 });
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}
