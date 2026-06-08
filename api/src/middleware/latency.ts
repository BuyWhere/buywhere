// BUY-22737 / BUY-35381 — per-request latency histogram middleware.
//
// In-memory ring buffer per route (size = 60_000 samples ≈ 30 min at ~33 rps).
// Hard-coded buckets [10, 25, 50, 100, 250, 500, 1000, 2500, 5000] ms.
// Sliding 30-min window — old samples are dropped on read, not on every write,
// to keep the request path hot-path-free.
//
// Consumed by GET /v1/admin/metrics and (combined with monitoring.uptime_daily)
// by GET /v1/admin/uptime. No persistent storage here — the prober handles
// persistence into monitoring.p95_raw_measurements.

import { Request, Response, NextFunction } from 'express';

// Hard-coded buckets per the plan (ms). The trailing +Inf bucket is implicit
// in the response (count - sum(bucket counts)).
export const LATENCY_BUCKETS_MS: readonly number[] = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

// Ring buffer capacity per route. 60_000 samples ≈ 30 min at ~33 rps.
const RING_BUFFER_SIZE = 60_000;

// Sliding window: samples older than this are dropped on read.
const WINDOW_MS = 30 * 60 * 1000;

interface LatencySample {
  latencyMs: number;
  ts: number;
  statusCode: number;
}

interface RouteStats {
  // Ring buffer, head-indexed. Oldest sample at head, newest at (head + count - 1) % size.
  samples: LatencySample[];
  head: number;
  count: number;
  // Cheap counters — kept up to date on each write.
  totalCount: number;     // all-time count (capped at Number.MAX_SAFE_INTEGER)
  windowSumMs: number;    // sum over the current window (recomputed on prune)
}

const ROUTE_STATS = new Map<string, RouteStats>();

function getOrCreateStats(routeKey: string): RouteStats {
  let stats = ROUTE_STATS.get(routeKey);
  if (!stats) {
    stats = {
      samples: new Array<LatencySample>(RING_BUFFER_SIZE),
      head: 0,
      count: 0,
      totalCount: 0,
      windowSumMs: 0,
    };
    ROUTE_STATS.set(routeKey, stats);
  }
  return stats;
}

function pushSample(stats: RouteStats, sample: LatencySample): void {
  if (stats.count < RING_BUFFER_SIZE) {
    // Buffer not full — append.
    const idx = (stats.head + stats.count) % RING_BUFFER_SIZE;
    stats.samples[idx] = sample;
    stats.count += 1;
  } else {
    // Buffer full — overwrite oldest at head, advance head.
    stats.samples[stats.head] = sample;
    stats.head = (stats.head + 1) % RING_BUFFER_SIZE;
  }
  stats.totalCount += 1;
}

function pruneExpired(stats: RouteStats, cutoffMs: number): void {
  // Drop samples at the head that fall outside the window. We don't bother
  // with a binary search — the window is 30 min and the buffer holds ~30 min
  // of samples, so the typical drop count is small.
  let dropped = 0;
  let droppedSum = 0;
  while (stats.count > 0) {
    const head = stats.samples[stats.head];
    if (!head || head.ts >= cutoffMs) break;
    droppedSum += head.latencyMs;
    dropped += 1;
    // Advance head.
    stats.samples[stats.head] = undefined as unknown as LatencySample;
    stats.head = (stats.head + 1) % RING_BUFFER_SIZE;
    stats.count -= 1;
  }
  stats.windowSumMs = Math.max(0, stats.windowSumMs - droppedSum);
  // The above is a lower bound — we should not let windowSumMs drift negative
  // if it was already 0 (which can happen on first read). Cap at 0 above.
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}

export interface RouteHistogram {
  route: string;
  count: number;            // samples in the current window
  sum_ms: number;           // sum of latency_ms in the current window
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  buckets: { le_ms: number; count: number }[];
  status_counts: { status_class: string; count: number }[];
}

export function snapshotHistograms(): { window_seconds: number; routes: RouteHistogram[]; generated_at: string } {
  const cutoff = Date.now() - WINDOW_MS;
  const routes: RouteHistogram[] = [];
  for (const [routeKey, stats] of ROUTE_STATS.entries()) {
    pruneExpired(stats, cutoff);
    if (stats.count === 0) continue;

    // Collect samples in age order, gather bucket counts and status counts.
    const latencies: number[] = new Array(stats.count);
    const buckets = LATENCY_BUCKETS_MS.map((le) => ({ le_ms: le, count: 0 }));
    const statusCounts = new Map<string, number>();
    let sum = 0;
    for (let i = 0; i < stats.count; i++) {
      const s = stats.samples[(stats.head + i) % RING_BUFFER_SIZE];
      if (!s) continue;
      latencies[i] = s.latencyMs;
      sum += s.latencyMs;
      for (const b of buckets) {
        if (s.latencyMs <= b.le_ms) b.count += 1;
      }
      const klass = `${Math.floor(s.statusCode / 100)}xx`;
      statusCounts.set(klass, (statusCounts.get(klass) || 0) + 1);
    }
    latencies.sort((a, b) => a - b);

    routes.push({
      route: routeKey,
      count: stats.count,
      sum_ms: Math.round(sum),
      p50_ms: percentile(latencies, 0.5),
      p95_ms: percentile(latencies, 0.95),
      p99_ms: percentile(latencies, 0.99),
      buckets,
      status_counts: Array.from(statusCounts.entries())
        .map(([k, v]) => ({ status_class: k, count: v }))
        .sort((a, b) => a.status_class.localeCompare(b.status_class)),
    });
  }
  // Stable, predictable order for clients / dashboards.
  routes.sort((a, b) => a.route.localeCompare(b.route));
  return {
    window_seconds: WINDOW_MS / 1000,
    routes,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Build a stable route key for a finished request.
 *   - Uses req.route.path (the template) when available so /v1/products/abc
 *     and /v1/products/def collapse into "GET /v1/products/:id".
 *   - Falls back to req.path if no route matched (404, no-template, etc.).
 */
function routeKeyFor(req: Request): string {
  const method = req.method || 'GET';
  const tmpl = req.route?.path;
  if (typeof tmpl === 'string' && tmpl.length > 0) {
    const base = req.baseUrl || '';
    return `${method} ${base}${tmpl}`;
  }
  return `${method} ${req.path || '/'}`;
}

/**
 * Express middleware: records per-request latency into the per-route ring buffer.
 *
 * Skips the admin endpoints themselves (/v1/admin/*) so internal polling does
 * not pollute the customer-facing histogram.
 */
export function histogramLatencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Avoid double-instrumentation when mounted twice (e.g. legacy + new wiring).
  if ((req as any).__histogramStart !== undefined) {
    return next();
  }
  if (req.path.startsWith('/v1/admin')) {
    return next();
  }
  const startNs = process.hrtime.bigint();
  (req as any).__histogramStart = startNs;
  res.once('finish', () => {
    const elapsedNs = process.hrtime.bigint() - startNs;
    const latencyMs = Math.round(Number(elapsedNs) / 1_000_000);
    const key = routeKeyFor(req);
    const stats = getOrCreateStats(key);
    pushSample(stats, {
      latencyMs,
      ts: Date.now(),
      statusCode: res.statusCode,
    });
    stats.windowSumMs += latencyMs;
  });
  next();
}

// Test helper — only used in unit tests.
export function _resetHistogramForTests(): void {
  ROUTE_STATS.clear();
}
