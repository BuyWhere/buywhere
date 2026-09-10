/**
 * Single source of truth for cleaning upstream merchant/source strings before
 * they reach the public UI. BUY-66324: the SEO landing pages feed merchant
 * names from `item.merchant_name || item.merchant || item.source`, and the
 * upstream catalog frequently returns internal identifiers like
 * "SHOPIFY BUY30620 STOCK", "BUY30590 RETAILER BESTBUY", or "Shopify Wellbots
 * Com" — these leak raw database/tenant IDs into product cards, comparison
 * tables, and JSON-LD seller blocks.
 *
 * This module is plain (no React, no Next.js client/server directives) so it
 * can be imported from anywhere: server components, client components, route
 * handlers, and unit tests. `MerchantBadge.tsx` re-uses the same logic to
 * stay consistent with the SEO path.
 */

// Canonical platform roots. When the raw merchant string starts with one of
// these (case-insensitive, underscore- or hyphen-separated), the trailing
// tenant/database suffix is stripped so the badge renders e.g. "Shopify"
// instead of "Shopify Buy30620 Crate".
export const PLATFORM_ROOTS = new Set([
  'shopify',
  'walmart',
  'amazon',
  'target',
  'best buy',
  'costco',
  'home depot',
  'lowes',
  "lowe's",
  'nike',
  'adidas',
  'google shopping',
  'ebay',
  'newegg',
  'apple',
  'dell',
  'lenovo',
  'gamestop',
  'magento',
  'woocommerce',
  'wellbots',
]);

// Tokens that look like internal database/tenant IDs and should be dropped
// when they appear at the start of a merchant string (e.g. "BUY30590 RETAILER
// BESTBUY" -> "BESTBUY"). BUY<digits> is the upstream catalog ingest lane; a
// bare 4+ digit number catches other ingest IDs.
const LEADING_ID_TOKEN = /^(?:buy\d+|\d{4,})$/i;

// Display aliases for retailers that survive the upstream title-case with
// idiosyncratic casing (e.g. "Bestbuy" -> "Best Buy"). Looked up against the
// token list AFTER dropping leading ID tokens and any "Retailer" / "Com"
// filler words.
const MERCHANT_ALIASES: Record<string, string> = {
  bestbuy: 'Best Buy',
  bestbuycom: 'Best Buy',
  lordandtaylorcom: 'Lord and Taylor',
};

// Trailing filler words from upstream merchant strings ("BUY30590 RETAILER
// BESTBUY", "Shopify Wellbots Com"). Dropped AFTER the platform-root check so
// we don't break "google shopping" or "best buy".
const TRAILING_FILLER = new Set(['retailer', 'com', 'store', 'shop']);

// BUY-72907: Trailing ISO country/region suffixes from upstream ingest lane
// (e.g. "Decathlon Sg" -> "Decathlon", "Shopee Sg" -> "Shopee",
// "Lazada My" -> "Lazada"). Stripped AFTER TRAILING_FILLER so we handle both
// "Bestbuy Sg" -> "Bestbuy" and "Bestbuy Sg Retailer" -> "Best Buy".
const REGION_SUFFIXES = new Set([
  // ISO 2-letter country codes (both cases)
  'us', 'sg', 'my', 'ph', 'th', 'id', 'vn',
  'au', 'ca', 'uk', 'gb', 'de', 'fr', 'it', 'es', 'nl', 'be', 'at', 'ch',
  'jp', 'kr', 'cn', 'in', 'br', 'mx', 'ae', 'sa', 'ng', 'za',
  // Common full-word region/country names that appear in merchant strings
  'singapore', 'malaysia', 'philippines', 'thailand', 'indonesia', 'vietnam',
  'australia', 'canada', 'unitedstates', 'unitedkingdom', 'germany', 'france',
  'spain', 'italy', 'netherlands', 'belgium', 'austria', 'switzerland',
  'japan', 'korea', 'china', 'india', 'brazil', 'mexico', 'uae', 'saudi',
  'usa', 'uk', 'sng', // 'sng' from 'shopee_sng'
  'global', 'intl', 'international',
]);

/**
 * Strip internal tenant/database suffixes from a merchant string so the
 * public render shows a clean platform/retailer name. Tolerates input that
 * has already been title-cased or de-underscored by upstream serializers
 * (so the boundary between platform and tenant may be a space rather than
 * an underscore).
 *
 * Examples:
 *   "shopify"                          -> "Shopify"
 *   "shopify_buy30620_crate"           -> "Shopify"
 *   "Shopify Buy30620 Crate"           -> "Shopify" (already-de-underscored)
 *   "shopify_buy30620_hunt2"           -> "Shopify"
 *   "shopify_scrape"                   -> "Shopify"
 *   "Shopify Scrape"                   -> "Shopify"
 *   "SHOPIFY BUY30620 STOCK"           -> "Shopify" (uppercase input)
 *   "BUY30590 RETAILER BESTBUY"        -> "Best Buy"
 *   "Shopify Wellbots Com"             -> "Shopify"
 *   "wellbots_com"                     -> "Wellbots"
 *   "walmart_us"                       -> "Walmart"
 *   "google_shopping"                  -> "Google Shopping" (multi-token platform)
 *   "lordandtaylorcom"                 -> "Lord and Taylor" (alias)
 *   null / undefined / ""               -> ""
 */
