/**
 * priceRefreshRunner.ts — Long-running scheduler for the nightly price-refresh job (BUY-2274)
 *
 * Runs daily at 03:00 SGT (= 19:00 UTC). Uses a self-rescheduling setTimeout so no
 * external cron package is required. Safe to restart: always computes the delay to
 * the next 03:00 SGT window, never double-fires within the same day.
 *
 * Override schedule via env vars:
 *   REFRESH_HOUR_UTC  (default: 19 — 03:00 SGT)
 *   REFRESH_MIN_UTC   (default: 0)
 *
 * Run manually with `npm run refresh` to execute immediately and exit.
 */

import { db, redis } from '../config';
import { runPriceRefresh } from './priceRefresh';

const HOUR_UTC = parseInt(process.env.REFRESH_HOUR_UTC ?? '19', 10);
const MIN_UTC  = parseInt(process.env.REFRESH_MIN_UTC  ?? '0',  10);

/** Milliseconds until the next HH:MM UTC window. */
function msUntilNext(hourUtc: number, minUtc: number): number {
  const now  = new Date();
  const next = new Date(now);
  next.setUTCHours(hourUtc, minUtc, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function formatDelay(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

async function tick(): Promise<void> {
  console.log('[price-refresh-runner] Job triggered');
  try {
    const summary = await runPriceRefresh();
    console.log(
      `[price-refresh-runner] Completed — ${summary.success_count}/${summary.total_skus} SKUs refreshed`
    );
  } catch (err) {
    console.error('[price-refresh-runner] Unhandled job error:', err);
  }
  schedule();
}

function schedule(): void {
  const delay = msUntilNext(HOUR_UTC, MIN_UTC);
  console.log(
    `[price-refresh-runner] Next run at ${HOUR_UTC.toString().padStart(2, '0')}:${MIN_UTC.toString().padStart(2, '0')} UTC ` +
    `(03:00 SGT) — in ${formatDelay(delay)}`
  );
  setTimeout(tick, delay);
}

async function main(): Promise<void> {
  console.log(
    `[price-refresh-runner] Starting. Schedule: daily ${HOUR_UTC.toString().padStart(2, '0')}:${MIN_UTC.toString().padStart(2, '0')} UTC (03:00 SGT)`
  );

  // Handle graceful shutdown
  const shutdown = async (sig: string) => {
    console.log(`[price-refresh-runner] Received ${sig}, shutting down`);
    await db.end().catch(() => {});
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  schedule();
}

main().catch((err) => {
  console.error('[price-refresh-runner] Fatal startup error:', err);
  process.exit(1);
});
