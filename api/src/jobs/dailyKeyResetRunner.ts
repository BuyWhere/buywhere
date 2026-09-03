import { db, redis } from '../config';
import { runDailyKeyReset } from './dailyKeyReset';

const HOUR_UTC = parseInt(process.env.RESET_HOUR_UTC ?? '2', 10);
const MIN_UTC  = parseInt(process.env.RESET_MIN_UTC  ?? '0',  10);

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
  console.log('[daily-key-reset-runner] Job triggered');
  try {
    const summary = await runDailyKeyReset();
    console.log(
      `[daily-key-reset-runner] Completed — ${summary.keys_reset} key(s) reset`
    );
  } catch (err) {
    console.error('[daily-key-reset-runner] Unhandled job error:', err);
  }
  schedule();
}

function schedule(): void {
  const delay = msUntilNext(HOUR_UTC, MIN_UTC);
  console.log(
    `[daily-key-reset-runner] Next run at ${HOUR_UTC.toString().padStart(2, '0')}:${MIN_UTC.toString().padStart(2, '0')} UTC ` +
    `(daily reset) — in ${formatDelay(delay)}`
  );
  setTimeout(tick, delay);
}

async function main(): Promise<void> {
  console.log(
    `[daily-key-reset-runner] Starting. Schedule: daily ${HOUR_UTC.toString().padStart(2, '0')}:${MIN_UTC.toString().padStart(2, '0')} UTC`
  );

  const shutdown = async (sig: string) => {
    console.log(`[daily-key-reset-runner] Received ${sig}, shutting down`);
    await db.end().catch(() => {});
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  schedule();
}

main().catch((err) => {
  console.error('[daily-key-reset-runner] Fatal startup error:', err);
  process.exit(1);
});
