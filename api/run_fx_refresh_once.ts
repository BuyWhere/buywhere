/**
 * Standalone one-shot runner for the routine heartbeat.
 * Calls runFxRefresh() directly against the live roundhouse DB, prints
 * the result summary, then exits (no scheduler loop).
 */
import { runFxRefresh } from './src/jobs/fxRefresh';

(async () => {
  const start = Date.now();
  console.log('[fx-refresh-runner] Heartbeat one-shot start');
  try {
    const result = await runFxRefresh();
    console.log(JSON.stringify({
      ok: result.success,
      ratesUpserted: result.ratesUpserted,
      sources: result.sources,
      errors: result.errors,
      durationMs: result.durationMs,
      wallMs: Date.now() - start,
    }, null, 2));
    process.exit(result.success ? 0 : 2);
  } catch (err) {
    console.error('[fx-refresh-runner] Fatal error:', err);
    process.exit(1);
  }
})();
