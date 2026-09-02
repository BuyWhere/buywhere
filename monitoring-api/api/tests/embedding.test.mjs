// BUY-54722: smoke + unit tests for embedding pipeline metrics module.
// Run with: node --test api/tests/embedding.test.mjs

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Pull the constants + helpers we need; we exercise routes by stubbing the
// modules that require them via direct require() (CommonJS).
const embedding = require('../src/monitoring/embedding');

describe('embedding.parseWindow', () => {
  it('accepts canonical buckets', () => {
    assert.equal(embedding.parseWindow('5m'), 300);
    assert.equal(embedding.parseWindow('15m'), 900);
    assert.equal(embedding.parseWindow('1h'), 3600);
    assert.equal(embedding.parseWindow('6h'), 21600);
    assert.equal(embedding.parseWindow('24h'), 86400);
  });

  it('accepts custom durations', () => {
    assert.equal(embedding.parseWindow('30s'), 30);
    assert.equal(embedding.parseWindow('10m'), 600);
    assert.equal(embedding.parseWindow('2h'), 7200);
  });

  it('returns null for missing/invalid input', () => {
    assert.equal(embedding.parseWindow(undefined), null);
    assert.equal(embedding.parseWindow(''), null);
    assert.equal(embedding.parseWindow('foo'), null);
    assert.equal(embedding.parseWindow('0m'), null);
    assert.equal(embedding.parseWindow('-5m'), null);
  });
});

describe('embedding constants', () => {
  it('BUY-41137 acceptance thresholds', () => {
    assert.equal(embedding.SEMANTIC_P95_THRESHOLD_MS, 600);
    assert.equal(embedding.SEMANTIC_ERR_RATE_THRESHOLD, 0.001);
  });

  it('VALID_ENDPOINTS contains search + similar', () => {
    assert.deepEqual([...embedding.VALID_ENDPOINTS].sort(), ['search', 'similar']);
  });
});

