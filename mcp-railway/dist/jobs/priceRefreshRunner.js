"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../config");
const priceRefresh_1 = require("./priceRefresh");
const HOUR_UTC = parseInt(process.env.REFRESH_HOUR_UTC ?? '19', 10);
const MIN_UTC = parseInt(process.env.REFRESH_MIN_UTC ?? '0', 10);
/** Milliseconds until the next HH:MM UTC window. */
function msUntilNext(hourUtc, minUtc) {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hourUtc, minUtc, 0, 0);
    if (next <= now) {
        next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
}
function formatDelay(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
}
async function tick() {
    console.log('[price-refresh-runner] Job triggered');
    try {
        const summary = await (0, priceRefresh_1.runPriceRefresh)();
        console.log(`[price-refresh-runner] Completed — ${summary.success_count}/${summary.total_skus} SKUs refreshed`);
    }
    catch (err) {
        console.error('[price-refresh-runner] Unhandled job error:', err);
    }
    schedule();
}
function schedule() {
    const delay = msUntilNext(HOUR_UTC, MIN_UTC);
    console.log(`[price-refresh-runner] Next run at ${HOUR_UTC.toString().padStart(2, '0')}:${MIN_UTC.toString().padStart(2, '0')} UTC ` +
        `(03:00 SGT) — in ${formatDelay(delay)}`);
    setTimeout(tick, delay);
}
async function main() {
    console.log(`[price-refresh-runner] Starting. Schedule: daily ${HOUR_UTC.toString().padStart(2, '0')}:${MIN_UTC.toString().padStart(2, '0')} UTC (03:00 SGT)`);
    // Handle graceful shutdown
    const shutdown = async (sig) => {
        console.log(`[price-refresh-runner] Received ${sig}, shutting down`);
        await config_1.db.end().catch(() => { });
        config_1.redis.disconnect();
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    schedule();
}
main().catch((err) => {
    console.error('[price-refresh-runner] Fatal startup error:', err);
    process.exit(1);
});
