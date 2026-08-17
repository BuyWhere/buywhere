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

import { db, redis } from '../config';
import { computeP95ForAllMarkets } from '../monitoring/middleware';
import { insertAlert, getEndpointThreshold } from '../monitoring/p95';

const P95_THRESHOLD_MS = parseInt(process.env.P95_THRESHOLD_MS || '300', 10);
const CONSECUTIVE_ROTATIONS_REQUIRED = 3;
const INTERVAL_MS = parseInt(process.env.P95_COMPUTE_INTERVAL_MS || '300000', 10);
const CONSECUTIVE_KEY_PREFIX = 'p95:consecutive:';

/** Markets tracked by the monitoring system */
const MARKETS = ['sg', 'us', 'my', 'vn', 'th'] as const;

/**
 * Check consecutive-rotation threshold per market+endpoint.
 * Uses Redis to track how many consecutive windows exceeded the endpoint-specific
 * P95 threshold. When the count reaches CONSECUTIVE_ROTATIONS_REQUIRED, fires an alert.
 */
async function checkConsecutiveAlerts(): Promise<void> {
  try {
    // Fetch the latest window for each market+endpoint in the last 15 minutes.
    const result = await db.query(
      `SELECT market, endpoint, p95_ms
       FROM monitoring.p95_latency
       WHERE window_end > NOW() - INTERVAL '15 minutes'
       ORDER BY market, endpoint, window_end DESC`
    );

    const latestByKey = new Map<string, { market: string; endpoint: string; p95_ms: number }>();
    for (const row of result.rows) {
      const key = `${row.market}:${row.endpoint}`;
      if (!latestByKey.has(key)) {
        latestByKey.set(key, row);
      }
    }

    for (const { market, endpoint, p95_ms } of latestByKey.values()) {
      try {
        const thresholdMs = getEndpointThreshold(endpoint);
        const redisKey = `${CONSECUTIVE_KEY_PREFIX}${market}:${endpoint}`;

        if (p95_ms > thresholdMs) {
          const count = await redis.incr(redisKey);
          await redis.expire(redisKey, 1800).catch(() => {}); // 30 min TTL

          console.log(
            `[p95-runner] ${market}:${endpoint} P95=${p95_ms}ms exceeds ${thresholdMs}ms ` +
            `(${count}/${CONSECUTIVE_ROTATIONS_REQUIRED} consecutive)`
          );

          if (count >= CONSECUTIVE_ROTATIONS_REQUIRED) {
            await insertAlert(market, p95_ms, thresholdMs);
            console.warn(
              `[p95-runner] ALERT: ${market}:${endpoint} P95=${p95_ms}ms exceeded ${thresholdMs}ms ` +
              `for ${CONSECUTIVE_ROTATIONS_REQUIRED} consecutive rotations (BUY-13701)`
            );
            await redis.set(redisKey, '0', 'EX', 1800);
          }
        } else {
          const currentVal = await redis.get(redisKey);
          if (currentVal && parseInt(currentVal, 10) > 0) {
            await redis.set(redisKey, '0', 'EX', 1800);
            console.log(`[p95-runner] ${market}:${endpoint} P95=${p95_ms}ms — resetting consecutive counter`);
          }
        }
      } catch (err) {
        console.error(`[p95-runner] Error checking consecutive alerts for ${market}:${endpoint}:`, err);
      }
    }
  } catch (err) {
    console.error('[p95-runner] Error fetching latest P95 for consecutive alert check:', err);
  }
}

async function tick(): Promise<void> {
  try {
    await computeP95ForAllMarkets();
    await checkConsecutiveAlerts();
  } catch (err) {
    console.error('[p95-runner] Tick error:', err);
  }
}

/**
 * Start the P95 computation loop. Runs every INTERVAL_MS.
 * Safe to call from the main API server process.
 */
export function startP95Runner(): void {
  console.log(
    `[p95-runner] Starting P95 computation (every ${INTERVAL_MS / 1000}s, ` +
    `threshold=${P95_THRESHOLD_MS}ms, consecutive=${CONSECUTIVE_ROTATIONS_REQUIRED})`
  );

  // First tick after 30s to let the server warm up
  setTimeout(() => {
    tick();
    const timer = setInterval(tick, INTERVAL_MS);
    // Prevent the timer from keeping the process alive during shutdown
    if (timer.unref) {
      timer.unref();
    }
  }, 30_000);
}

// Standalone mode: run once and exit (for manual execution via `npm run p95`)
async function main(): Promise<void> {
  console.log('[p95-runner] Running P95 computation once...');
  await tick();
  console.log('[p95-runner] Done.');
  await db.end().catch(() => {});
  redis.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[p95-runner] Fatal:', err);
    process.exit(1);
  });
}
