// BUY-65693: regression tests for the sentinel-price guard in mcp-railway JSON-RPC tools.
// The BuyWhere ingest pipeline writes `1` as a placeholder when the merchant page
// had no parseable price (BUY-52807 root cause). Without the guard, AI agents
// reading the JSON-RPC response would format that `1` as `.00`. The sentinel
// helpers substitute the `price` field with a "see merchant" hint string so
// clients render the correct user-facing copy.
//
// These tests pin the contract of:
//   - isSentinelPrice: classifies amounts as sentinel
//   - formatPriceField: returns string when sentinel, {amount,currency} otherwise
//   - formatSimilarPriceField: same shape; intended for find_similar's flat shape

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  isSentinelPrice,
  formatPriceField,
  formatSimilarPriceField,
  PRICE_SENTINEL_MIN,
  PRICE_UNAVAILABLE_TEXT,
} = require('../dist/lib/response');

describe('sentinel-price guard (BUY-65693)', () => {
  describe('isSentinelPrice', () => {
    it('flags amount=1 (the actual ingest placeholder) as sentinel', () => {
      assert.equal(isSentinelPrice(1), true);
    });

    it('flags amount=0 as sentinel', () => {
      assert.equal(isSentinelPrice(0), true);
    });

    it('flags amount=9.99 as sentinel (just below the threshold)', () => {
      assert.equal(isSentinelPrice(9.99), true);
    });

    it('flags null as sentinel', () => {
      assert.equal(isSentinelPrice(null), true);
    });

    it('flags undefined as sentinel', () => {
      assert.equal(isSentinelPrice(undefined), true);
    });

    it('flags NaN as sentinel', () => {
      assert.equal(isSentinelPrice(NaN), true);
    });

    it('flags Infinity as sentinel', () => {
      assert.equal(isSentinelPrice(Infinity), true);
    });

    it('flags strings as sentinel (defensive — DB returns text columns)', () => {
      assert.equal(isSentinelPrice('1'), true);
      assert.equal(isSentinelPrice('not a price'), true);
    });

    it('does NOT flag amount=PRICE_SENTINEL_MIN (boundary, inclusive)', () => {
      assert.equal(isSentinelPrice(PRICE_SENTINEL_MIN), false);
    });

    it('does NOT flag amount=10.01 (just above threshold)', () => {
      assert.equal(isSentinelPrice(10.01), false);
    });

    it('does NOT flag normal prices', () => {
      assert.equal(isSentinelPrice(99.99), false);
      assert.equal(isSentinelPrice(1234.5), false);
    });
  });

  describe('formatPriceField (BUY-65685, search/get_product/find_best_price)', () => {
    it('returns the sentinel string when amount is sentinel', () => {
      const result = formatPriceField(1, 'SGD');
      assert.equal(result, PRICE_UNAVAILABLE_TEXT);
      assert.equal(typeof result, 'string');
    });

    it('returns {amount, currency} when amount is normal', () => {
      const result = formatPriceField(99.99, 'SGD');
      assert.deepEqual(result, { amount: 99.99, currency: 'SGD' });
      assert.equal(typeof result, 'object');
    });

    it('returns sentinel string when amount is null', () => {
      assert.equal(formatPriceField(null, 'USD'), PRICE_UNAVAILABLE_TEXT);
    });

    it('preserves the currency string in the structured branch', () => {
      const result = formatPriceField(50, 'THB');
      assert.equal(typeof result, 'object');
      assert.equal(result.currency, 'THB');
      assert.equal(result.amount, 50);
    });
  });

  describe('formatSimilarPriceField (BUY-65693, find_similar flat shape)', () => {
    it('returns the sentinel string when amount is sentinel', () => {
      const result = formatSimilarPriceField(1, 'SGD');
      assert.equal(result, PRICE_UNAVAILABLE_TEXT);
      assert.equal(typeof result, 'string');
    });

    it('returns {amount, currency} when amount is normal', () => {
      const result = formatSimilarPriceField(99.99, 'USD');
      assert.deepEqual(result, { amount: 99.99, currency: 'USD' });
      assert.equal(typeof result, 'object');
    });

    it('returns sentinel string when amount is null', () => {
      const result = formatSimilarPriceField(null, 'USD');
      assert.equal(result, PRICE_UNAVAILABLE_TEXT);
      assert.equal(typeof result, 'string');
    });

    it('preserves currency in the structured branch', () => {
      const result = formatSimilarPriceField(250, 'MYR');
      assert.equal(typeof result, 'object');
      assert.equal(result.currency, 'MYR');
      assert.equal(result.amount, 250);
    });

    it('boundary: amount=10 (PRICE_SENTINEL_MIN) is NOT sentinel', () => {
      const result = formatSimilarPriceField(10, 'SGD');
      assert.equal(typeof result, 'object');
      assert.equal(result.amount, 10);
    });

    it('matches the documented PRICE_UNAVAILABLE_TEXT exactly', () => {
      // Pin the wording so we catch accidental copy edits that would
      // change the AI-agent user-facing copy across all MCP tools.
      assert.equal(
        formatSimilarPriceField(1, 'SGD'),
        'see merchant (price unavailable in catalog) — click through to confirm',
      );
    });
  });
});
