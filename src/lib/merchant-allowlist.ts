/**
 * BUY-73640 / BUY-73322-FIX: hard country-specific merchant allowlist for SEO
 * landing pages.
 *
 * The /v1/products/search backend ships a bare merchant slug on each item
 * (`"newegg_us"`, `"compumarts"`, …) — NOT an object with region/countryCode.
 * The previous filter only fired on the country-agnostic region field, so
 * non-US merchants whose region was undefined slipped through into the US
 * catalog snapshot (the CompuMarts leak that motivated BUY-73322 / BUY-73640).
 *
 * The slug→countries map below is the single source of truth. Pages whose
 * `config.country` is "US" / "SG" filter the live product array against
 * `getAllowedMerchantSlugs("US")` / `("SG")` BEFORE rendering product cards
 * AND before building the LD+JSON ItemList (so search engines see the same
 * retailers shoppers do). Products with no merchant metadata at all are
 * excluded from country-specific SEO pages — never display an unidentifiable
 * merchant in a geo-targeted listing.
 *
 * Conservative: the spec lists known-good US storefronts (Amazon US, Best Buy,
 * Newegg, Walmart, Target, B&H Photo, Adorama, Home Depot, Lowe's, plus the
 * major OEM stores) and the known SG storefronts (Shopee, Lazada, Amazon SG,
 * Carousell, Challenger, Harvey Norman SG, Courts, Gain City, Apple SG,
 * Samsung SG, etc.). The allowlist expands only when a new storefront is
 * confirmed US- or SG-bound.
 */

export type CountryCode = "US" | "SG";

// BUY-73640: every US storefront slug known to ship in the catalog. The slug
// field is the raw upstream merchant id (`newegg_us`, `walmart_us`, …) that
// search returns, so the allowlist matches against that exact string. Adding
// a new retailer: append the slug, then add it to the SEO landing page's
// fallback editorial list only after the merchant ships in production data.
const US_MERCHANT_SLUGS: ReadonlySet<string> = new Set([
  // Mega-retailers
  "amazon_us",
  "amazon",
  "walmart_us",
  "walmart",
  "target_us",
  "target",
  "bestbuy_us",
  "bestbuy",
  "best_buy",
  "newegg_us",
  "newegg",
  "bhphoto_us",
  "bhphoto",
  "b_and_h",
  "adorama_us",
  "adorama",
  "homedepot_us",
  "homedepot",
  "lowes_us",
  "lowes",
  // OEM direct stores
  "asus_us",
  "asus",
  "dell_us",
  "dell",
  "lenovo_us",
  "lenovo",
  "hp_us",
  "hp",
  "acer_us",
  "acer",
  "msi_us",
  "msi",
  "razer_us",
  "razer",
  "alienware_us",
  "alienware",
  "samsung_us",
  "samsung",
  "lg_us",
  "lg",
  "sony_us",
  "sony",
  "nvidia_us",
  "nvidia",
  "amd_us",
  "amd",
  "intel_us",
  "intel",
  "microsoft_us",
  "microsoft",
  "apple_us",
  "apple",
  "google_us",
  "google_store",
  "google",
  "bose_us",
  "bose",
  "logitech_us",
  "logitech",
  "corsair_us",
  "corsair",
  "steelseries_us",
  "steelseries",
  "hyperx_us",
  "hyperx",
  "tcl_us",
  "tcl",
  "vizio_us",
  "vizio",
  "hisense_us",
  "hisense",
]);

// BUY-73640: confirmed SG storefront slugs. SG landing pages must surface
// local retailers; this set is intentionally SG-only (Shopee / Lazada /
// Carousell / Courts / Harvey Norman / Apple SG / Samsung SG / etc.). Pages
// for additional geos (MY / PH / TH / ID / VN / IN / JP / KR) will need their
// own allowlist once we add pages for them.
const SG_MERCHANT_SLUGS: ReadonlySet<string> = new Set([
  "shopee_sg",
  "shopee",
  "lazada_sg",
  "lazada",
  "amazon_sg",
  "carousell_sg",
  "carousell",
  "challenger_sg",
  "challenger",
  "harvey_norman_sg",
  "harvey_norman",
  "courts_sg",
  "courts",
  "gain_city_sg",
  "gain_city",
  "apple_sg",
  "apple",
  "samsung_sg",
  "samsung",
  "sony_sg",
  "sony",
  "dyson_sg",
  "dyson",
  "philips_sg",
  "philips",
  "xiaomi_sg",
  "xiaomi",
  "asus_sg",
  "asus",
  "lenovo_sg",
  "lenovo",
  "hp_sg",
  "hp",
  "msi_sg",
  "msi",
  "logitech_sg",
  "logitech",
  "bose_sg",
  "bose",
  "lg_sg",
  "lg",
  "best_denki_sg",
  "best_denki",
  "sim_lim_square_sg",
  "funan_sg",
  "mustafa_sg",
  "takashimaya_sg",
]);

