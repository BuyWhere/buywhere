/**
 * cacheStats.ts — Per-route Redis cache hit/miss counters (BUY-54722 consumer)
 *
 * Tracks every Redis cache lookup the api serves (FTS result cache, query-embed
 * cache, list cache, deals cache) into per-minute Redis hash buckets. The
 * buywhere-monitoring-api service aggregates these buckets via
 * GET /api/monitoring/embedding/cache_stats?window=1h to expose
 * `query_embedding_cache_hit_rate`.
 *
 * Backed by Redis hash buckets: `qembed:stats:60:<bucket>` -> { hit, miss }.
 * The helper name `qembed:stats:` is shared with monitoring-api for aggregation
 * compatibility (see monitoring-api/api/src/monitoring/embedding.js).
 *
 * BUY-75411 / MCP cache-hit p95 latency tracking:
 *   Per-bucket sorted set `qembed:fts:cache_hit:60:<bucket>` stores one
 *   member per cache hit (score = wall-clock latency_ms, member =
 *   `<ts_ms>:<rand>`). The matching admin endpoint on buywhere-api aggregates
 *   the raw samples into p50/p95/p99/max over a window.
 *
 * Wire pattern:
 *   const hit = await recordQueryCacheLookup(redis, cacheKey, async () => redis.get(cacheKey));
 *   if (hit !== null) { ... return cached ... }
 *
 * Or as a sidecar counter:
 *   const hit = await recordQueryCacheLookup(redis, cacheKey, async () => { ... });
 *
 * Failures are swallowed — the cache lookup must never break the request.
 */

type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ...args: any[]) => Promise<unknown>;
  hincrby: (key: string, field: string, n: number) => Promise<number>;
  expire: (key: string, ttl: number) => Promise<number>;
  zadd?: (key: string, score: number, member: string) => Promise<number>;
  zrange?: (...args: any[]) => Promise<unknown>;
  zremrangebyscore?: (key: string, min: number, max: number) => Promise<number>;
  pipeline?: () => unknown;
};

const BUCKET_SECONDS = 60;
const KEY_PREFIX = 'qembed:stats:';
const LATENCY_KEY_PREFIX = 'qembed:fts:cache_hit:';

/**
 * Look up `cacheKey` in Redis, counting the lookup as a hit or miss in the
 * rolling stats bucket. Returns the cached value (string) or null on miss/error.
 */
export async function recordQueryCacheLookup(
  redis: RedisLike | null | undefined,
  cacheKey: string,
  fetcher: () => Promise<string | null>
): Promise<string | null> {
  let value: string | null = null;
  let isHit = false;
  try {
    value = await fetcher();
    isHit = value !== null;
  } catch (_) {
    isHit = false;
  }
  // Increment counter (best-effort; do not block the request)
  if (redis) {
    try {
      const bucket = Math.floor(Date.now() / 1000 / BUCKET_SECONDS);
      const statsKey = `${KEY_PREFIX}${BUCKET_SECONDS}:${bucket}`;
      await Promise.all([
        redis.hincrby(statsKey, isHit ? 'hit' : 'miss', 1),
        redis.expire(statsKey, 24 * 60 * 60),
      ]);
    } catch (_) {
      // stats increment failures are non-fatal
    }
  }
  return value;
}

/**
 * Record a cache outcome without performing the lookup. Use when the call site
 * already has the result and just wants to count it.
 */
export async function recordCacheOutcome(
  redis: RedisLike | null | undefined,
  isHit: boolean
): Promise<void> {
  if (!redis) return;
  try {
    const bucket = Math.floor(Date.now() / 1000 / BUCKET_SECONDS);
    const statsKey = `${KEY_PREFIX}${BUCKET_SECONDS}:${bucket}`;
    await Promise.all([
      redis.hincrby(statsKey, isHit ? 'hit' : 'miss', 1),
      redis.expire(statsKey, 24 * 60 * 60),
    ]);
  } catch (_) {
    // swallow
  }
}

/**
 * BUY-75411: record one MCP /search_products cache-hit latency sample into a
 * per-minute Redis sorted set. Member score is latency_ms; member value is
 * `<ts_ms>:<rand>` so duplicates at the same latency are tolerated. Failures
 * are swallowed — the latency sample must never break the request.
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
    // swallow
  }
}

/**
 * BUY-75411: aggregate MCP /search_products cache-hit latency over the last
 * `windowSeconds` seconds. Returns p50/p95/p99/max + sample count. Buckets are
 * sized by `bucketSeconds` (default 60s); defaults match `recordCacheHitLatency`.
 *
 * The function tolerates Redis client implementations that do not expose
 * `zrange` (returns available=false). Designed so the admin probe endpoint
 * can return a stable shape even before the first sample lands.
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
      // WITHSCORES returns alternating [member, score, member, score, ...]
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
