// deliver_to contract guard (2026-08-06, Richmond directive; updated 2026-08-19
// for BUY-71817 / P2.7 v2 surface).
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

// Anchor: the v2 surface description explicitly tells agents to pass deliver_to.
// Look at the full tool object (multi-line manifest) for any string mentioning
// "deliver_to" + "always" / "ALWAYS" so the description stays directive across
// P2.7 edits.
test('search_products description tells agents to pass deliver_to', () => {
  const idx = src.indexOf("name: 'search_products'");
  assert.ok(idx >= 0, 'search_products tool not found in mcp.ts');
  const block = src.slice(idx, idx + 4000);
  assert.match(
    block,
    /ALWAYS pass this/i,
    'search_products description must tell agents to pass deliver_to (BUY-71817)'
  );
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

// Pre-P2.7, deliver_to precedence was duplicated inline in 4+ handler sites
// (search_products, get_deals, find_best_price, normalizeMcpMarket). The P2.7
// parity fix routes search_products through the same precedence chain via
// `args.deliver_to as string` checks — the count is now smaller but the
// contract is enforced by `args.deliver_to || args.country_code || args.country`
// in 4 places (search_products, get_deals via normalizeMcpMarket,
// find_best_price via normalizeMcpMarket, normalizeMcpMarket itself).
test('handlers give deliver_to precedence over country_code', () => {
  // Each precedence chain is `args.deliver_to || args.country_code || args.country`
  // (or as-string variants). Count both patterns to cover both inline + helper.
  const inline = (src.match(/args\.deliver_to[^|]+\|\|[^|]*args\.country_code/g) || []).length;
  const helper = (src.match(/args\.deliver_to as string/g) || []).length;
  assert.ok(
    inline + helper >= 3,
    `expected deliver_to precedence in >=3 sites (inline ${inline} + helper ${helper})`
  );
});

// BUY-71817 / P2.7: the v2 surface must reject calls missing deliver_to. This
// is enforced inside dispatchTool via the V2_DELIVER_TO_TOOLS set + the
// -32602 throw with INVALID_ARGUMENT prefix.
test('v2 gate rejects missing deliver_to with INVALID_ARGUMENT', () => {
  assert.match(
    src,
    /V2_DELIVER_TO_TOOLS\.has\(name\)\s*&&\s*args\.api_version\s*===\s*'v2'/,
    'v2 gate must run inside dispatchTool'
  );
  assert.match(
    src,
    /INVALID_ARGUMENT: deliver_to is REQUIRED on api_version=v2/,
    'v2 gate must throw INVALID_ARGUMENT'
  );
});
