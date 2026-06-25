/**
 * fxRefreshRunner.ts — 6-hour scheduler for the FX rate refresh job (BUY-54078)
 *
 * Runs every 6 hours via in-process recursion. Safe to restart: if already
 * started, additional calls are ignored. Observability backup mode runs in
 * stand-alone process via `main()`.
 *
 * Override interval via env var:
 *   FX_REFRESH_INTERVAL_MS  (default: 6 * 60 * 60 * 1000 = 6 hours)
 *
 * Run manually with `npm run fx-refresh` to execute immediately and continue on
 * the in-process schedule, or start the stand-alone runner directly.
 */

import { db, redis } from '../config';
import { runFxRefresh } from './fxRefresh';

const INTERVAL_MS = parseInt(process.env.FX_REFRESH_INTERVAL_MS ?? (6 * 60 * 60 * 1000).toString(), 10);
const DEFAULT_INITIAL_DELAY_MS = 10_000;

let schedulerStarted = false;
let inFlight = false;
let keepAlive = false;
let timer: NodeJS.Timeout | null = null;

function formatDelay(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

async function tick(): Promise<void> {
  if (inFlight) {
    console.log('[fx-refresh-runner] Previous run still in progress, skipping tick');
    scheduleNext();
    return;
  }

  inFlight = true;
  console.log('[fx-refresh-runner] Job triggered');
  try {
    const result = await runFxRefresh();
    // Refresh the in-memory cache so buildProduct uses fresh rates
    const { loadFxRates } = await import('../lib/fxRatesLoader');
    await loadFxRates();
    console.log(
      `[fx-refresh-runner] Completed in ${result.durationMs}ms — ` +
      `${result.ratesUpserted} rates upserted from [${result.sources.join(', ')}]` +
      (result.errors.length > 0 ? `, ${result.errors.length} errors: ${result.errors.join('; ')}` : '')
    );
  } catch (err) {
    console.error('[fx-refresh-runner] Unhandled job error:', err);
  } finally {
    inFlight = false;
    if (schedulerStarted) {
      scheduleNext();
    }
  }
}

function scheduleNext(): void {
  if (!schedulerStarted) {
    return;
  }

  console.log(
    `[fx-refresh-runner] Next run in ${formatDelay(INTERVAL_MS)} ` +
    `(interval: ${formatDelay(INTERVAL_MS)})`
  );
  const next = setTimeout(() => {
    void tick();
  }, INTERVAL_MS);

  if (next.unref && !keepAlive) {
    next.unref();
  }

  timer = next;
}

export type FxRefreshSchedulerMode = {
  keepAlive?: boolean;
  initialDelayMs?: number;
};

/** Start in-process FX refresh scheduling. */
export function startFxRefreshScheduler(options: FxRefreshSchedulerMode = {}): void {
  if (schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  keepAlive = options.keepAlive ?? false;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;

  console.log(
    `[fx-refresh-runner] Starting (interval ${formatDelay(INTERVAL_MS)}, ` +
    `initial delay ${formatDelay(initialDelayMs)})`
  );

  const first = setTimeout(() => {
    void tick();
  }, initialDelayMs);
  if (first.unref && !keepAlive) {
    first.unref();
  }
  timer = first;
}

async function main(): Promise<void> {
  console.log(`[fx-refresh-runner] Starting as standalone process.`);

  const shutdown = async (sig: string) => {
    console.log(`[fx-refresh-runner] Received ${sig}, shutting down`);
    schedulerStarted = false;
    if (timer) {
      clearTimeout(timer);
    }
    await db.end().catch(() => {});
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  startFxRefreshScheduler({ keepAlive: true, initialDelayMs: 0 });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[fx-refresh-runner] Fatal startup error:', err);
    process.exit(1);
  });
}
