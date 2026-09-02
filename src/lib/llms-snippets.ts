/**
 * BUY-70312: Per-product llms.txt snippets & category landing-page snippets.
 *
 * Shared SSR-safe helpers that render llms.txt plain-text blocks for two
 * surfaces:
 *   1. Inline <script type="text/llms.txt"> in <head>  (no client JS needed)
 *   2. Crawlable at /llms/<cc>/<id>.txt and /llms/<cc>/categories/<slug>.txt
 *
 * Spec reference: BUY-70312 issue body (Reed, 2026-08-16T04:05Z)
 *
 * Constraints enforced here:
 *   - No API keys / PII / merchant secrets
 *   - Price field: "amount currency" or "<min>-<max> currency"
 *   - Availability: resolved label (local | ships_to_you | unavailable | unknown)
 *   - Brand: empty string when unbranded (never "unknown")
 *   - Human-readable plain text (same convention as site-level llms.txt)
 */

export type ProductAvailability =
  | "local"
  | "ships_to_you"
  | "unavailable"
  | "unknown";

export type LlmsProductSnippetInput = {
  /** ISO-3166-1 alpha-2 country code, lower-case */
  country: string;
  /** Product id — numeric string from the catalog */
  productId: string;
  /** Product title / name */
  title: string;
  /** One-line description, ideally <= 200 chars */
  description?: string | null;
  /** ISO-4217 currency code, upper-case */
  currency: string;
  /** Numeric price. Absent when unavailable / unpriced. */
  price?: number | null;
  /** Min price for multi-merchant snapshots. */
  minPrice?: number | null;
  /** Max price for multi-merchant snapshots. */
  maxPrice?: number | null;
  availability: ProductAvailability;
  /** Brand display name. Pass empty string for unbranded. */
  brand?: string | null;
  /** Top-level category slug */
  category?: string | null;
  /** Primary merchant slug */
  merchantSlug?: string | null;
  /** Primary merchant display name */
  merchantName?: string | null;
  /** Canonical product URL on buywhere.ai */
  url: string;
  /** Primary image URL, if available */
  imageUrl?: string | null;
};

/** Format a price field per the spec */
function formatPrice(
  price: number | null | undefined,
  minPrice: number | null | undefined,
  maxPrice: number | null | undefined,
  currency: string,
): string {
  if (minPrice != null && maxPrice != null && minPrice !== maxPrice) {
    return `${minPrice.toFixed(2)}-${maxPrice.toFixed(2)} ${currency}`;
  }
  if (price != null) {
    return `${price.toFixed(2)} ${currency}`;
  }
  return "";
}

/** Format availability label */
function formatAvailability(availability: ProductAvailability): string {
  return availability;
}

/**
 * Render a per-product llms.txt snippet.
 *
 * Pass either `price` (single merchant) OR `minPrice`+`maxPrice`
 * (multi-merchant snapshot with range).
 */
export function renderProductLlmsSnippet(input: LlmsProductSnippetInput): string {
  const priceStr = formatPrice(
    input.price,
    input.minPrice,
    input.maxPrice,
    input.currency,
  );
  const lines: string[] = [];

  lines.push(`# ${input.title}`);

  if (input.description) {
    const desc =
      input.description.length > 200
        ? input.description.slice(0, 197) + "..."
        : input.description;
    lines.push(`> ${desc}`);
  }

  lines.push("");
  lines.push("## Product");
  lines.push(`name: ${input.title}`);
  lines.push(`id: ${input.productId}`);
  lines.push(`country: ${input.country.toUpperCase()}`);
  lines.push(`currency: ${input.currency}`);
  if (priceStr) lines.push(`price: ${priceStr}`);
  lines.push(`availability: ${formatAvailability(input.availability)}`);
  lines.push(`brand: ${input.brand ?? ""}`);
  lines.push(`category: ${input.category ?? ""}`);
  lines.push(`merchant: ${input.merchantSlug ?? ""}`);
  lines.push(`url: ${input.url}`);
  lines.push(`image: ${input.imageUrl ?? ""}`);

  lines.push("");
  lines.push("## How to fetch via MCP");
  lines.push(`tool: search_products (q=${input.title})`);
  lines.push(`tool: get_product (product_id=${input.productId})`);
  lines.push(`tool: compare_products (ids=${input.productId})`);
  lines.push("endpoint: https://api.buywhere.ai/mcp");

  lines.push("");
  lines.push("## How to fetch via REST");
  lines.push(
    `endpoint: GET https://api.buywhere.ai/v1/products/${input.productId}`,
  );
  lines.push(
    `endpoint: GET https://api.buywhere.ai/v1/products/search?q=${encodeURIComponent(input.title)}&country_code=${input.country.toUpperCase()}`,
  );
  lines.push(
    "auth: Bearer bw_live_<key>  (POST https://api.buywhere.ai/v1/keys)",
  );

  return lines.join("\n");
}

export type LlmsCategorySnippetInput = {
  /** ISO-3166-1 alpha-2 country code, lower-case */
  country: string;
  /** Category slug */
  slug: string;
  /** Display name */
  name: string;
  /** One-line description, ideally <= 200 chars */
  description?: string | null;
  /** Approximate product count in this category+country */
  productCount?: number | null;
  /** Up to 3 sample search queries for this category */
  sampleQueries?: string[];
  /** Canonical category URL on buywhere.ai */
  url: string;
};

/**
 * Render a per-category landing-page llms.txt snippet.
 */
export function renderCategoryLlmsSnippet(input: LlmsCategorySnippetInput): string {
  const lines: string[] = [];

  lines.push(`# ${input.name}`);

  if (input.description) {
    const desc =
      input.description.length > 200
        ? input.description.slice(0, 197) + "..."
        : input.description;
    lines.push(`> ${desc}`);
  }

  lines.push("");
  lines.push("## Category");
  lines.push(`slug: ${input.slug}`);
  lines.push(`country: ${input.country.toUpperCase()}`);
  if (input.productCount != null) {
    lines.push(`products: ${input.productCount.toLocaleString()}`);
  }

  if (input.sampleQueries && input.sampleQueries.length > 0) {
    lines.push("sample_queries:");
    for (const q of input.sampleQueries.slice(0, 3)) {
      lines.push(`  - "${q}"`);
    }
  }

  lines.push("");
  lines.push("## How to fetch via MCP");
  lines.push("tool: list_categories");
  lines.push(
    `tool: search_products (q=<query>, category=${input.slug})`,
  );
  lines.push("endpoint: https://api.buywhere.ai/mcp");

  lines.push("");
  lines.push("## How to fetch via REST");
  lines.push(`endpoint: GET https://api.buywhere.ai/v1/categories/${input.slug}`);
  lines.push(
    `endpoint: GET https://api.buywhere.ai/v1/products/search?category=${input.slug}&country_code=${input.country.toUpperCase()}`,
  );

  return lines.join("\n");
}
