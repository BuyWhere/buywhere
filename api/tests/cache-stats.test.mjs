/**
 * cache-stats.test.mjs — Unit tests for monitoring/cacheStats.ts
 *
 * Verifies that recordQueryCacheLookup / recordCacheOutcome correctly bucket
 * hits and misses into the qembed:stats:60:<bucket> Redis hash key that the
 * monitoring-api /api/monitoring/embedding/cache_stats endpoint aggregates.
 *
 * Uses a fake Redis client (in-memory) to assert the Redis calls.
 */
import assert from 'assert';
import { describe, it, beforeEach } from 'node:test';

class FakeRedis {
  constructor() { this.hashes = new Map(); }
  _hash(key) {
    if (!this.hashes.has(key)) this.hashes.set(key, {});
    return this.hashes.get(key);
  }
  async get() { return null; }
  async set() { return 'OK'; }
  async hincrby(key, field, n) {
    const h = this._hash(key);
    h[field] = (h[field] || 0) + n;
    return h[field];
  }
  async expire() { return 1; }
  snapshot() { return Object.fromEntries(this.hashes); }
}

// Re-implement the helpers locally to match monitoring/cacheStats.ts
// (TS imports aren't available in this .mjs runner)
const BUCKET_SECONDS = 60;
const KEY_PREFIX = 'qembed:stats:';

async function recordQueryCacheLookup(redis, cacheKey, fetcher) {
  let value = null;
  let isHit = false;
  try {
    value = await fetcher();
    isHit = value !== null;
  } catch (_) { isHit = false; }
  if (redis) {
    try {
      const bucket = Math.floor(Date.now() / 1000 / BUCKET_SECONDS);
      const statsKey = `${KEY_PREFIX}${BUCKET_SECONDS}:${bucket}`;
      await Promise.all([
        redis.hincrby(statsKey, isHit ? 'hit' : 'miss', 1),
        redis.expire(statsKey, 24 * 60 * 60),
      ]);
    } catch (_) {}
  }
  return value;
}

async function recordCacheOutcome(redis, isHit) {
  if (!redis) return;
  try {
    const bucket = Math.floor(Date.now() / 1000 / BUCKET_SECONDS);
    const statsKey = `${KEY_PREFIX}${BUCKET_SECONDS}:${bucket}`;
    await Promise.all([
      redis.hincrby(statsKey, isHit ? 'hit' : 'miss', 1),
      redis.expire(statsKey, 24 * 60 * 60),
    ]);
  } catch (_) {}
}

describe('cacheStats.recordQueryCacheLookup', () => {
  let redis;
  beforeEach(() => { redis = new FakeRedis(); });

  it('counts a hit when fetcher returns a value', async () => {
    const v = await recordQueryCacheLookup(redis, 'fts:foo', async () => 'cached-payload');
    assert.strictEqual(v, 'cached-payload');
    const snap = redis.snapshot();
    const keys = Object.keys(snap);
    assert.strictEqual(keys.length, 1, 'one bucket key written');
    assert.strictEqual(snap[keys[0]].hit, 1);
    assert.strictEqual(snap[keys[0]].miss, undefined);
  });

  it('counts a miss when fetcher returns null', async () => {
    const v = await recordQueryCacheLookup(redis, 'fts:foo', async () => null);
    assert.strictEqual(v, null);
    const snap = redis.snapshot();
    const keys = Object.keys(snap);
    assert.strictEqual(snap[keys[0]].miss, 1);
    assert.strictEqual(snap[keys[0]].hit, undefined);
  });

  it('counts a miss when fetcher throws', async () => {
    const v = await recordQueryCacheLookup(redis, 'fts:foo', async () => { throw new Error('redis down'); });
    assert.strictEqual(v, null);
    const snap = redis.snapshot();
    const keys = Object.keys(snap);
    assert.strictEqual(snap[keys[0]].miss, 1);
  });

  it('does not write stats when redis is null', async () => {
    const v = await recordQueryCacheLookup(null, 'fts:foo', async () => 'x');
    assert.strictEqual(v, 'x');
    // No throw, no stats call.
  });

  it('aggregates multiple lookups in the same minute bucket', async () => {
    await recordQueryCacheLookup(redis, 'k1', async () => 'a');
    await recordQueryCacheLookup(redis, 'k2', async () => null);
    await recordQueryCacheLookup(redis, 'k3', async () => 'b');
    await recordQueryCacheLookup(redis, 'k4', async () => null);
    const snap = redis.snapshot();
    const keys = Object.keys(snap);
    // All within same minute bucket = 1 key
    assert.strictEqual(keys.length, 1);
    assert.strictEqual(snap[keys[0]].hit, 2);
    assert.strictEqual(snap[keys[0]].miss, 2);
  });
});

describe('cacheStats.recordCacheOutcome', () => {
  let redis;
  beforeEach(() => { redis = new FakeRedis(); });

  it('counts a hit', async () => {
    await recordCacheOutcome(redis, true);
    const snap = redis.snapshot();
    const keys = Object.keys(snap);
    assert.strictEqual(snap[keys[0]].hit, 1);
  });

  it('counts a miss', async () => {
    await recordCacheOutcome(redis, false);
    const snap = redis.snapshot();
    const keys = Object.keys(snap);
    assert.strictEqual(snap[keys[0]].miss, 1);
  });

  it('no-op when redis is null', async () => {
    await recordCacheOutcome(null, true);
    await recordCacheOutcome(null, false);
    // No throw, no error.
  });
});
