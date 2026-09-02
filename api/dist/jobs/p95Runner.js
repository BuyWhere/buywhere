"use strict";
/**
 * p95Runner.ts — Periodic P95 latency computation and storage (BUY-32082)
 *
 * Runs every 5 minutes. Reads in-memory latency samples collected by the
 * latencyMiddleware, computes P95 per market+endpoint, and persists to
 * monitoring.p95_latency. When P95 exceeds the 300ms threshold for 3
 * consecutive rotations, an alert is flagged for BUY-13701 posting.
 *
 * Override interval via env: P95_COMPUTE_INTERVAL_MS (default: 300000 = 5 min)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startP95Runner = startP95Runner;
const config_1 = require("../config");
const middleware_1 = require("../monitoring/middleware");
const p95_1 = require("../monitoring/p95");
const P95_THRESHOLD_MS = parseInt(process.env.P95_THRESHOLD_MS || '300', 10);
const CONSECUTIVE_ROTATIONS_REQUIRED = 3;
const INTERVAL_MS = parseInt(process.env.P95_COMPUTE_INTERVAL_MS || '300000', 10);
const CONSECUTIVE_KEY_PREFIX = 'p95:consecutive:';
/** Markets tracked by the monitoring system */
const MARKETS = ['sg', 'us', 'my', 'vn', 'th'];
/**
 * Check consecutive-rotation threshold for a market.
 * Uses Redis to track how many consecutive windows exceeded the P95 threshold.
 * When the count reaches CONSECUTIVE_ROTATIONS_REQUIRED, fires an alert.
 */
async function checkConsecutiveAlerts() {
    for (const market of MARKETS) {
        try {
            // Get the latest P95 for this market across all endpoints
            const result = await config_1.db.query(`SELECT MAX(p95_ms) as max_p95 FROM monitoring.p95_latency
         WHERE market = $1 AND window_end > NOW() - INTERVAL '10 minutes'`, [market]);
            const maxP95 = result.rows[0]?.max_p95 || 0;
            const redisKey = `${CONSECUTIVE_KEY_PREFIX}${market}`;
            if (maxP95 > P95_THRESHOLD_MS) {
                // Threshold exceeded — increment consecutive counter
                const count = await config_1.redis.incr(redisKey);
                await config_1.redis.expire(redisKey, 1800).catch(() => { }); // 30 min TTL
                console.log(`[p95-runner] ${market.toUpperCase()} P95=${maxP95}ms exceeds ${P95_THRESHOLD_MS}ms ` +
                    `(${count}/${CONSECUTIVE_ROTATIONS_REQUIRED} consecutive)`);
                if (count >= CONSECUTIVE_ROTATIONS_REQUIRED) {
                    // 3 consecutive rotations exceeded — trigger alert
                    await (0, p95_1.insertAlert)(market, maxP95, P95_THRESHOLD_MS);
                    console.warn(`[p95-runner] ALERT: ${market.toUpperCase()} P95=${maxP95}ms exceeded ${P95_THRESHOLD_MS}ms ` +
                        `threshold for ${CONSECUTIVE_ROTATIONS_REQUIRED} consecutive rotations (BUY-13701)`);
                    // Reset counter after alerting so we don't re-alert every tick
                    await config_1.redis.set(redisKey, '0', 'EX', 1800);
                }
            }
            else {
                // Threshold not exceeded — reset counter
                const currentVal = await config_1.redis.get(redisKey);
                if (currentVal && parseInt(currentVal, 10) > 0) {
                    await config_1.redis.set(redisKey, '0', 'EX', 1800);
                    console.log(`[p95-runner] ${market.toUpperCase()} P95=${maxP95}ms — resetting consecutive counter`);
                }
            }
        }
        catch (err) {
            console.error(`[p95-runner] Error checking consecutive alerts for ${market}:`, err);
        }
    }
}
async function tick() {
    try {
        await (0, middleware_1.computeP95ForAllMarkets)();
        await checkConsecutiveAlerts();
    }
    catch (err) {
        console.error('[p95-runner] Tick error:', err);
    }
}
/**
 * Start the P95 computation loop. Runs every INTERVAL_MS.
 * Safe to call from the main API server process.
 */
function startP95Runner() {
    console.log(`[p95-runner] Starting P95 computation (every ${INTERVAL_MS / 1000}s, ` +
        `threshold=${P95_THRESHOLD_MS}ms, consecutive=${CONSECUTIVE_ROTATIONS_REQUIRED})`);
    // First tick after 30s to let the server warm up
    setTimeout(() => {
        tick();
        const timer = setInterval(tick, INTERVAL_MS);
        // Prevent the timer from keeping the process alive during shutdown
        if (timer.unref) {
            timer.unref();
        }
    }, 30000);
}
// Standalone mode: run once and exit (for manual execution via `npm run p95`)
async function main() {
    console.log('[p95-runner] Running P95 computation once...');
    await tick();
    console.log('[p95-runner] Done.');
    await config_1.db.end().catch(() => { });
    config_1.redis.disconnect();
}
if (require.main === module) {
    main().catch((err) => {
        console.error('[p95-runner] Fatal:', err);
        process.exit(1);
    });
}
