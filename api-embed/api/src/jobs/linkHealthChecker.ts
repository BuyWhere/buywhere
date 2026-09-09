/**
 * linkHealthChecker.ts — Scheduled job to probe outbound redirect destinations
 *
 * BUY-63045: Product-card deal redirects can land on merchant error pages (503).
 * This job periodically probes destination URLs from affiliate_links and products,
 * records the HTTP status in the link_health table, and flags dead links so the
 * redirect route can suppress them before the user hits an error page.
 *
 * Config:
 *   LINK_HEALTH_BATCH_SIZE   — URLs per cycle (default 50)
 *   LINK_HEALTH_INTERVAL_MS  — run interval (default 30 min)
 *   LINK_HEALTH_TIMEOUT_MS   — per-URL timeout (default 8s)
 */

import { db } from '../config';
import { markDeadUrl, clearDeadUrl } from '../lib/response';

const BATCH_SIZE = parseInt(process.env.LINK_HEALTH_BATCH_SIZE || '50', 10);
const INTERVAL_MS = parseInt(process.env.LINK_HEALTH_INTERVAL_MS || String(30 * 60 * 1000), 10);
const TIMEOUT_MS = parseInt(process.env.LINK_HEALTH_TIMEOUT_MS || '8000', 10);

const DEAD_STATUS_CODES = new Set([404, 410, 500, 502, 503, 521, 522, 523, 525, 530]);

let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function probeUrl(url: string): Promise<{ httpStatus: number | null; isAlive: boolean; errorMessage: string | null }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'BuyWhere-LinkHealth/1.0' },
      });
      clearTimeout(timeout);
      const status = resp.status;
      const isAlive = status >= 200 && status < 400 && !DEAD_STATUS_CODES.has(status);
      return { httpStatus: status, isAlive, errorMessage: isAlive ? null : `HTTP ${status}` };
    } catch (err: any) {
      clearTimeout(timeout);
      // HEAD may not be supported — try GET as fallback
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        return { httpStatus: null, isAlive: false, errorMessage: 'timeout' };
      }
      if (err?.cause?.code === 'ENOTFOUND' || err?.cause?.code === 'ECONNREFUSED') {
        return { httpStatus: null, isAlive: false, errorMessage: err.cause.code };
      }
      // HEAD rejected — try GET
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), TIMEOUT_MS);
      try {
        const resp2 = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller2.signal,
          headers: { 'User-Agent': 'BuyWhere-LinkHealth/1.0' },
        });
        clearTimeout(timeout2);
        // Consume body to close connection
        await resp2.text().catch(() => {});
        const status = resp2.status;
        const isAlive = status >= 200 && status < 400 && !DEAD_STATUS_CODES.has(status);
        return { httpStatus: status, isAlive, errorMessage: isAlive ? null : `HTTP ${status}` };
      } catch (err2: any) {
        clearTimeout(timeout2);
        return { httpStatus: null, isAlive: false, errorMessage: err2?.message || 'fetch_failed' };
      }
    }
  } catch (err: any) {
    return { httpStatus: null, isAlive: false, errorMessage: err?.message || 'unknown' };
  }
}

async function runCheck(): Promise<void> {
  // Gather unprobed or stale destination URLs from affiliate_links + products
  // (checked > 24h ago or never checked)
  const { rows: staleUrls } = await db.query(`
    WITH urls AS (
      SELECT DISTINCT destination_url AS url
        FROM affiliate_links
      UNION
      SELECT DISTINCT url AS url
        FROM products
        WHERE url IS NOT NULL AND url <> ''
    )
    SELECT u.url
    FROM urls u
    LEFT JOIN link_health lh ON lh.destination_url = u.url
    WHERE lh.id IS NULL
       OR lh.checked_at < NOW() - INTERVAL '24 hours'
    ORDER BY lh.checked_at NULLS FIRST
    LIMIT $1
  `, [BATCH_SIZE]);

  if (staleUrls.length === 0) {
    console.log('[link-health] No URLs need probing this cycle.');
    return;
  }

  console.log(`[link-health] Probing ${staleUrls.length} destination URLs...`);

  let alive = 0;
  let dead = 0;

  for (const { url } of staleUrls) {
    const result = await probeUrl(url);

    await db.query(`
      INSERT INTO link_health (destination_url, http_status, is_alive, error_message, checked_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (destination_url) DO UPDATE SET
        http_status   = EXCLUDED.http_status,
        is_alive      = EXCLUDED.is_alive,
        error_message = EXCLUDED.error_message,
        checked_at    = NOW()
    `, [url, result.httpStatus, result.isAlive, result.errorMessage]);

    // Update in-memory dead URL cache for search-result filtering
    if (result.isAlive) {
      clearDeadUrl(url);
      alive++;
    } else {
      markDeadUrl(url);
      dead++;
    }
  }

  console.log(`[link-health] Cycle complete: ${alive} alive, ${dead} dead (of ${staleUrls.length} probed).`);
}

async function tick(): Promise<void> {
  if (running) {
    console.log('[link-health] Previous run still in progress, skipping.');
    schedule();
    return;
  }
  running = true;
  try {
    await runCheck();
  } catch (err: any) {
    console.error(`[link-health] Run failed: ${err?.message || err}`);
  } finally {
    running = false;
  }
  schedule();
}

function schedule(): void {
  const nextMin = Math.round(INTERVAL_MS / 60000);
  console.log(`[link-health] Next run in ${nextMin} minutes.`);
  timer = setTimeout(tick, INTERVAL_MS);
  if (timer.unref) timer.unref();
}

/**
 * Load known-dead URLs from link_health into the in-memory cache on startup.
 */
async function warmupDeadCache(): Promise<void> {
  try {
    const { rows } = await db.query(
      `SELECT destination_url FROM link_health
        WHERE is_alive = false
          AND checked_at > NOW() - INTERVAL '24 hours'`
    );
    for (const { destination_url } of rows) {
      markDeadUrl(destination_url);
    }
    if (rows.length > 0) {
      console.log(`[link-health] Warmed dead URL cache with ${rows.length} entries.`);
    }
  } catch (err: any) {
    console.warn(`[link-health] Cache warmup failed (non-fatal): ${err?.message}`);
  }
}

/**
 * Start the link-health checker. Called from index.ts on startup.
 */
export async function startLinkHealthChecker(): Promise<void> {
  console.log(`[link-health] Starting (batch=${BATCH_SIZE}, interval=${Math.round(INTERVAL_MS / 60000)}m)`);
  // Warm the dead URL cache before the first probe cycle
  await warmupDeadCache();
  // First run after a short delay so the DB pool is warm
  const initialDelay = setTimeout(tick, 15_000);
  if (initialDelay.unref) initialDelay.unref();
}

/**
 * Stop the link-health checker (for graceful shutdown).
 */
export function stopLinkHealthChecker(): void {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
}
