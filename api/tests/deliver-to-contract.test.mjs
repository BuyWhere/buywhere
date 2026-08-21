// deliver_to contract guard (2026-08-06, Richmond directive).
//
// The deliver_to soft contract (Richmond, 2026-07-14) has been silently stripped
// from the MCP tool manifest by fleet branches more than once. Searches without a
// buyer country scan all 300M+ rows across every country, blow the statement
// timeout, and surface as zero-result responses (the Aug-2026 zero-rate spike).
//
// This test fails the build if deliver_to disappears again. DO NOT delete or
// weaken it to make a branch pass — restore the parameter instead.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes', 'mcp.ts'),
  'utf8'
);

test('search_products description mandates deliver_to', () => {
  const m = src.match(/name: 'search_products'[\s\S]{0,600}?description: '([^']+)'/);
  assert.ok(m, 'search_products tool not found in mcp.ts');
  assert.match(m[1], /deliver_to/, 'search_products description must tell agents to pass deliver_to');
});

test('deliver_to param exists on search_products, get_deals, find_best_price', () => {
  for (const tool of ['search_products', 'get_deals', 'find_best_price']) {
    const idx = src.indexOf(`name: '${tool}'`);
    assert.ok(idx >= 0, `${tool} tool not found`);
    const nextTool = src.indexOf("name: '", idx + 10);
    const block = src.slice(idx, nextTool > 0 ? nextTool : idx + 4000);
    assert.match(block, /deliver_to:\s*\{\s*type:\s*'string'/, `${tool} must declare a deliver_to string parameter`);
  }
});

test('handlers give deliver_to precedence over country_code', () => {
  const count = (src.match(/args\.deliver_to as string/g) || []).length;
  assert.ok(count >= 4, `expected deliver_to precedence in >=4 handler sites, found ${count}`);
});
