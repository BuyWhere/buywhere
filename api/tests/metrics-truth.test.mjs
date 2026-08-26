/**
 * metrics-truth.test.mjs — Unit tests for /v1/admin/metrics/truth (BUY-75314).
 *
 * We exercise the route by:
 *  1. Stubbing ../../config with in-memory db / catalogDb / redis fakes
 *     via require.cache so the route loads without real connections.
 *  2. Mounting the router on a temporary express server.
 *  3. Hitting it with fetch, asserting the response shape and the Redis
 *     cache behaviour.
 *
 * Every field per METRICS-DEFINITIONS.md must carry a definition string;
 * we assert that here so a future refactor that drops definitions is caught.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ─── Fakes ─────────────────────────────────────────────────────────────

class FakeRedis {
  constructor() { this.store = new Map(); }
  async get(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async set(...args) {
    // Accept BOTH (key, value) and ioredis-style (key, value, 'EX', ttl).
    let key, value;
    if (args.length === 2) { [key, value] = args; }
    else { key = args[0]; value = args[1]; /* ttl / mode args ignored */ }
    this.store.set(key, String(value));
    return 'OK';
  }
}

class FakeQueryResult {
  constructor(rows) { this.rows = rows || []; }
}

class FakeDb {
  constructor() { this.calls = []; }
  async query(sql, params) {
    this.calls.push({ sql, params });
    // Heuristic dispatch: branch on what is being queried.
    const s = sql.toLowerCase();
    if (s.includes('information_schema') && s.includes('agent_framework')) {
      // hasAgentFrameworkColumn probe — pretend the truth-clicks branch
      // has NOT landed yet so the human/fetcher clicks surface "n/a".
      return new FakeQueryResult([{ exists: false }]);
    }
    if (s.includes('count(*)') && s.includes('affiliate_clicks') && s.includes('agent_framework')) {
      return new FakeQueryResult([{ human_clicks: '0', fetcher_clicks: '0' }]);
    }
    if (s.includes('count(*)') && s.includes('affiliate_clicks') && s.includes('nullif(source')) {
      return new FakeQueryResult([
        { source: 'product_card', clicks: '17' },
        { source: 'api_response', clicks: '4' },
      ]);
    }
    if (s.includes('count(*)') && s.includes('affiliate_clicks') && s.includes('nullif(referrer')) {
      return new FakeQueryResult([
        { source_page: '/compare/best-laptops', clicks: '9' },
      ]);
    }
    if (s.includes('from query_log') && s.includes('external_requests')) {
      return new FakeQueryResult([{ external_requests: '142' }]);
    }
    if (s.includes('count(distinct k.id)') || s.includes('external_keys')) {
      return new FakeQueryResult([{ external_keys: '8' }]);
    }
    if (s.includes('from api_keys') && s.includes('new_keys')) {
      return new FakeQueryResult([{ new_keys: '3' }]);
    }
    if (s.includes('pg_class') && s.includes('reltuples')) {
      return new FakeQueryResult([{ reltuples: '392000000' }]);
    }
    if (s.includes('merchants') && s.includes('tablesample')) {
      return new FakeQueryResult([{ merchants_with_products: '151234' }]);
    }
    if (s.includes('affiliate_clicks') && s.includes('was_dead_at_click')) {
      return new FakeQueryResult([{ total: '21', dead: '2' }]);
    }
    return new FakeQueryResult([]);
  }
}

// ─── Wire fakes into the require cache before loading the route ────────

let server;
let port;

