"use strict";
// BUY-69621: search-relevance taxonomy for the device-vs-storage exclusion.
//
// QA (BUY-69616) flagged that a device-typed query like `gaming laptop` can
// surface a Storage/SSD product (e.g. Seagate Firecuda 520) high in the
// ranking because the storage listing happens to share many lexemes with
// laptop descriptions. This module centralizes the two pieces of knowledge
// needed to drop those candidates as a HARD filter:
//
//   1. Is the QUERY targeting a device family? (token intersection)
//   2. Is the QUERY itself naming a storage product? (positive control —
//      `ssd`, `1tb ssd`, … must NOT be filtered).
//
// The actual SQL fragment is produced by `deviceStorageExclusionFragment`,
// which returns '' (no-op, fail-open) unless the query is a device query
// that does NOT also name storage. The fragment is a self-contained literal
// (no bind params) so it can be concatenated into any candidate WHERE clause
// exactly like the existing laptop-accessory penalty expressions.
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORAGE_QUERY_TOKENS = exports.DEVICE_FAMILY_TOKENS = void 0;
exports.isDeviceQuery = isDeviceQuery;
exports.isStorageQuery = isStorageQuery;
exports.deviceStorageExclusionFragment = deviceStorageExclusionFragment;
exports.deviceStorageExclusionFragmentProducts = deviceStorageExclusionFragmentProducts;
// Query-token families. Membership is by WORD TOKEN presence in the query
// (lowercased, alphanumeric-only), never by intent inference. A query hits a
// family if ANY of its tokens matches ANY token in that family.
// NOTE: matching is STEM-tolerant — a query token like `earbuds` matches the
// family token `earbud` (token startsWith family token), so plurals and
// simple inflections (`monitors`→`monitor`) are covered without enumerating.
exports.DEVICE_FAMILY_TOKENS = {
    laptop: ['laptop', 'notebook', 'macbook', 'chromebook'],
    desktop: ['desktop', 'pc', 'tower', 'workstation'],
    phone: ['phone', 'iphone', 'android', 'smartphone', 'pixel'],
    tablet: ['tablet', 'ipad'],
    console: ['playstation', 'xbox', 'nintendo', 'console'],
    wearable: ['earbud', 'headphone', 'airpod', 'smartwatch', 'fitness'],
    // display family: the device-query set (gate 2) names `gaming monitor`, so a
    // monitor is a device-typed target for the storage exclusion. Monitors are
    // distinct from storage even though both are "computer components".
    display: ['monitor'],
};
// Flattened list for stem-tolerant lookup (see tokenMatchesDevice below).
const ALL_DEVICE_TOKENS = Object.values(exports.DEVICE_FAMILY_TOKENS).flat();
// Multiword device phrases the spec names explicitly (`smart watch`,
// `gaming pc`, `fitness tracker`) that do not reduce to a single device
// token. A query containing the phrase (as a substring, word-bounded) counts
// as a device query.
const DEVICE_PHRASES = ['smart watch', 'gaming pc', 'fitness tracker'];
// Storage query tokens — when ANY of these appear as a query token, the
// exclusion MUST NOT fire (the user is shopping for storage). Matches the
// spec's positive-control set: ssd, nvme ssd, portable ssd, 1tb ssd, …
exports.STORAGE_QUERY_TOKENS = new Set([
    'ssd',
    'hdd',
    'nvme',
    'storage', // bare "storage" queries; harmless if it also means general storage
    'hard', // "hard drive"
    'drive', // "storage drive", "portable drive"
]);
// Storage CATEGORY set (case-insensitive substring). Applied to the stored
// `category` column ONLY — never to title tokens, so a laptop whose title
// mentions "1TB SSD" stays eligible. Substring match (not word-boundary)
// because stored categories are inconsistent ("Internal SSD", "Solid State
// Drives", "Computer Components & Storage", …) and the spec allows substring.
//
// BUY-69727 FIX: Switched from ~* POSIX-regex to ILIKE ANY after confirmed
// live leak: Firecuda 520 SSD (cat="Storage") ranked #2 for "gaming laptop".
// Root cause: ~* with space-containing ERE alternations ('storage|internal ssd|…')
// can silently under-match on live catalog data. ILIKE ANY(ARRAY[...]) is
// unambiguous for substring containment and bypasses all regex ambiguity.
//
// FAIL-OPEN contract: NULL/empty category never matches → product is kept.
// BUY-69727 FIX: added metadata->>'category' fallback for the products table (archive
// path), where some products have NULL category but store it in the JSONB metadata column.
const STORAGE_CATEGORY_SUBSTRINGS = [
    'storage',
    'internal ssd',
    'solid state drive',
    'solid state',
    'hard drive',
    'nvme ssd',
    'external ssd',
    'internal drive',
    'usb drive',
    'memory card',
];
// ILIKE ANY — unambiguous, no regex parsing issues with spaces.
// Category-only match (NEVER title): laptop titles routinely contain "1TB SSD"
// ("GIGABYTE GAMING A16 ... 1TB SSD with 16GB DDR5 RAM"), so a title ILIKE
// '%ssd%' would hard-exclude real laptops from "gaming laptop" and destroy the
// acceptance criteria. The exclusion must rely on the CATEGORY truth source.
const STORAGE_CATEGORY_MATCH = `(lower(coalesce(sp.category,'')) ILIKE ANY(ARRAY[${STORAGE_CATEGORY_SUBSTRINGS.map(s => `'%${s}%'`).join(',')}]::text[]))`;
// BUY-69753: check category and metadata->>'category' INDEPENDENTLY (OR), never
// coalesce. The shipped BUY-69727 form `coalesce(category, metadata->>'category','')`
// returns 'home-living' for Firecuda because category is NON-NULL — the metadata
// fallback ('Storage') never fires and the row leaks through both paths. Same for
// the EXISTS lookup from the tier table below.
const STORAGE_CATEGORY_MATCH_PRODUCTS = `((lower(coalesce(p.category,'')) ILIKE ANY(ARRAY[${STORAGE_CATEGORY_SUBSTRINGS.map(s => `'%${s}%'`).join(',')}]::text[])) OR (lower(coalesce(p.metadata->>'category','')) ILIKE ANY(ARRAY[${STORAGE_CATEGORY_SUBSTRINGS.map(s => `'%${s}%'`).join(',')}]::text[])))`;
// BUY-69753: search_products has no metadata column, while live response/category
// truth comes from products.metadata->>'category' for rows like Firecuda 520
// (search_products.category='home-living', products.metadata.category='Storage').
// Use an id-keyed EXISTS fallback to the products table so the tier path filters
// against the same category truth source the API exposes, without title matching.
const STORAGE_CATEGORY_SQL = `(${STORAGE_CATEGORY_MATCH} OR EXISTS (SELECT 1 FROM products p WHERE p.id = sp.id AND ${STORAGE_CATEGORY_MATCH_PRODUCTS}))`;
const STORAGE_CATEGORY_SQL_PRODUCTS = `((lower(coalesce(category,'')) ILIKE ANY(ARRAY[${STORAGE_CATEGORY_SUBSTRINGS.map(s => `'%${s}%'`).join(',')}]::text[])) OR (lower(coalesce(metadata->>'category','')) ILIKE ANY(ARRAY[${STORAGE_CATEGORY_SUBSTRINGS.map(s => `'%${s}%'`).join(',')}]::text[])))`;
function normalizeQueryTokens(q) {
    return new Set(q
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter(Boolean));
}
/** True if the query names a device family token (laptop/phone/tablet/…). */
function isDeviceQuery(q) {
    const tokens = normalizeQueryTokens(q);
    for (const t of tokens) {
        // Stem-tolerant: `earbuds`→`earbud`, `monitors`→`monitor`. A query token
        // matches if it starts with a known family token (length >= the family
        // token) — covers plural/-s inflection without over-matching short stems.
        if (ALL_DEVICE_TOKENS.some((fam) => t.length >= fam.length && t.startsWith(fam)))
            return true;
    }
    // Multiword device phrases (`smart watch`, `gaming pc`, `fitness tracker`).
    const lowered = q.toLowerCase();
    if (DEVICE_PHRASES.some((p) => new RegExp(`\\b${p}\\b`).test(lowered)))
        return true;
    return false;
}
/** True if the query itself names a storage product (positive control). */
function isStorageQuery(q) {
    const tokens = normalizeQueryTokens(q);
    for (const t of tokens) {
        if (exports.STORAGE_QUERY_TOKENS.has(t))
            return true;
    }
    return false;
}
/**
 * Returns a SQL `AND (...)` fragment that HARD-excludes storage-category
 * products from the candidate set, using the `sp.` table alias (the alias
 * used by the search_products tier path). Returns '' when the exclusion
 * should NOT fire:
 *   - query is not a device query (no device token), OR
 *   - query itself names storage (positive control — keep SSDs), OR
 *   - q is empty.
 *
 * The fragment is fail-open: a NULL/missing category never matches the
 * storage regex, so untagged products are always kept.
 */
function deviceStorageExclusionFragment(q) {
    if (!q || !q.trim())
        return '';
    if (!isDeviceQuery(q))
        return '';
    if (isStorageQuery(q))
        return '';
    return ` AND NOT ${STORAGE_CATEGORY_SQL}`;
}
/**
 * Same as deviceStorageExclusionFragment but for query scopes that alias the
 * products table as `products` (the archive fallback + semantic filter
 * paths). Kept separate so each path's alias is explicit.
 */
function deviceStorageExclusionFragmentProducts(q) {
    if (!q || !q.trim())
        return '';
    if (!isDeviceQuery(q))
        return '';
    if (isStorageQuery(q))
        return '';
    return ` AND NOT ${STORAGE_CATEGORY_SQL_PRODUCTS}`;
}
