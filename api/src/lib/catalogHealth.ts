import { catalogDb } from '../config';

/**
 * Catalog health (2026-09-25, post-outage). Between 2026-09-19 07:00Z and
 * 2026-09-25 15:00Z the catalog Postgres sat in a recovery loop (volume full)
 * while /health, /healthz, /api/health and /api/monitoring/health all kept
 * answering {status:"ok"}: they only prove the Node process is alive. Every
 * monitor that keyed on them reported a healthy site through a six-day
 * customer-visible outage.
 *
 * This module runs one cheap probe on a timer against the catalog pool and
 * caches the verdict. Health handlers read the cache (never the DB) so they
 * stay fast, and the verdict is attached to the liveness surfaces so anyone
 * reading them sees "process ok, catalog down" instead of a bare ok.
 *
 * Probe = `SELECT 1 FROM products LIMIT 1` (proves the catalog answers) plus
 * `SELECT 1 FROM search_products LIMIT 1` (proves the search tier has rows;
 * an empty tier means search falls back to the cold archive: degraded, not
 * down). Both are index/heap point reads; the probe sets its own short
 * statement_timeout so it can never pile up on a wedged database.
 *
 * Env: CATALOG_HEALTH_INTERVAL_MS (default 30000), CATALOG_HEALTH_TIMEOUT_MS
 * (default 5000), CATALOG_HEALTH_DISABLED=1 to turn the probe off (verdict
 * then reads "unknown").
 */

export type CatalogStatus = 'ok' | 'degraded' | 'down' | 'unknown';

export interface CatalogHealth {
  status: CatalogStatus;
  checked_at: string | null;
  latency_ms: number | null;
  tier_present: boolean | null;
  error: string | null;
  consecutive_failures: number;
}

const INTERVAL_MS = parseInt(process.env.CATALOG_HEALTH_INTERVAL_MS || '30000');
const TIMEOUT_MS = parseInt(process.env.CATALOG_HEALTH_TIMEOUT_MS || '5000');
const DISABLED = process.env.CATALOG_HEALTH_DISABLED === '1';

const state: CatalogHealth = {
  status: 'unknown',
  checked_at: null,
  latency_ms: null,
  tier_present: null,
  error: null,
  consecutive_failures: 0,
};

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export function getCatalogHealth(): CatalogHealth {
  return { ...state };
}

/** Overall verdict for a liveness surface: process is up, so only the catalog can lower it. */
export function overallStatus(): 'ok' | 'degraded' | 'down' {
  if (state.status === 'down') return 'down';
  if (state.status === 'degraded') return 'degraded';
  return 'ok';
}

export async function probeCatalogOnce(): Promise<CatalogHealth> {
  if (inFlight) return getCatalogHealth();
  inFlight = true;
  const t0 = Date.now();
  let client;
  try {
    client = await catalogDb.connect();
    await client.query(`SET statement_timeout = ${TIMEOUT_MS}`);
    await client.query('SELECT 1 FROM products LIMIT 1');
    const tier = await client.query('SELECT 1 FROM search_products LIMIT 1');
    const tierPresent = (tier.rowCount ?? 0) > 0;
    state.status = tierPresent ? 'ok' : 'degraded';
    state.tier_present = tierPresent;
    state.error = tierPresent ? null : 'search_products tier is empty; search serving from cold archive';
    state.consecutive_failures = 0;
  } catch (err: unknown) {
    state.status = 'down';
    state.tier_present = null;
    state.error = (err as Error).message || String(err);
    state.consecutive_failures += 1;
  } finally {
    state.latency_ms = Date.now() - t0;
    state.checked_at = new Date().toISOString();
    if (client) {
      try {
        client.release();
      } catch {
        /* pool already torn down */
      }
    }
    inFlight = false;
  }
  return getCatalogHealth();
}

export function startCatalogHealthProbe(): void {
  if (DISABLED || timer) return;
  void probeCatalogOnce();
  timer = setInterval(() => {
    void probeCatalogOnce();
  }, INTERVAL_MS);
  timer.unref();
}

export function stopCatalogHealthProbe(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
