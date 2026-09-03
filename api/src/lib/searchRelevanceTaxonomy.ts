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
// BUY-69727 FIX: metadata->>'category' fallback for the products table (archive
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

// BUY-69727 FIX: Use ILIKE ANY instead of POSIX regex. The live repro leaked
// Seagate Firecuda 520 SSD (cat="Storage") into "gaming laptop" results; ILIKE
// ANY is unambiguous substring containment for categories with spaces.
const STORAGE_CATEGORY_SQL = `(lower(coalesce(sp.category,'')) ILIKE ANY(ARRAY[${STORAGE_CATEGORY_SUBSTRINGS.map(s => `'%${s}%'`).join(',')}]::text[]))`;

// BUY-69727 live-probe: on the products (archive) table the newegg_us feed
// mis-tags `category` as 'home-living'/'groceries' while the JSONB
// metadata->>'category' carries the true value ('Storage'/'Laptops'). The
// metadata value is the feed-sourced ground truth, so it takes precedence —
// coalesce(metadata first), falling back to the column only when absent.
const STORAGE_CATEGORY_SQL_PRODUCTS = `(lower(coalesce(metadata->>'category', category, '')) ILIKE ANY(ARRAY[${STORAGE_CATEGORY_SUBSTRINGS.map(s => `'%${s}%'`).join(',')}]::text[]))`;

// BUY-69727 tier-path helper: search_products has no metadata column, so the
// category-only exclusion cannot see the true category of mis-tagged rows
// (Firecuda: sp.category='home-living'). Callers join `products m ON
// m.id = <sp-alias>.id` over the BOUNDED candidate set (≤200 ranked rows) and
// apply this predicate as a post-join filter — a PK join at that scale is
// cheap, unlike a join inside the 115M-row candidate WHERE clause.
export const STORAGE_CATEGORY_SQL_TIER_JOIN = `(lower(coalesce(m.metadata->>'category', sp.category, '')) ILIKE ANY(ARRAY[${STORAGE_CATEGORY_SUBSTRINGS.map(s => `'%${s}%'`).join(',')}]::text[]))`;

/** True when the tier path needs the metadata join filter for this query. */
export function tierStorageExclusionNeeded(q: string): boolean {
  return deviceStorageExclusionFragment(q) !== '';
}

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

// ─────────────────────────────────────────────────────────────────────────
// BUY-77675: laptop-accessory token list.
//
// QA repro 2026-08-30 captured 72% non-laptop results for q=laptop&country=sg:
// microphones (Boya), IEMs, laptop desks, portable monitors, privacy screens,
// keyboards, screen cleaners. The pre-existing laptopAccessoryPenalty regex
// in routes/products.ts only caught skin/case/bag/stand/etc. — it missed
// every category above.
//
// The SEO landing page regex (LAPTOP_ACCESSORY_RE in
// buywhere-api/src/lib/seo-landing-pages.ts) and the API tier regex
// (laptopAccessoryPenalty in api/src/routes/products.ts) live in different
// build pipelines (Next.js vs. Express) and use different syntax (JS regex
// vs. Postgres ARE regex), so the literal strings CAN'T be shared without
// a workspace refactor. This module exposes the canonical token list so
// both call-sites import the same source of truth — each call-site still
// wraps the tokens in its own regex flavour.
//
// `laptopAccessoryPenalty` in routes/products.ts is the canonical API-side
// penalty expression. When widening the list, update BOTH the SEO regex
// AND the API regex to keep the live page and the public API consistent.
export const LAPTOP_ACCESSORY_SOFT_TOKENS = [
  // Audio (Boya lavalier mics, rockpapa headphones, IEMs)
  'microphone', 'microphones', 'mic', 'lavalier', 'lapel', 'boya',
  'headphone', 'headphones', 'headset', 'earbud', 'earbuds',
  'earphone', 'earphones', 'airpod', 'airpods',
  'in-ear monitor', 'in ear monitor', 'in ear monitors', 'iem', 'iems',
  // Furniture (laptop desks, standing desks, lap desks, bed tables)
  // BUY-80705: side table/end table/console table/coffee table/nightstand are
  // furniture accessories that rank above real laptops — no existing token
  // catches them, so they slip past the SQL penalty entirely. Now added.
  'standing desk', 'lap desk', 'bed desk', 'bed table', 'bed tray',
  'folding table', 'breakfast tray',
  'side table', 'end table', 'console table', 'coffee table', 'nightstand',
  // Display accessories (portable monitors, screen extenders)
  'portable monitor', 'external monitor', 'screen extender',
  'external display', 'travel monitor', 'second screen', 'triple monitor',
  'privacy screen', 'privacy filter',
  // Cleaning (screen cleaners, sprays, wipes)
  'screen cleaner', 'cleaning spray', 'screen wipes', 'cleaning wipes',
  'screen cleaning',
  // Pre-existing tokens from the original regex. Note: bare 'pad'/'pads' is
  // omitted because it matches inside model names like "ThinkPad" and
  // "IdeaPad" — the multi-word forms ('cooling pad', 'mouse pad',
  // 'mousepad') still cover the actual accessory intent without false-
  // positive risk on real laptop model names.
  'skin', 'skins', 'sleeve', 'sleeves', 'cover', 'covers', 'case', 'cases',
  'stand', 'stands', 'cooler', 'coolers', 'bag', 'bags', 'backpack', 'backpacks',
  'sticker', 'stickers', 'decal', 'decals', 'cooling pad',
  'mat', 'mats', 'mouse pad', 'mousepad',
  'adapter', 'adapters', 'dock', 'docks', 'hub', 'hubs', 'lock', 'locks',
  'charger', 'chargers', 'cable', 'cables', 'messenger', 'shell', 'shells',
  'replacement battery', 'replacement batteries', 'replacement keyboard',
  'replacement fan', 'replacement hinge', 'replacement screen',
  // Keyboard when paired with a laptop context. Bare 'keyboard' is omitted
  // because it would match legitimate keyboards sold as laptop bundles or
  // laptop-replacement keyboards; we only penalise laptop-style keyboards
  // when they appear alongside a wireless/bluetooth/foldable signal.
  'wireless keyboard', 'foldable keyboard', 'bluetooth keyboard',
] as const;

// Postgres ARE regex alternation source. Each token is split on whitespace
// (so multi-word phrases like "standing desk" only match when the words
// appear consecutively) and word-bounded with `\m` / `\M`. The token list
// contains no single quotes so the result is safe to interpolate into a
// SQL string literal.
export const LAPTOP_ACCESSORY_PG_RE_SOURCE = LAPTOP_ACCESSORY_SOFT_TOKENS
  .map((t) => {
    const parts = t.split(/\s+/);
    return parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  })
  .map((re) => `\\m(?:${re})\\M`)
  .join('|');