describe('embedding.getPipelineState', () => {
  it('returns unavailable when vector pool missing', async () => {
    const res = await embedding.getPipelineState(null);
    assert.equal(res.available, false);
    assert.match(res.reason, /VECTOR_DB_URL/);
  });

  it('returns products_embedded + last_embedded_at from vector db', async () => {
    const fakeClient = {
      query: (sql) => {
        if (sql.includes('FROM product_embeddings')) {
          return Promise.resolve({
            rows: [{
              products_embedded: '12345',
              products_embedded_24h: '900',
              last_embedded_at: new Date('2026-06-21T03:00:00Z'),
              first_embedded_at: new Date('2026-06-01T00:00:00Z'),
              distinct_models: 1,
            }],
          });
        }
        if (sql.includes('FROM embedding_pipeline_state')) {
          return Promise.resolve({
            rows: [
              { key: 'model', value: 'gemini-embedding-001@512', updated_at: new Date() },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      },
      release: () => {},
    };
    const fakeVectorPool = {
      connect: () => Promise.resolve(fakeClient),
    };
    const res = await embedding.getPipelineState(fakeVectorPool);
    assert.equal(res.available, true);
    assert.equal(res.products_embedded, 12345);
    assert.equal(res.products_embedded_24h, 900);
    assert.equal(res.distinct_models, 1);
    assert.equal(res.pipeline_state.model.value, 'gemini-embedding-001@512');
  });

  it('tolerates missing embedding_pipeline_state table', async () => {
    const fakeClient = {
      query: (sql) => {
        if (sql.includes('FROM product_embeddings')) {
          return Promise.resolve({ rows: [{ products_embedded: '1', products_embedded_24h: '0', last_embedded_at: null, first_embedded_at: null, distinct_models: 0 }] });
        }
        throw new Error('relation "embedding_pipeline_state" does not exist');
      },
      release: () => {},
    };
    const res = await embedding.getPipelineState({ connect: () => Promise.resolve(fakeClient) });
    assert.equal(res.available, true);
    assert.deepEqual(res.pipeline_state, {});
  });
});

describe('embedding.getCacheStats', () => {
  it('returns unavailable when redis missing', async () => {
    const res = await embedding.getCacheStats(null, 3600);
    assert.equal(res.available, false);
    assert.match(res.reason, /REDIS_URL/);
  });

  it('returns unavailable for invalid window', async () => {
    const res = await embedding.getCacheStats({ pipeline: () => ({ exec: () => Promise.resolve([]) }) }, 0);
    assert.equal(res.available, false);
  });

  it('aggregates hit/miss counts across redis buckets', async () => {
    const buckets = [
      [null, { hit: '10', miss: '2' }],
      [null, { hit: '5',  miss: '0' }],
      [null, {}],
      [null, { hit: '3', miss: '1' }],
    ];
    const fakePipeline = {
      hgetall: () => {},
      exec: () => Promise.resolve(buckets),
    };
    const fakeRedis = { pipeline: () => fakePipeline };
    const res = await embedding.getCacheStats(fakeRedis, 3600);
    assert.equal(res.available, true);
    assert.equal(res.total_lookups, 21);
    assert.equal(res.cache_hits, 18);
    assert.equal(res.cache_misses, 3);
    assert.equal(res.query_embedding_cache_hit_rate, 18 / 21);
    assert.equal(res.query_embedding_cache_miss_rate, 3 / 21);
  });

  it('returns null rates when no lookups', async () => {
    const fakePipeline = { hgetall: () => {}, exec: () => Promise.resolve([[null, {}], [null, {}]]) };
    const res = await embedding.getCacheStats({ pipeline: () => fakePipeline }, 3600);
    assert.equal(res.total_lookups, 0);
    assert.equal(res.query_embedding_cache_hit_rate, null);
  });
});

describe('embedding.getSemanticP95', () => {
  it('rejects invalid endpoint', async () => {
    await assert.rejects(
      () => embedding.getSemanticP95({}, 'mcp', null, 3600),
      /INVALID_ENDPOINT/
    );
  });

  it('flags alert when p95 > 600ms', async () => {
    const calls = [];
    const pool = {
      query: (sql, params) => {
        calls.push(sql);
        if (sql.includes('FROM monitoring.p95_latency')) {
          return Promise.resolve({ rows: [{ p95_ms: 750, sample_size: 100, window_start: new Date(), window_end: new Date() }] });
        }
        return Promise.resolve({ rows: [{ total: 100, errors_5xx: 0, errors_4xx: 5 }] });
      },
    };
    const res = await embedding.getSemanticP95(pool, 'search', 'sg', 3600);
    assert.equal(res.endpoint, 'search');
    assert.equal(res.market, 'sg');
    assert.equal(res.p95_ms, 750);
    assert.equal(res.err_rate, 0);
    assert.equal(res.alert_triggered, true);
  });

  it('flags alert when err_rate > 0.1%', async () => {
    const pool = {
      query: (sql) => {
        if (sql.includes('FROM monitoring.p95_latency')) {
          return Promise.resolve({ rows: [{ p95_ms: 300, sample_size: 50, window_start: new Date(), window_end: new Date() }] });
        }
        // 5/1000 = 0.5% > 0.1%
        return Promise.resolve({ rows: [{ total: 1000, errors_5xx: 5, errors_4xx: 10 }] });
      },
    };
    const res = await embedding.getSemanticP95(pool, 'similar', null, 3600);
    assert.equal(res.err_rate, 0.005);
    assert.equal(res.alert_triggered, true);
  });

  it('does NOT trigger alert when both metrics healthy', async () => {
    const pool = {
      query: (sql) => {
        if (sql.includes('FROM monitoring.p95_latency')) {
          return Promise.resolve({ rows: [{ p95_ms: 250, sample_size: 50, window_start: new Date(), window_end: new Date() }] });
        }
        // 0/10000 = 0%
        return Promise.resolve({ rows: [{ total: 10000, errors_5xx: 0, errors_4xx: 50 }] });
      },
    };
    const res = await embedding.getSemanticP95(pool, 'search', null, 3600);
    assert.equal(res.alert_triggered, false);
  });
});

describe('embedding.postAlertIncident', () => {
  it('reports not-dispatched when relay missing', async () => {
    const res = await embedding.postAlertIncident({}, { title: 't', description: 'd' });
    assert.equal(res.dispatched, false);
  });

  it('reports not-dispatched when relay url missing', async () => {
    const res = await embedding.postAlertIncident({ apiKey: 'k' }, { title: 't', description: 'd' });
    assert.equal(res.dispatched, false);
    assert.match(res.reason, /alert relay not configured/);
  });

  it('dispatches to relay endpoint and unwraps identifier', async () => {
    const origFetch = global.fetch;
    let calledWith = null;
    global.fetch = async (url, opts) => {
      calledWith = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'abc-123', identifier: 'BUY-99999' }),
        text: async () => '',
      };
    };
    try {
      const res = await embedding.postAlertIncident(
        {
          url: 'https://paperclip.example.com',
          apiKey: 'k',
          companyId: 'co',
          parentIssueId: 'p',
          goalId: 'g',
          assigneeAgentId: 'a',
        },
        { title: '[INCIDENT] p95 breach', description: 'p95=750ms > 600ms' }
      );
      assert.equal(res.dispatched, true);
      assert.equal(res.identifier, 'BUY-99999');
      assert.match(calledWith.url, /\/api\/companies\/co\/issues$/);
      assert.equal(calledWith.opts.method, 'POST');
      const body = JSON.parse(calledWith.opts.body);
      assert.equal(body.priority, 'critical');
      assert.equal(body.assigneeAgentId, 'a');
      assert.equal(body.parentId, 'p');
      assert.match(body.title, /p95 breach/);
    } finally {
      global.fetch = origFetch;
    }
  });

  it('surfaces relay HTTP error', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 502, text: async () => 'Bad Gateway' });
    try {
      const res = await embedding.postAlertIncident(
        { url: 'https://x', apiKey: 'k', companyId: 'co', parentIssueId: 'p', goalId: 'g', assigneeAgentId: 'a' },
        { title: 't', description: 'd' }
      );
      assert.equal(res.dispatched, false);
      assert.match(res.reason, /502/);
    } finally {
      global.fetch = origFetch;
    }
  });
});