export function stripMerchantTenantSuffix(value?: string | null): string {
  if (!value) return '';
  const tokens = value.split(/[\s_-]+/).filter(Boolean);
  if (tokens.length === 0) return value;

  // Drop a leading numeric ingest ID (e.g. "BUY30590" in "BUY30590 RETAILER
  // BESTBUY") so the platform/family token moves into position[0].
  let start = 0;
  while (start < tokens.length && LEADING_ID_TOKEN.test(tokens[start])) {
    start += 1;
  }
  const remaining = tokens.slice(start);
  if (remaining.length === 0) return value;

  // BUY-81838: Strip multi-part TLDs (com.ph, com.sg, co.uk) BEFORE generic artifact
  // stripping so we don't lose "com" before detecting the compound TLD.
  while (
    remaining.length >= 2 &&
    remaining[remaining.length - 2].toLowerCase() === 'com' &&
    REGION_SUFFIXES.has(remaining[remaining.length - 1].toLowerCase())
  ) {
    remaining.pop(); // remove 'com'
    remaining.pop(); // remove the country code
  }
  while (
    remaining.length >= 2 &&
    remaining[remaining.length - 2].toLowerCase() === 'co' &&
    REGION_SUFFIXES.has(remaining[remaining.length - 1].toLowerCase())
  ) {
    remaining.pop(); // remove 'co'
    remaining.pop(); // remove the country code
  }

  // Strip trailing region suffixes AND domain artifacts (www, ph) BEFORE the
  // PLATFORM_ROOTS check so that "shopify_www_datablitz_com_ph" does NOT
  // early-return "Shopify" but instead reaches the cleaning logic and returns "DataBlitz".
  while (
    remaining.length > 1 &&
    (TRAILING_FILLER.has(remaining[remaining.length - 1].toLowerCase()) ||
      remaining[remaining.length - 1].toLowerCase() === 'www' ||
      remaining[remaining.length - 1].toLowerCase() === 'ph')
  ) {
    remaining.pop();
  }
  while (remaining.length > 1 && REGION_SUFFIXES.has(remaining[remaining.length - 1].toLowerCase())) {
    remaining.pop();
  }

  const firstToken = remaining[0].toLowerCase();
  if (PLATFORM_ROOTS.has(firstToken)) {
    // If only the platform root remains after stripping, return it.
    if (remaining.length === 1) {
      return titleCase(remaining[0]);
    }
    // BUY-81838: Platform root was followed by more tokens — check if they look
    // like internal tenant/database IDs or a real merchant name.
    // Internal ID patterns: buy-prefixed digits, digits anywhere, short all-caps, or known internal keywords.
    const afterPlatform = remaining.slice(1);
    const KNOWN_INTERNAL_KEYWORDS = new Set(['crate', 'scrape', 'hunt', 'stock', 'retailer', 'retail', 'ingest']);
    const isInternalId = (tok: string) =>
      /\d/.test(tok) ||
      KNOWN_INTERNAL_KEYWORDS.has(tok.toLowerCase()) ||
      (tok.length <= 5 && tok === tok.toUpperCase() && /^[A-Z]+$/.test(tok));
    const hasRealMerchantName = afterPlatform.some(
      (tok) => !isInternalId(tok) && tok.length > 4,
    );
    if (!hasRealMerchantName) {
      // Tokens look like internal IDs (buy30620, crate, hunt2, scrape) — return just the platform
      return titleCase(remaining[0]);
    }
    // Real merchant name follows the platform root — drop the platform root and strip domain artifacts
    remaining.shift();
    while (
      remaining.length > 0 &&
      (remaining[0].toLowerCase() === 'www' ||
        remaining[0].toLowerCase() === 'shop' ||
        remaining[0].toLowerCase() === 'store' ||
        remaining[0].toLowerCase() === 'm')
    ) {
      remaining.shift();
    }
  }

  // Two-token platforms like "google_shopping" must be preserved when both
  // tokens form a known platform name.
  if (remaining.length >= 2) {
    const twoToken = `${remaining[0].toLowerCase()} ${remaining[1].toLowerCase()}`;
    if (PLATFORM_ROOTS.has(twoToken)) {
      return `${titleCase(remaining[0])} ${titleCase(remaining[1])}`;
    }
  }

  // BUY-81838: Strip leading domain artifacts that appear when merchant names
  // are derived from URLs (e.g. "www.datablitz.com.ph" slugified -> "www_datablitz_com_ph").
  const LEADING_DOMAIN_ARTIFACTS = new Set(['www', 'store', 'shop', 'm', 'ecommerce', 'api', 'cdn']);
  while (
    remaining.length >= 2 &&
    LEADING_DOMAIN_ARTIFACTS.has(remaining[0].toLowerCase())
  ) {
    remaining.shift();
  }

  // "Merchant Direct" is not a store; it is a fallback ingestion channel label.
  // If it is the only surviving merchant string, show the neutral public seller
  // label rather than leaking backend plumbing into the badge.
  if (remaining.length === 2 && remaining.join(' ').toLowerCase() === 'merchant direct') {
    return 'BuyWhere seller';
  }

  const headKey = remaining.join('').toLowerCase();
  if (MERCHANT_ALIASES[headKey]) {
    return MERCHANT_ALIASES[headKey];
  }
  // "Bestbuy" / "Bestbuycom" -> "Best Buy" via single-token alias.
  const headTail = remaining[remaining.length - 1].toLowerCase();
  if (MERCHANT_ALIASES[headTail]) {
    return MERCHANT_ALIASES[headTail];
  }

  return remaining.map(titleCase).join(' ');
}

// Title-case every whitespace-separated word in a token, lowercasing the
// rest. Tolerates already-mixed-case input — handles "SHOPIFY", "bestBuy",
// and "BEST BUY" alike so the public render is always "Shopify" / "Best Buy".
function titleCase(token: string): string {
  return token.replace(/\w+/g, (word) => {
    if (word.length === 1) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}