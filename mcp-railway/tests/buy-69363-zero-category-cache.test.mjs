// BUY-69363: zero-count categories are a degradation signal, not a cacheable
// healthy response. This guards the admission rule without requiring a DB/Redis.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve('../src/routes/mcp.ts'), 'utf8');

describe('BUY-69363 category fallback cache admission', () => {
  it('marks all-zero category rows unavailable', () => {
    assert.match(source, /const allCountsZero = rows\.every\(\(row\) => Number\(row\.product_count\) === 0\);/);
    assert.match(source, /meta\.unavailable = allCountsZero;/);
  });

  it('never writes an all-zero category response to the ten-minute cache', () => {
    const fallbackBlock = source.match(/const allCountsZero[\s\S]*?return data;/);
    assert.ok(fallbackBlock, 'expected all-zero category finalization block');
    assert.match(fallbackBlock[0], /if \(!allCountsZero\) \{[\s\S]*redis\.set\(cacheKey/);
  });
});
