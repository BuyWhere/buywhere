// Merchant ships-to scope map (2026-07-15). Backs the deliver_to `ships_to_you` /
// `unavailable` availability labels. Source: merchant_shipping (filled by the
// droplet enrichment daemon from each store's shipping-policy page). Only explicit
// scopes are loaded (worldwide | domestic) — ~6K entries — so lookups are O(1) and
// absent hosts stay 'unknown'. Refreshes every 6h; failures keep the last good map.
import { db } from '../config';

let scopeByHost = new Map<string, string>();

async function refresh(): Promise<void> {
  try {
    const r = await db.query<{ host: string; scope: string }>(
      "SELECT host, scope FROM merchant_shipping WHERE scope IN ('worldwide','domestic')"
    );
    const m = new Map<string, string>();
    for (const row of r.rows) m.set(row.host, row.scope);
    scopeByHost = m;
    console.log(`[shipsTo] loaded ${m.size} merchant ship scopes`);
  } catch (e) {
    console.warn('[shipsTo] refresh failed (keeping previous map):', (e as Error).message);
  }
}

refresh().catch(() => {});
setInterval(() => { refresh().catch(() => {}); }, 6 * 3600 * 1000).unref();

export function shipScopeForUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || url.length < 8) return undefined;
  const host = url.split('//')[1]?.split('/')[0]?.toLowerCase().replace(/^www\./, '');
  return host ? scopeByHost.get(host) : undefined;
}
