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

// Query-token families. Membership is by WORD TOKEN presence in the query
// (lowercased, alphanumeric-only), never by intent inference. A query hits a
// family if ANY of its tokens matches ANY token in that family.
// NOTE: matching is STEM-tolerant — a query token like `earbuds` matches the
// family token `earbud` (token startsWith family token), so plurals and
// simple inflections (`monitors`→`monitor`) are covered without enumerating.
export const DEVICE_FAMILY_TOKENS = {
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
} as const;

// Flattened list for stem-tolerant lookup (see tokenMatchesDevice below).
const ALL_DEVICE_TOKENS = Object.values(DEVICE_FAMILY_TOKENS).flat();

// Multiword device phrases the spec names explicitly (`smart watch`,
// `gaming pc`, `fitness tracker`) that do not reduce to a single device
// token. A query containing the phrase (as a substring, word-bounded) counts
// as a device query.
const DEVICE_PHRASES = ['smart watch', 'gaming pc', 'fitness tracker'];

// Storage query tokens — when ANY of these appear as a query token, the
// exclusion MUST NOT fire (the user is shopping for storage). Matches the
// spec's positive-control set: ssd, nvme ssd, portable ssd, 1tb ssd, …
export const STORAGE_QUERY_TOKENS = new Set<string>([
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

// Pre-built SQL regex alternation for the category column. Matches if the
// lowercased category contains any storage substring. NULL/empty categories
// never match → fail-open (the product is kept), per spec.
// BUGFIX BUY-69672: PostgreSQL ~* takes a SINGLE regex string literal, NOT
// SQL string literals joined by |. The old code generated invalid SQL like
// ('storage'|'internal ssd'|...) which caused HTTP 500 on device queries.
const STORAGE_CATEGORY_SQL = `(coalesce(sp.category,'') ~* '${STORAGE_CATEGORY_SUBSTRINGS.join('|')}')`;

const STORAGE_CATEGORY_SQL_PRODUCTS = `(coalesce(category,'') ~* '${STORAGE_CATEGORY_SUBSTRINGS.join('|')}')`;

function normalizeQueryTokens(q: string): Set<string> {
  return new Set(
    q
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean),
  );
}

/** True if the query names a device family token (laptop/phone/tablet/…). */
export function isDeviceQuery(q: string): boolean {
  const tokens = normalizeQueryTokens(q);
  for (const t of tokens) {
    // Stem-tolerant: `earbuds`→`earbud`, `monitors`→`monitor`. A query token
    // matches if it starts with a known family token (length >= the family
    // token) — covers plural/-s inflection without over-matching short stems.
    if (ALL_DEVICE_TOKENS.some((fam) => t.length >= fam.length && t.startsWith(fam))) return true;
  }
  // Multiword device phrases (`smart watch`, `gaming pc`, `fitness tracker`).
  const lowered = q.toLowerCase();
  if (DEVICE_PHRASES.some((p) => new RegExp(`\\b${p}\\b`).test(lowered))) return true;
  return false;
}

/** True if the query itself names a storage product (positive control). */
export function isStorageQuery(q: string): boolean {
  const tokens = normalizeQueryTokens(q);
  for (const t of tokens) {
    if (STORAGE_QUERY_TOKENS.has(t)) return true;
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
export function deviceStorageExclusionFragment(q: string): string {
  if (!q || !q.trim()) return '';
  if (!isDeviceQuery(q)) return '';
  if (isStorageQuery(q)) return '';
  return ` AND NOT ${STORAGE_CATEGORY_SQL}`;
}

/**
 * Same as deviceStorageExclusionFragment but for query scopes that alias the
 * products table as `products` (the archive fallback + semantic filter
 * paths). Kept separate so each path's alias is explicit.
 */
export function deviceStorageExclusionFragmentProducts(q: string): string {
  if (!q || !q.trim()) return '';
  if (!isDeviceQuery(q)) return '';
  if (isStorageQuery(q)) return '';
  return ` AND NOT ${STORAGE_CATEGORY_SQL_PRODUCTS}`;
}
