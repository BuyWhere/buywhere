import { db } from '../config';

// BWEXT minted-ID referential integrity (2026-09-11).
//
// /v1/products (list) serves from products_partitioned_{sg,us} and search serves from
// products_partitioned_{sg,us,au,gb,ca}. Those child tables hold rows that were never
// written to the parent `products` table - measured: 499 of 577 SG child rows with
// snowflake-range ids are absent from `products`. Every id-lookup surface (REST
// GET /v1/products/:id, REST compare, MCP get_product, MCP compare) read ONLY
// `products`, so an id this API had just returned in a listing came back 404 on the
// very next call. Example: 9222976908590151601 "Apple AirPods Pro 3", listed by
// /v1/products, 404 on /v1/products/9222976908590151601.
//
// This resolves ids that are missing from `products` against exactly the child tables
// the list and search paths serve from. Querying the partitioned PARENT instead is not
// an option: `id` is not the partition key, 27 of its 57 children have no id index
// (including _default), and a parent lookup timed out at 30s. All five tables below
// DO have an id-leading index; a direct SG lookup measured 6ms.
//
// Keep this list equal to the union of LIVE_LIST_CHILD_COUNTRIES and
// FAST_CHILD_TABLE_COUNTRIES in routes/products.ts. If a market is added there, add
// its child here AND confirm it has an id index, or lookups against it will seq-scan.
export const LIVE_CHILD_TABLES = [
  'products_partitioned_sg',
  'products_partitioned_us',
  'products_partitioned_au',
  'products_partitioned_gb',
  'products_partitioned_ca',
] as const;

export async function fetchFromLiveChildren(
  selectCols: string,
  ids: Array<string | number>,
): Promise<Record<string, unknown>[]> {
  const clean = ids.map((x) => String(x).trim()).filter((x) => /^\d{1,19}$/.test(x));
  if (clean.length === 0) return [];
  const sql = LIVE_CHILD_TABLES
    .map((t) => `SELECT ${selectCols} FROM ${t} WHERE id = ANY($1::bigint[])`)
    .join('\nUNION ALL\n');
  try {
    const r = await db.query(sql, [clean]);
    const seen = new Set<string>();
    const out: Record<string, unknown>[] = [];
    for (const row of r.rows as Record<string, unknown>[]) {
      const k = String(row.id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
    return out;
  } catch (e) {
    // Never let the fallback break the primary path - but never swallow it silently
    // either. A fail-open catch that logged nothing is exactly how the search tier
    // was dead in production without anyone noticing.
    console.warn('[liveChildLookup] child-table fallback failed:', (e as Error)?.message);
    return [];
  }
}
