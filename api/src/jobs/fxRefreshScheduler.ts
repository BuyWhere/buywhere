import { runFxRefresh } from './fxRefresh';

const FX_REFRESH_INTERVAL_MS = Math.max(
  60_000,
  parseInt(process.env.FX_REFRESH_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10) || 6 * 60 * 60 * 1000,
);
const FX_REFRESH_STARTUP_DELAY_MS = Math.max(
  0,
  parseInt(process.env.FX_REFRESH_STARTUP_DELAY_MS || '15000', 10) || 15000,
);

let running = false;
let schedulerHandle: NodeJS.Timeout | null = null;
let startupHandle: NodeJS.Timeout | null = null;
let started = false;

async function tick(): Promise<void> {
  if (running) {
    console.log('[fx-refresh-scheduler] previous run still in progress, skipping');
    return;
  }

  running = true;
  try {
    const summary = await runFxRefresh();
    const status = summary.errors.length ? 'with warnings' : 'clean';
    console.log(
      `[fx-refresh-scheduler] run ${status} — upserted ${summary.upserted}, ` +
      `frankfurter ${summary.frankfurter_rates.length}, fallback ${summary.fallback_rates.length}, ` +
      `missing ${summary.missing_currencies.length}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[fx-refresh-scheduler] run failed:', message);
  } finally {
    running = false;
  }
}

function scheduleRepeatingRuns(): void {
  schedulerHandle = setInterval(() => {
    void tick().catch((error) => console.error('[fx-refresh-scheduler] interval run failed:', error));
  }, FX_REFRESH_INTERVAL_MS);

  if (schedulerHandle.unref) {
    schedulerHandle.unref();
  }
}

export function startFxRefreshScheduler(): void {
  if (started) {
    return;
  }
  started = true;

  const hours = Math.round(FX_REFRESH_INTERVAL_MS / 3_600_000);
  const minutes = Math.round((FX_REFRESH_INTERVAL_MS % 3_600_000) / 60_000);

  console.log(
    `[fx-refresh-scheduler] Starting fx rates refresher (${hours}h ${minutes}m interval) ` +
    `with ${Math.round(FX_REFRESH_STARTUP_DELAY_MS / 1000)}s startup delay`
  );

  startupHandle = setTimeout(() => {
    void tick().catch((error) => console.error('[fx-refresh-scheduler] startup run failed:', error));
    scheduleRepeatingRuns();
  }, FX_REFRESH_STARTUP_DELAY_MS);

  if (startupHandle.unref) {
    startupHandle.unref();
  }
}

export function stopFxRefreshScheduler(): void {
  if (startupHandle) {
    clearTimeout(startupHandle);
    startupHandle = null;
  }
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
  started = false;
}
