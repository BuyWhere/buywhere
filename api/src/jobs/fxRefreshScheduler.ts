/**
 * fxRefreshScheduler.ts — In-process scheduler for the 6h FX refresh (BUY-52476).
 *
 * Pattern mirrors p95ProbeScheduler.ts:
 *   - Boots inside the buywhere-api process at startup.
 *   - setInterval with .unref() so it never blocks process exit.
 *   - First tick fires after a short delay so the rest of the app is ready.
 *
 * Override interval via env: FX_REFRESH_INTERVAL_MS (default 21_600_000 = 6h).
 *
 * A Paperclip routine 'fx-refresh' is registered separately as a backup
 * trigger / observability surface (you can see every refresh execution in
 * the Paperclip UI), but the in-process scheduler is the source of truth.
 */

import { runFxRefresh } from './fxRefresh';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

let schedulerStarted = false;
let schedulerTimer: NodeJS.Timeout | null = null;

export function startFxRefreshScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const intervalMs = parseInt(process.env.FX_REFRESH_INTERVAL_MS || `${DEFAULT_INTERVAL_MS}`, 10);
  const intervalH = (intervalMs / 3_600_000).toFixed(2);

  console.log(`[fx-refresh-scheduler] starting (every ${intervalH}h)`);

  // First tick fires after a 30s warm-up so cold start isn't slowed by an
  // outbound HTTP fetch in the request path.
  const warmup = setTimeout(() => {
    void runFxRefresh().catch((err) => {
      console.error('[fx-refresh-scheduler] tick failed:', err);
    });
  }, 30_000);
  if (warmup.unref) warmup.unref();

  schedulerTimer = setInterval(() => {
    void runFxRefresh().catch((err) => {
      console.error('[fx-refresh-scheduler] tick failed:', err);
    });
  }, intervalMs);
  if (schedulerTimer.unref) schedulerTimer.unref();
}

export function stopFxRefreshScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerStarted = false;
}
