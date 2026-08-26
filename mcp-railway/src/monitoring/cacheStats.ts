/**
 * cacheStats.ts — BUY-75411 cache-hit latency tracking for mcp-server.
 *
 * Mirrors api/src/monitoring/cacheStats.ts but lives in mcp-railway so the
 * Railway-deployed mcp-server service can record cache-hit latency into
 * the same Redis shape (`qembed:fts:cache_hit:60:<bucket>`) that the api's
 * /v1/admin/probes/mcp_cache_hit_latency probe aggregates across services.
 */

type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ...args: any[]) => Promise<unknown>;
  hincrby: (key: string, field: string, n: number) => Promise<number>;
  expire: (key: string, ttl: number) => Promise<number>;
  zadd?: (key: string, score: number, member: string) => Promise<number>;
  zrange?: (...args: any[]) => Promise<unknown>;
  pipeline?: () => unknown;
};

const BUCKET_SECONDS = 60;
const LATENCY_KEY_PREFIX = 'qembed:fts:cache_hit:';

/**
 * Record one MCP /search_products cache-hit latency sample into a per-minute
 * Redis sorted set. Member score is latency_ms; member value is
 * `<ts_ms>:<rand>` so duplicates at the same latency are tolerated.
 * Failures are swallowed — the latency sample must never break the request.
 */
export async function recordCacheHitLatency(
  redis: RedisLike | null | undefined,
  latencyMs: number,
  bucketSeconds: number = BUCKET_SECONDS
): Promise<void> {
  if (!redis || !redis.zadd || !redis.expire) return;
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  try {
    const bucket = Math.floor(Date.now() / 1000 / bucketSeconds);
    const statsKey = `${LATENCY_KEY_PREFIX}${bucketSeconds}:${bucket}`;
    const member = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await Promise.all([
      redis.zadd(statsKey, latencyMs, member),
      redis.expire(statsKey, 24 * 60 * 60),
    ]);
  } catch (_) {
    // swallow — latency sample must never block the request
  }
}

/**
 * Aggregate MCP /search_products cache-hit latency over the last `windowSeconds`
 * seconds. Returns p50/p95/p99/max + sample count. Uses ZRANGE WITHSCORES
 * to recover raw latency values; sorted ascending by score.
 */
export async function readCacheHitLatencyPercentiles(
  redis: RedisLike | null | undefined,
  windowSeconds: number,
  bucketSeconds: number = BUCKET_SECONDS
): Promise<{
  available: boolean;
  reason?: string;
  window_seconds: number;
  sample_count: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
  buckets_considered: number;
}> {
  const empty = {
    available: false,
    window_seconds: windowSeconds,
    sample_count: 0,
    p50_ms: null as number | null,
    p95_ms: null as number | null,
    p99_ms: null as number | null,
    max_ms: null as number | null,
    buckets_considered: 0,
  };
  if (!redis || typeof redis.zrange !== 'function') {
    return { ...empty, reason: 'redis client does not expose zrange (latency tracking disabled)' };
  }
  const now = Math.floor(Date.now() / 1000);
  const startBucket = Math.floor((now - windowSeconds) / bucketSeconds);
  const endBucket = Math.floor(now / bucketSeconds);
  const samples: number[] = [];
  let buckets = 0;
  for (let b = startBucket; b <= endBucket; b++) {
    const key = `${LATENCY_KEY_PREFIX}${bucketSeconds}:${b}`;
    try {
      const entries = (await redis.zrange(key, 0, -1, 'WITHSCORES')) as unknown[];
      buckets++;
      if (!entries || entries.length < 2) continue;
      for (let i = 1; i < entries.length; i += 2) {
        const score = Number(entries[i]);
        if (Number.isFinite(score)) samples.push(score);
      }
    } catch (_) {
      // skip unreadable bucket
    }
  }
  if (samples.length === 0) {
    return { ...empty, buckets_considered: buckets, reason: 'no cache-hit samples in window' };
  }
  samples.sort((a, b) => a - b);
  const pct = (p: number) => samples[Math.min(samples.length - 1, Math.floor(p * (samples.length - 1)))];
  return {
    available: true,
    window_seconds: windowSeconds,
    sample_count: samples.length,
    p50_ms: pct(0.5),
    p95_ms: pct(0.95),
    p99_ms: pct(0.99),
    max_ms: samples[samples.length - 1],
    buckets_considered: buckets,
  };
}
