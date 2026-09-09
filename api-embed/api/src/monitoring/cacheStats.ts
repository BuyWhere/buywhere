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
};

const BUCKET_SECONDS = 60;
const KEY_PREFIX = 'qembed:stats:';

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
