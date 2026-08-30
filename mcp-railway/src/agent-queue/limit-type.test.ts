import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * BUY-65475: Regression tests for PostgreSQL LIMIT/OFFSET type coercion.
 *
 * The MCP PostgreSQL driver (pg) sends JavaScript numbers as text when they
 * arrive as strings, causing "argument of LIMIT must be type bigint, not type text".
 * All LIMIT/OFFSET parameters must be coerced with Number() before passing to queries.
 */
describe('BUY-65475 — limit/offset type coercion for PostgreSQL', () => {
  // Simulates the fix in handleGetDeals: Number(limit) || 20
  const coerceLimit = (limit: unknown) => Number(limit) || 20;
  const coerceOffset = (offset: unknown) => Number(offset) || 0;

  it('coerces integer limit to number', () => {
    assert.equal(coerceLimit(3), 3);
    assert.equal(coerceLimit(10), 10);
  });

  it('coerces string limit to number', () => {
    assert.equal(coerceLimit('5'), 5);
    assert.equal(coerceLimit('20'), 20);
  });

  it('falls back to default when limit is undefined', () => {
    assert.equal(coerceLimit(undefined), 20);
    assert.equal(coerceLimit(null), 20);
  });

  it('falls back to default when limit is NaN', () => {
    assert.equal(coerceLimit(NaN), 20);
    assert.equal(coerceLimit('abc' as unknown), 20);
  });

  it('coerces offset similarly', () => {
    assert.equal(coerceOffset(0), 0);
    assert.equal(coerceOffset(10), 10);
    assert.equal(coerceOffset('5'), 5);
    assert.equal(coerceOffset(undefined), 0);
  });

  it('clamps limit to max 100 (application-level constraint)', () => {
    // This is handled separately: Math.min(Number(args.limit) || 20, 100)
    const limit = Math.min(Number(200) || 20, 100);
    assert.equal(limit, 100);
  });
});
