import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { runFxRefresh } = require('../dist/jobs/fxRefresh');

/** Build a minimal mock Pool whose .query(sql, params) records calls. */
function mockPool(inserted) {
  return {
    query: async (sql, params) => {
      if (sql.toLowerCase().startsWith('insert')) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

describe('BUY-62324 / BUY-52476: fx-refresh from frankfurter + open.er-api', () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('upserts frankfurter rates for supported currencies and open.er-api fallback for VND', async () => {
    const inserted = [];
    globalThis.fetch = async (url) => {
      if (typeof url !== 'string') return new Response('{}', { status: 200 });

      if (url.includes('frankfurter.app')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ base: 'EUR', rates: { USD: 1.08, GBP: 0.85, JPY: 170, SGD: 1.46, MYR: 5.1, THB: 39, IDR: 17500, PHP: 62 } }),
        };
      }

      if (url.includes('open.er-api.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ base: 'EUR', result: 'success', rates: { VND: 27000, INR: 93 } }),
        };
      }

      return { ok: false, status: 404, json: async () => ({}) };
    };

    const result = await runFxRefresh(mockPool(inserted));

    assert.equal(result.success, true);
    assert.equal(result.ratesUpserted, 11); // 10 targets + USD/USD identity
    assert.ok(result.sources.includes('frankfurter'));
    assert.ok(result.sources.includes('open.er-api'));

    const byKey = new Map(inserted.map((r) => [`${r.params[0]}:${r.params[1]}`, r.params]));
    assert.equal(byKey.get('EUR:USD')[2], 1.08);
    assert.equal(byKey.get('EUR:USD')[3], 'frankfurter');
    assert.equal(byKey.get('EUR:VND')[2], 27000);
    assert.equal(byKey.get('EUR:VND')[3], 'open.er-api');
    assert.equal(byKey.has('EUR:INR'), false);
    assert.equal(byKey.get('EUR:EUR')[2], 1);
    assert.equal(byKey.get('EUR:EUR')[3], 'frankfurter');
    assert.equal(byKey.get('USD:USD')[2], 1);
    assert.equal(byKey.get('USD:USD')[3], 'frankfurter');
  });

  it('returns partial success when primary source fails but fallback resolves all targets', async () => {
    const inserted = [];
    globalThis.fetch = async (url) => {
      if (url.includes('frankfurter.app')) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      if (url.includes('open.er-api.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ base: 'EUR', result: 'success', rates: { USD: 1.08, GBP: 0.85, JPY: 170, SGD: 1.46, MYR: 5.1, THB: 39, IDR: 17500, PHP: 62, VND: 27000, INR: 93 } }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const result = await runFxRefresh(mockPool(inserted));

    assert.equal(result.success, true);
    assert.ok(result.sources.includes('frankfurter'));
    assert.ok(result.sources.includes('open.er-api'));
    assert.equal(result.ratesUpserted, 11);
    assert.equal(result.errors.length, 0);
    const sources = new Set(inserted.map((r) => r.params[3]));
    assert.ok(sources.has('open.er-api'));
    assert.ok(sources.has('frankfurter'));
  });
});
