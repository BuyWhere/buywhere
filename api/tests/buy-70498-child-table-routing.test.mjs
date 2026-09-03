import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function extractSet(src) {
  const m = src.match(/const FAST_CHILD_TABLE_COUNTRIES = new Set\(\[([^\]]+)\]\)/);
  assert.ok(m, 'FAST_CHILD_TABLE_COUNTRIES set not found');
  return m[1].split(',').map((s) => s.replace(/['"\s]/g, '')).filter(Boolean);
}

describe('BUY-70498 child-table routing', () => {
  it('does not route empty SEA child tables for MCP/REST search', () => {
    const mcp = readFileSync(new URL('../src/routes/mcp.ts', import.meta.url), 'utf8');
    const products = readFileSync(new URL('../src/routes/products.ts', import.meta.url), 'utf8');
    for (const src of [mcp, products]) {
      const countries = extractSet(src);
      assert.ok(countries.includes('SG'));
      assert.ok(countries.includes('US'));
      for (const empty of ['TH', 'VN', 'MY', 'ID']) {
        assert.equal(countries.includes(empty), false, empty + ' must use search_products');
      }
    }
    assert.match(mcp, /JOIN \$\{tierTable\} p ON p\.id = pi\.id/);
    assert.doesNotMatch(mcp, /JOIN products p ON p\.id = pi\.id/);
  });
});