describe('embedding.checkAndDispatchAlerts', () => {
  it('returns no incidents when both endpoints healthy', async () => {
    const pool = {
      query: (sql) => {
        if (sql.includes('FROM monitoring.p95_latency')) {
          return Promise.resolve({ rows: [{ p95_ms: 200, sample_size: 10, window_start: new Date(), window_end: new Date() }] });
        }
        return Promise.resolve({ rows: [{ total: 1000, errors_5xx: 0, errors_4xx: 0 }] });
      },
    };
    const res = await embedding.checkAndDispatchAlerts(
      { pool, alertRelay: { url: 'https://x', apiKey: 'k', companyId: 'c', parentIssueId: 'p', goalId: 'g', assigneeAgentId: 'a' } },
      { windowSeconds: 3600 }
    );
    assert.equal(res.evaluated, 2);
    assert.equal(res.triggered_count, 0);
    assert.equal(res.incidents_created, 0);
    assert.deepEqual(res.dispatched, []);
  });

  it('dispatches one incident when one endpoint breaches', async () => {
    let callCount = 0;
    const origFetch = global.fetch;
    global.fetch = async () => {
      callCount += 1;
      return { ok: true, status: 201, json: async () => ({ id: 'x', identifier: 'BUY-1' }), text: async () => '' };
    };
    const pool = {
      query: (sql) => {
        if (sql.includes('FROM monitoring.p95_latency')) {
          // p95>600 for both, but only one alert should be created
          return Promise.resolve({ rows: [{ p95_ms: 800, sample_size: 10, window_start: new Date(), window_end: new Date() }] });
        }
        return Promise.resolve({ rows: [{ total: 1000, errors_5xx: 0, errors_4xx: 0 }] });
      },
    };
    try {
      const res = await embedding.checkAndDispatchAlerts(
        { pool, alertRelay: { url: 'https://x', apiKey: 'k', companyId: 'c', parentIssueId: 'p', goalId: 'g', assigneeAgentId: 'a' } },
        { windowSeconds: 3600 }
      );
      assert.equal(res.triggered_count, 2);
      assert.equal(res.incidents_created, 2);
      assert.equal(callCount, 2);
      assert.ok(res.dispatched.every((d) => d.dispatched === true));
    } finally {
      global.fetch = origFetch;
    }
  });
});

describe('embedding.recordCacheLookup', () => {
  it('skips silently when redis missing', async () => {
    const res = await embedding.recordCacheLookup(null, true);
    assert.equal(res.recorded, false);
  });

  it('increments hit counter on hit', async () => {
    const calls = [];
    const fakeRedis = {
      hincrby: (key, field, n) => { calls.push(['hincrby', key, field, n]); return Promise.resolve(1); },
      expire:  (key, ttl)      => { calls.push(['expire',  key, ttl]); return Promise.resolve(1); },
    };
    const res = await embedding.recordCacheLookup(fakeRedis, true);
    assert.equal(res.recorded, true);
    assert.deepEqual(calls[0], ['hincrby', calls[0][1], 'hit', 1]);
    assert.equal(calls[0][1].startsWith('qembed:stats:60:'), true);
  });

  it('increments miss counter on miss', async () => {
    const calls = [];
    const fakeRedis = {
      hincrby: (key, field, n) => { calls.push([field, n]); return Promise.resolve(1); },
      expire:  () => Promise.resolve(1),
    };
    await embedding.recordCacheLookup(fakeRedis, false);
    assert.equal(calls[0][0], 'miss');
  });
});
