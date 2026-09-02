import type { Pool, PoolClient } from 'pg';

export interface MerchantMapEntry {
  name: string;
  /** BUY-74732: prefer the persisted `merchants.slug` column over the JS-derived slugify. */
  slug: string;
  /** BUY-74732: merchant-level `scraped_via` fallback for rows whose `products.scraped_via` is null. */
  scraped_via: 'first_party' | 'affiliate' | 'aggregator' | string | null;
}

/**
 * BUY-74689 — single batched PK lookup against `merchants.id`.
 * BUY-74732 — also reads persisted `slug` + `scraped_via` columns.
 *
 * `buildProduct` needs the human-readable storefront name (and a URL-safe kebab-case
 * slug for <MerchantBadge> lookup) so the response carries the real label (BestDenki,
 * Popular, Amazon Sg, …) instead of the platform slug the FE used to format via
 * `formatMerchantName(source)` → "Shopify" / "Shopee SG".
 *
 * One query per request, keyed on the distinct `merchant_id`s in the result page.
 * Empty / null inputs short-circuit (no query). De-dupes while preserving order for
 * stable error paths. Orphan merchant_ids (no row in `merchants`) simply return no
 * entry — `buildProduct` falls back to `merchantName: null`.
 */
export async function lookupMerchantMap(
  pool: Pool | PoolClient,
  merchantIds: ReadonlyArray<string | null | undefined>,
): Promise<Record<string, MerchantMapEntry>> {
  if (!merchantIds || merchantIds.length === 0) return {};
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of merchantIds) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  if (unique.length === 0) return {};

  // BUY-74732: SELECT now reads `slug` + `scraped_via` from the merchants row. Both
  // columns are nullable on legacy schemas — the migration adds them as
  // ADD COLUMN IF NOT EXISTS so the query degrades gracefully. JS-side `slugify`
  // stays as the fallback for the rare row where `slug IS NULL`.
  const rows = await pool
    .query<{ id: string; name: string; slug: string | null; scraped_via: string | null }>(
      'SELECT id, name, slug, scraped_via FROM merchants WHERE id = ANY($1::text[])',
      [unique],
    )
    .then((r) => r.rows)
    .catch((err) => {
      // BUY-74689: a transient lookup failure must NEVER take down the response —
      // the prior behaviour (slug-only) is what the FE has been running on. Log and
      // fall back to an empty map so `merchantName` is null everywhere instead of
      // surfacing a 500.
      console.warn('[merchantLookup] failed, falling back to empty map:', (err as Error)?.message || err);
      return [] as Array<{ id: string; name: string; slug: string | null; scraped_via: string | null }>;
    });

  const out: Record<string, MerchantMapEntry> = {};
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') continue;
    const slug = (typeof row.slug === 'string' && row.slug.trim())
      ? row.slug.trim()
      : slugifyMerchantName(row.name);
    out[row.id] = {
      name: row.name,
      slug,
      scraped_via: (typeof row.scraped_via === 'string' && row.scraped_via.trim())
        ? row.scraped_via.trim()
        : null,
    };
  }
  return out;
}

/** BUY-74689 — URL-safe kebab-case slug for `MerchantBadge` lookup.
 *
 * Strips non-alphanumeric (Unicode-aware enough for names like "日本家電"), collapses
 * runs of `-`, lowercases. Empty / punctuation-only inputs yield an empty string so
 * the caller can choose to emit null.
 */
export function slugifyMerchantName(name: string): string {
  if (typeof name !== 'string') return '';
  // Replace any non-alphanumeric run with a single dash, then trim leading/trailing
  // dashes. `\p{L}\p{N}` covers accented Latin, CJK, etc. — matches what the FE badge
  // expects when it does `MerchantConfig[slug]`.
  const slug = name
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug;
}
