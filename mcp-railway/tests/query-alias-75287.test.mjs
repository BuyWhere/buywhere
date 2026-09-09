// BUY-75287: regression test for the `query` alias for `q` in search_products.
//
// Atlas cycle 23 (2026-08-26T01:24Z) called search_products with `query=…` and
// mcp.buywhere.ai/mcp silently fell into the no-q browse branch, returning
// the pg_class.reltuples-derived "total" (~364,777,600) with 0 rows on
// `api.buywhere.ai/mcp`, plus a 5-row TH same-result fingerprint on
// `mcp.buywhere.ai/mcp`. Both surfaces must accept `query` as a `q` alias
// and run the real FTS path.
//
// This is a static-source test — cheaper than spinning up the service — so it
// also doubles as a guard against future refactors silently dropping the
// alias again. BUY-68587 / BUY-70288 both shipped this exact alias and both
// were removed by intervening refactors; this guard prevents a third round.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const srcPath = require.resolve('../src/routes/mcp.ts');
const source = readFileSync(srcPath, 'utf8');

function schemaFor(toolName) {
  const re = new RegExp(`name:\\s*['"]${toolName}['"][\\s\\S]*?(?=\\n  \\{\\n    name:)`, 'm');
  const block = source.match(re);
  assert.ok(block, `could not locate ${toolName} tool block`);
  return block[0];
}

describe('search_products `query` alias for `q` (BUY-75287)', () => {
  it('handler accepts `args.query` when `args.q` is missing', () => {
    const matches = source.match(
      /\(args\.q as string\)\s*\|\|\s*\(args\.query as string\)\s*\|\|\s*''\s*\)/m,
    );
    assert.ok(matches, 'handler should fall through `args.query` when `args.q` is missing');
  });

  it('inputSchema documents the `query` alias on v1 search_products', () => {
    const block = schemaFor('search_products');
    assert.ok(
      /query:\s*\{\s*type:\s*['"]string['"]/.test(block),
      'v1 search_products inputSchema should advertise the `query` alias',
    );
  });

  it('inputSchema documents the `query` alias on v2 search_products_v2', () => {
    const block = schemaFor('search_products_v2');
    assert.ok(
      /query:\s*\{\s*type:\s*['"]string['"]/.test(block),
      'v2 search_products_v2 inputSchema should advertise the `query` alias',
    );
  });
});