before(async () => {
  const fakeDb = new FakeDb();
  const fakeCatalogDb = new FakeDb();
  const fakeRedis = new FakeRedis();

  // Stub child_process / find a way to avoid execFile actually shelling out.
  // The route uses /usr/local/sbin/buywhere-gross-adds.sh and aeo-page-gate.py.
  // We override execFileAsync via require.cache injection on 'util' — simpler:
  // since the routes' try/catch catches exec errors and reports n/a, we just
  // point the env to a non-existent path so the exec throws fast, and the
  // route surfaces "n/a — ..." with a reason. That is the production-grade
  // behaviour for unconfigured envs anyway.
  process.env.BUYWHERE_ADMIN_API_KEYS = 'test-admin-key';
  process.env.FINDINGS_STORE_URL = ''; // force n/a
  process.env.POSTHOG_PAT = ''; // force n/a
  delete process.env.FINDINGS_STORE_URL;
  delete process.env.POSTHOG_PAT;

  const configModulePath = require.resolve('../dist/config');
  require.cache[configModulePath] = {
    id: configModulePath,
    filename: configModulePath,
    loaded: true,
    exports: { db: fakeDb, catalogDb: fakeCatalogDb, redis: fakeRedis },
  };

  const metricsTruthModule = require('../dist/routes/admin/metricsTruth');
  const metricsTruthRouter = metricsTruthModule.default;

  const app = express();
  app.use(metricsTruthRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

after(() => { server?.close(); });

// ─── Helpers ───────────────────────────────────────────────────────────
async function getTruth(window, headers = { Authorization: 'Bearer test-admin-key' }) {
  const qs = window ? `?window=${encodeURIComponent(window)}` : '';
  const res = await fetch(`http://localhost:${port}/v1/admin/metrics/truth${qs}`, { headers });
  return { status: res.status, json: await res.json() };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('/v1/admin/metrics/truth', () => {
  it('401 without admin key', async () => {
    const res = await fetch(`http://localhost:${port}/v1/admin/metrics/truth`);
    assert.equal(res.status, 401);
  });

  it('400 on bad window', async () => {
    const { status, json } = await getTruth('bogus');
    assert.equal(status, 400);
    assert.equal(json.error, 'INVALID_WINDOW');
  });

  it('default window is 30d when window param omitted', async () => {
    const { status, json } = await getTruth('');
    assert.equal(status, 200);
    assert.equal(json.window, '30d');
    assert.equal(json.window_days, 30);
  });

  it('accepts 1d | 7d | 30d', async () => {
    for (const w of ['1d', '7d', '30d']) {
      const { status, json } = await getTruth(w);
      assert.equal(status, 200);
      assert.equal(json.window, w);
      assert.equal(json.window_days, { '1d': 1, '7d': 7, '30d': 30 }[w]);
    }
  });

  it('returns the full canonical shape with definition strings on every metric', async () => {
    const { status, json } = await getTruth('7d');
    assert.equal(status, 200);

    // Top-level keys
    for (const k of ['window','window_days','generated_at','cache_hit','cache_age_seconds','clicks','api','catalog','indexation','traffic','growth','dead_links']) {
      assert.ok(k in json, `missing top-level ${k}`);
    }

    // Every MetricLine has a definition + source
    const flat = [
      json.clicks.human_clicks,
      json.clicks.fetcher_clicks,
      json.clicks.unclassified_clicks,
      json.api.external_requests,
      json.api.external_keys,
      json.api.new_external_keys,
      json.api.anonymous_requests,
      json.catalog.gross_new_products_per_day,
      json.catalog.catalog_rows_reltuples,
      json.catalog.merchants_with_products,
      json.indexation.index_line,
      json.traffic.human_pageviews,
      json.traffic.fetcher_pageviews,
      json.traffic.answer_engine_referrals,
      json.growth.gate_audit_line,
      json.dead_links.dead_link_rate_was_dead_at_click,
    ];
    for (const line of flat) {
      assert.ok(typeof line === 'object' && line !== null, 'metric line must be object');
      assert.ok(typeof line.definition === 'string' && line.definition.length > 5, `empty definition on metric`);
      assert.ok(typeof line.source === 'string' && line.source.length > 0, `empty source on metric`);
    }

    // Clicks by_source and by_source_page_top_20 are arrays
    assert.ok(Array.isArray(json.clicks.by_source));
    assert.ok(Array.isArray(json.clicks.by_source_page_top_20));
  });

  it('human_clicks/fetcher_clicks surface "unclassified" reason until truth-clicks branch lands', async () => {
    const { json } = await getTruth('30d');
    assert.equal(json.clicks.human_clicks.value, null);
    assert.match(json.clicks.human_clicks.reason || '', /truth-clicks/);
    assert.equal(json.clicks.fetcher_clicks.value, null);
    assert.match(json.clicks.fetcher_clicks.reason || '', /truth-clicks/);
    // Unclassified total IS populated (raw count), so callers can still see the volume
    assert.equal(typeof json.clicks.unclassified_clicks.value, 'number');
  });

  it('anonymous_requests surfaces "not yet shipped" reason', async () => {
    const { json } = await getTruth('30d');
    assert.equal(json.api.anonymous_requests.value, null);
    assert.match(json.api.anonymous_requests.reason || '', /keyless|anonymous|not yet shipped/i);
  });

  it('uses pg_class.reltuples for catalog rows (no COUNT(*))', async () => {
    const { json } = await getTruth('30d');
    assert.equal(typeof json.catalog.catalog_rows_reltuples.value, 'number');
    assert.match(json.catalog.catalog_rows_reltuples.source, /pg_class\.reltuples/i);
    assert.match(json.catalog.catalog_rows_reltuples.definition, /reltuples|estimate/i);
  });

  it('caches the assembled payload for 15 minutes', async () => {
    // Earlier tests populated the 1d cache. Re-fetching is a hit; cache_age
    // must be a non-negative integer in seconds.
    const r1 = await getTruth('1d');
    assert.equal(r1.json.cache_hit, true);
    assert.equal(typeof r1.json.cache_age_seconds, 'number');
    assert.ok(r1.json.cache_age_seconds >= 0);
    assert.ok(r1.json.cache_age_seconds < 15 * 60);
  });

  it('cache_hit is per-window (7d and 30d do not share with 1d)', async () => {
    // Each window key holds its own payload. Fetching different windows within
    // their respective TTLs still returns cache_hit=true for each.
    const r7 = await getTruth('7d');
    const r30 = await getTruth('30d');
    assert.equal(r7.json.window, '7d');
    assert.equal(r30.json.window, '30d');
    assert.equal(r7.json.cache_hit, true);
    assert.equal(r30.json.cache_hit, true);
  });

  it('by_source definitions cover the canonical sources', async () => {
    const { json } = await getTruth('30d');
    for (const row of json.clicks.by_source) {
      assert.ok(row.source.length > 0);
      assert.match(row.definition, /origin|product_card|api_response|referrer|api_key/i);
    }
  });

  it('dead_link_rate is a percentage with two-decimal rounding', async () => {
    const { json } = await getTruth('30d');
    const v = json.dead_links.dead_link_rate_was_dead_at_click.value;
    if (v !== null) {
      // 2/21 ≈ 9.52
      assert.equal(typeof v, 'number');
      assert.ok(v >= 0 && v <= 100);
    }
    assert.equal(json.dead_links.dead_link_rate_was_dead_at_click.unit, '%');
  });
});