const MERCHANT_ALLOWLISTS: Record<CountryCode, ReadonlySet<string>> = {
  US: US_MERCHANT_SLUGS,
  SG: SG_MERCHANT_SLUGS,
};

/**
 * Return the set of merchant slugs permitted on a geo-targeted SEO landing
 * page. The result is a fresh Set so callers can mutate it freely (the source
 * set is shared across calls).
 */
export function getAllowedMerchantSlugs(country: CountryCode): Set<string> {
  return new Set(MERCHANT_ALLOWLISTS[country] ?? []);
}

/**
 * Resolve the upstream merchant field on a search API row to a comparable
 * slug string. The catalog sometimes returns the slug on `item.merchant`
 * ("newegg_us"), and sometimes on `item.source` ("newegg_us"). Prefer the
 * lowercased, trimmed slug.
 */
export function resolveMerchantSlug(item: { merchant?: string | null; source?: string | null }): string | null {
  const raw = item.merchant || item.source;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * True when the slug is on the page's allowlist. Products with no merchant
 * metadata at all are excluded from country-specific SEO pages.
 */
export function isMerchantAllowedForCountry(
  item: { merchant?: string | null; source?: string | null },
  country: CountryCode,
): boolean {
  const slug = resolveMerchantSlug(item);
  if (!slug) return false;
  const allowlist = MERCHANT_ALLOWLISTS[country];
  if (!allowlist) return false;
  // Exact match first (fast path).
  if (allowlist.has(slug)) return true;
  // BUY-75412: prefix match — catalog merchant slugs carry provider suffixes
  // appended after the base merchant ID (e.g. "apple_sg_buy_xml" vs
  // "apple_sg" in the allowlist). Match if any allowlisted slug is a prefix
  // of the actual slug, followed by "_" or end-of-string, so "apple_sg"
  // matches "apple_sg_buy_xml" but does NOT match "apples_sg".
  for (const allowed of allowlist) {
    if (slug.startsWith(allowed) && (slug.length === allowed.length || slug[allowed.length] === "_")) {
      return true;
    }
  }
  return false;
}

/**
 * Strip non-allowlisted products from a LandingProduct[] before they reach
 * the renderer / JSON-LD builder. Also filters out products whose merchant
 * slug is missing entirely — see spec point 3 (no identifiable merchant, no
 * render).
 *
 * The fallback array (curated editorial picks) is filtered too: those
 * products carry an opaque merchant label like "Dyson Singapore" with no raw
 * slug, so they are retained when their merchant label clearly maps to an
 * allowed brand for the page's country. The set of trusted merchant labels
 * per country lives next to the slug allowlist so the curated list stays in
 * sync.
 */
const US_ALLOWED_MERCHANT_LABELS: ReadonlySet<string> = new Set([
  "amazon",
  "amazon us",
  "walmart",
  "walmart us",
  "target",
  "target us",
  "best buy",
  "bestbuy",
  "best buy us",
  "newegg",
  "newegg us",
  "b&h photo",
  "b&h",
  "bh photo",
  "adorama",
  "homedepot",
  "home depot",
  "lowe's",
  "lowes",
  "asus",
  "dell",
  "lenovo",
  "hp",
  "acer",
  "msi",
  "razer",
  "alienware",
  "samsung",
  "lg",
  "sony",
  "nvidia",
  "amd",
  "intel",
  "microsoft",
  "apple",
  "google store",
  "bose",
  "logitech",
  "corsair",
  "steelseries",
  "hyperx",
  "tcl",
  "vizio",
  "hisense",
]);

const SG_ALLOWED_MERCHANT_LABELS: ReadonlySet<string> = new Set([
  "shopee",
  "lazada",
  "amazon",
  "carousell",
  "challenger",
  "harvey norman",
  "courts",
  "gain city",
  "apple",
  "samsung",
  "sony",
  "dyson",
  "philips",
  "xiaomi",
  "asus",
  "lenovo",
  "hp",
  "msi",
  "logitech",
  "bose",
  "lg",
  "best denki",
]);

const MERCHANT_LABEL_ALLOWLISTS: Record<CountryCode, ReadonlySet<string>> = {
  US: US_ALLOWED_MERCHANT_LABELS,
  SG: SG_ALLOWED_MERCHANT_LABELS,
};

function labelMatchesCountry(label: string, country: CountryCode): boolean {
  const normalized = label.toLowerCase().trim();
  if (!normalized) return false;
  const set = MERCHANT_LABEL_ALLOWLISTS[country];
  if (set.has(normalized)) return true;
  // Soft match: drop trailing region/business-type suffixes so compound labels
  // like "Apple Store", "ASUS Singapore", "Dyson Singapore", "Best Buy US"
  // normalize to the bare retailer name that lives in the allowlist.
  const noRegion = normalized
    .replace(/\b(us|usa|united states|uk|eu|global|singapore|sg)\b/g, "")
    // "Store", "Mall", "Official Store", "Flagship Store" after region strip
    .replace(/\b(store|mall|official\s*store|flagship\s*store)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return set.has(noRegion);
}

export interface CountryFilterableProduct {
  merchant?: string | null;
}

/**
 * Filter a normalized LandingProduct[] against the country allowlist. The
 * function intentionally inspects the rendered merchant label (`p.merchant`),
 * because by the time products reach the renderer the raw slug has been
 * scrubbed by `stripMerchantTenantSuffix`. Labels that don't resolve to an
 * allowed retailer (or that are missing entirely) are dropped.
 */
export function filterProductsForCountry<T extends CountryFilterableProduct>(
  products: T[],
  country: CountryCode,
): T[] {
  const allowedLabels = MERCHANT_LABEL_ALLOWLISTS[country];
  if (!allowedLabels) return products;
  return products.filter((p) => {
    if (!p.merchant) return false;
    return labelMatchesCountry(p.merchant, country);
  });
}

/**
 * Filter raw search API items BEFORE normalization so non-US retailers never
 * reach the live card set at all. Pair this with `filterProductsForCountry`
 * for the curated fallback list.
 */
export function filterApiItemsForCountry<T extends { merchant?: string | null; source?: string | null }>(
  items: T[],
  country: CountryCode,
): T[] {
  const allowlist = MERCHANT_ALLOWLISTS[country];
  if (!allowlist) return items;
  return items.filter((item) => {
    const slug = resolveMerchantSlug(item);
    if (!slug) return false; // unknown merchant → exclude
    return allowlist.has(slug);
  });
}

// BUY-73741: hard text denylist. Even with the slug + label allowlists above,
// a row can still render CompuMarts / Arabic / namshi / mumzworld / noon /
// sharafdg / carrefour text on a US SEO page if:
//
//   1. the upstream `merchant_name` carries the Arabic script or branded
//      variant slug ("سوق الكمبيوتر") rather than the bare slug,
//   2. a curated fallback row was edited with a non-US merchant label,
//   3. the JSON-LD seller block is built from a different list than the
//      product cards.
//
// This regex set catches every leaked form observed in QA captures
// (vidmee://asset/vidmee_ss_e1a5b9d7dd166dd52b3c0866) regardless of
// casing or whitespace. The function returns true if the label contains
// any disallowed merchant text. Callers must drop the product entirely —
// rewriting the label to a generic placeholder would still leak the
// disallowed merchant to QA via the breadcrumb / merchant badge / "Buy at"
// button copy.
export const DISALLOWED_MERCHANT_TEXT_PATTERNS: readonly RegExp[] = [
  /compumart/i,
  /سوق/,           // "سوق الكمبيوتر" (Arabic "سوق" = "market")
  /\bnamshi\b/i,
  /\bmumzworld\b/i,
  /\bnoon\b/i,
  /\bsharaf(?:\s*dg)?\b/i,
  /\bcarrefour\b/i,
];

export function containsDisallowedMerchantText(label: string | null | undefined): boolean {
  if (!label) return false;
  return DISALLOWED_MERCHANT_TEXT_PATTERNS.some((re) => re.test(label));
}