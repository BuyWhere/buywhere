// BUY-70963: sparse regional markets (MY/VN/TH) had default search_products
// calls timing out / returning empty because the hybrid path cold-reads many
// heap pages before producing region-matching ids. This guard ensures the
// default mode routes to keyword for those markets while still honoring
// explicit caller intent, and that poisoned market-scoped cache entries are
// ignored and deleted.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve('../src/routes/mcp.ts'), 'utf8');

describe('BUY-70963 sparse-market default mode + poison cache guard', () => {
  it('introduces sparse-market default keyword routing', () => {
    assert.match(source, /const sparseKeywordDefaultMarkets = new Set\(\['MY', 'VN', 'TH'\]\);/);
  });

  it('classifies explicit caller intent separately from default mode', () => {
    assert.match(source, /const requestedMode = typeof args\.mode === 'string' \? args\.mode\.toLowerCase\(\) : '';/);
    assert.match(source, /const explicitMode = \['keyword', 'hybrid', 'semantic'\]\.includes\(requestedMode\);/);
  });

  it('routes default sparse-market queries to keyword and keeps explicit hybrid', () => {
    const effectiveModeBlock = source.match(/const effectiveMode = explicitMode[\s\S]*?;(?=\s*const useVector)/);
    assert.ok(effectiveModeBlock, 'expected effectiveMode block');
    assert.match(effectiveModeBlock[0], /sparseKeywordDefaultMarkets\.has\(country\.toUpperCase\(\)\) \? 'keyword' : 'hybrid'/);
    assert.match(effectiveModeBlock[0], /q && country &&/);
  });

  it('useVector depends on effectiveMode, not the raw default', () => {
    const useVectorBlock = source.match(/const useVector = vectorDb != null && geminiKey !== '' && q !== '' && effectiveMode !== 'keyword';/);
    assert.ok(useVectorBlock, 'expected useVector to depend on effectiveMode');
  });

  it('cache key uses effective mode so default sparse-market calls do not share hybrid entries', () => {
    const cacheKeyLine = source.match(/const cacheKey = `fts:v2:[\s\S]*?`;/);
    assert.ok(cacheKeyLine, 'expected cacheKey literal');
    assert.match(cacheKeyLine[0], /useVector \? effectiveMode : 'kw'/);
  });

  it('semantic path branch uses effectiveMode', () => {
    const semanticBranch = source.match(/if \(effectiveMode === 'semantic'\) \{/);
    assert.ok(semanticBranch, 'expected semantic branch to use effectiveMode');
  });

  it('ignores poisoned market-scoped search cache entries and deletes them', () => {
    const guardBlock = source.match(/const poisonedMarketSearchCache = q && \(country \|\| region\)[\s\S]*?redis\.del\(cacheKey\)/);
    assert.ok(guardBlock, 'expected poisoned search cache guard with delete');
    assert.match(guardBlock[0], /Number\(parsed\.total\) > 0/);
    assert.match(guardBlock[0], /parsed\.results\.length === 0/);
    assert.match(guardBlock[0], /parsed\.data\.length === 0/);
  });

  it('does not poison the cache key by rejoining the no-results fast path', () => {
    // After the poison guard, only the unpoisoned fast path should still return cached data.
    const fastPath = source.match(/const cached = await redis\.get\(cacheKey\);[\s\S]*?\} catch \(_\) \{ \/\* redis miss — proceed \*\/\ \}/);
    assert.ok(fastPath, 'expected Redis fast path block');
    assert.match(fastPath[0], /if \(poisonedMarketSearchCache\) \{[\s\S]*\} else if \(parsed\.results\) \{/);
  });

  it('self-heals stale all-zero category cache entries on read', () => {
    const categoryPoison = source.match(/const poisonedCategoryCache = parsed\?\.meta\?\.unavailable === true[\s\S]*?} else \{/);
    assert.ok(categoryPoison, 'expected category poison guard');
    assert.match(categoryPoison[0], /parsed\.data\.every\(\(row: \{ product_count\?: unknown \}\) => Number\(row\.product_count\) === 0\)/);
    assert.match(categoryPoison[0], /redis\.del\(cacheKey\)/);
  });
});
