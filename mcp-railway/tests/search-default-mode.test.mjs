// BUY-74067: MCP search_products default mode must match REST keyword path.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const srcPath = require.resolve('../src/routes/mcp.ts');
const source = readFileSync(srcPath, 'utf8');

describe('BUY-74067: search_products default mode = keyword', () => {
  it('handler defaults mode to keyword, not hybrid', () => {
    assert.ok(
      /const mode = \(args\.mode as string\) \|\| 'keyword'/.test(source),
      'handleSearchProducts must default mode to keyword'
    );
    assert.ok(
      !/const mode = \(args\.mode as string\) \|\| 'hybrid'/.test(source),
      'must not default mode to hybrid'
    );
  });

  it('v1 and v2 tool schemas default mode to keyword', () => {
    const defaults = [...source.matchAll(/default: '(keyword|hybrid)'/g)].map((m) => m[1]);
    const modeDefaults = [...source.matchAll(/enum: \['keyword', 'semantic', 'hybrid'\][\s\S]{0,280}default: '(keyword|hybrid)'/g)].map((m) => m[1]);
    assert.equal(modeDefaults.length >= 2, true, `expected v1+v2 mode defaults, got ${modeDefaults}`);
    assert.ok(modeDefaults.every((d) => d === 'keyword'), `mode defaults must be keyword, got ${modeDefaults}`);
  });

  it('vector path fails open to keyword FTS when embed fails', () => {
    assert.ok(source.includes('falling back to FTS') || source.includes('fall through to keyword') || source.includes('fall through to tier keyword'));
    assert.ok(source.includes('falling back to FTS'));
  });

  it('v2 search_products_v2 delegates to handleSearchProducts', () => {
    assert.ok(/function handleSearchProductsV2[\s\S]*return handleSearchProducts\(args\)/.test(source)
      || /const result = await handleSearchProducts\(args\)/.test(source));
  });
});
