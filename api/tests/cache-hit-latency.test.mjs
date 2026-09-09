/**
 * cache-hit-latency.test.mjs — Unit tests for monitoring/cacheStats.ts latency helpers.
 *
 * BUY-75411: Verifies that recordCacheHitLatency stores latency_ms as a sorted-set
 * score under `qembed:fts:cache_hit:60:<bucket>` and that
 * readCacheHitLatencyPercentiles aggregates the per-bucket samples into p50/p95/p99/max.
 *
 * Uses a fake Redis client (in-memory sorted sets) to assert behavior without touching
 * the real Redis cluster.
 */
import assert from 'assert';
import { describe, it, beforeEach } from 'node:test';

class FakeRedisWithZ {
  constructor() { this.zsets = new Map(); this.expirations = new Map(); }
  _zset(key) {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    return this.zsets.get(key);
  }
  async get() { return null; }
  async set() { return 'OK'; }
  async hincrby() { return 1; }
  async expire(key, ttl) { this.expirations.set(key, ttl); return 1; }
  async zadd(key, score, member) {
    const zs = this._zset(key);
    zs.set(member, score);
    return zs.size;
  }
  async zrange(key, start, stop, ...args) {
    const zs = this._zset(key);
    if (!zs.size) return [];
    const withScores = args.includes('WITHSCORES');
    const arr = [...zs.entries()].sort((a, b) => a[1] - b[1]); // sort by score ascending
    const s = start < 0 ? Math.max(0, arr.length + start) : start;
    const e = stop < 0 ? arr.length + stop : Math.min(arr.length - 1, stop);
    const slice = arr.slice(s, e + 1);
    if (!withScores) return slice.map(([m]) => m);
    return slice.flatMap(([m, sc]) => [m, String(sc)]);
  }
  sampleCount(key) { return (this.zsets.get(key) || new Map()).size; }
}

const BUCKET_SECONDS = 60;
const LATENCY_KEY_PREFIX = 'qembed:fts:cache_hit:';

async function recordCacheHitLatency(redis, latencyMs, bucketSeconds = BUCKET_SECONDS) {
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
  } catch (_) {}
}

async function readCacheHitLatencyPercentiles(redis, windowSeconds, bucketSeconds = BUCKET_SECONDS) {
  const empty = {
    available: false,
    window_seconds: windowSeconds,
    sample_count: 0,
    p50_ms: null,
    p95_ms: null,
    p99_ms: null,
    max_ms: null,
    buckets_considered: 0,
  };
  if (!redis || typeof redis.zrange !== 'function') {
    return { ...empty, reason: 'redis client does not expose zrange' };
  }
  const now = Math.floor(Date.now() / 1000);
  const startBucket = Math.floor((now - windowSeconds) / bucketSeconds);
  const endBucket = Math.floor(now / bucketSeconds);
  const samples = [];
  let buckets = 0;
  for (let b = startBucket; b <= endBucket; b++) {
    const key = `${LATENCY_KEY_PREFIX}${bucketSeconds}:${b}`;
    try {
      const entries = await redis.zrange(key, 0, -1, 'WITHSCORES');
      buckets++;
      if (!entries || entries.length < 2) continue;
      for (let i = 1; i < entries.length; i += 2) {
        const score = Number(entries[i]);
        if (Number.isFinite(score)) samples.push(score);
      }
    } catch (_) {}
  }
  if (samples.length === 0) {
    return { ...empty, buckets_considered: buckets, reason: 'no cache-hit samples in window' };
  }
  samples.sort((a, b) => a - b);
  const pct = (p) => samples[Math.min(samples.length - 1, Math.floor(p * (samples.length - 1)))];
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

describe('cacheStats.recordCacheHitLatency', () => {
  let redis;
  beforeEach(() => { redis = new FakeRedisWithZ(); });

  it('stores a latency sample in the current minute bucket', async () => {
    await recordCacheHitLatency(redis, 12);
    const bucket = Math.floor(Date.now() / 1000 / BUCKET_SECONDS);
    const key = `${LATENCY_KEY_PREFIX}${BUCKET_SECONDS}:${bucket}`;
    assert.strictEqual(redis.sampleCount(key), 1);
  });

  it('stores multiple samples without dedup', async () => {
    await recordCacheHitLatency(redis, 5);
    await recordCacheHitLatency(redis, 50);
    await recordCacheHitLatency(redis, 250);
    const bucket = Math.floor(Date.now() / 1000 / BUCKET_SECONDS);
    const key = `${LATENCY_KEY_PREFIX}${BUCKET_SECONDS}:${bucket}`;
    assert.strictEqual(redis.sampleCount(key), 3);
  });

  it('no-op on null redis', async () => {
    await recordCacheHitLatency(null, 100);
    // No throw.
  });

  it('rejects non-finite latency', async () => {
    await recordCacheHitLatency(redis, NaN);
    await recordCacheHitLatency(redis, -5);
    await recordCacheHitLatency(redis, Infinity);
    const bucket = Math.floor(Date.now() / 1000 / BUCKET_SECONDS);
    const key = `${LATENCY_KEY_PREFIX}${BUCKET_SECONDS}:${bucket}`;
    assert.strictEqual(redis.sampleCount(key), 0);
  });
});

describe('cacheStats.readCacheHitLatencyPercentiles', () => {
  let redis;
  beforeEach(() => { redis = new FakeRedisWithZ(); });

  it('returns available=false with empty samples', async () => {
    const result = await readCacheHitLatencyPercentiles(redis, 3600);
    assert.strictEqual(result.available, false);
    assert.strictEqual(result.sample_count, 0);
    assert.strictEqual(result.p95_ms, null);
  });

  it('aggregates 50 samples into p50/p95/p99/max', async () => {
    for (let i = 1; i <= 50; i++) {
      await recordCacheHitLatency(redis, i * 2);
    }
    const result = await readCacheHitLatencyPercentiles(redis, 3600);
    assert.strictEqual(result.available, true);
    assert.strictEqual(result.sample_count, 50);
    // Sorted values: 2,4,...,100. Indices 0..49.
    // p50 = samples[floor(0.5 * 49)] = samples[24] = 50.
    // p95 = samples[floor(0.95 * 49)] = samples[46] = 94.
    // p99 = samples[floor(0.99 * 49)] = samples[48] = 98.
    // max  = 100.
    assert.strictEqual(result.p50_ms, 50);
    assert.strictEqual(result.p95_ms, 94);
    assert.strictEqual(result.p99_ms, 98);
    assert.strictEqual(result.max_ms, 100);
  });

  it('passes the BUY-75411 200ms threshold on a healthy cache-hit distribution', async () => {
    // 100 samples uniformly distributed between 1ms and 150ms.
    for (let i = 1; i <= 100; i++) {
      await recordCacheHitLatency(redis, i * 1.5);
    }
    const result = await readCacheHitLatencyPercentiles(redis, 3600);
    assert.strictEqual(result.available, true);
    assert.ok(result.p95_ms <= 200, `p95 ${result.p95_ms}ms should be <= 200ms`);
  });

  it('flags a cache-hit regression when p95 exceeds 200ms', async () => {
    // 100 samples skewed to higher latencies.
    for (let i = 1; i <= 100; i++) {
      await recordCacheHitLatency(redis, 50 + i * 5);
    }
    const result = await readCacheHitLatencyPercentiles(redis, 3600);
    assert.ok(result.p95_ms > 200, `expected p95 > 200ms, got ${result.p95_ms}ms`);
  });

  it('returns available=false when redis lacks zrange', async () => {
    const noZ = { get: async () => null, set: async () => 'OK' };
    const result = await readCacheHitLatencyPercentiles(noZ, 3600);
    assert.strictEqual(result.available, false);
    assert.match(result.reason, /zrange/);
  });
});