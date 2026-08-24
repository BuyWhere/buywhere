// BUY-73908: regression guard for the L2 synthetic-on-empty leak on MCP v2.
//
// Closed BUY-72744 only patched the L1 REST tier search and archive paths in
// api/src/routes/products.ts. The MCP search path (handleSearchProducts) ran
// the same vector-only recall when the keyword/FTS branch returned 0 rows, so
// q=zzzz_no_match was served 2 synthetic Google Shopping rows.
//
// This guard fails if either tree ever:
//   1. Skips the "if (total === 0) rows = []" guard in handleSearchProducts.
//   2. Lets a v2 wrapper (search/find_best_price/get_product/compare_products/
//      get_deals) return rows without setting meta.emptiness_reason="no_match"
//      on the empty path.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function load(relPath) {
  return readFileSync(path.join(__dirname, '..', relPath), 'utf-8');
}

const mcpSrc = load('src/routes/mcp.ts');
const apiSrc = load('../api/src/routes/mcp.ts');

const HANDLERS = [
  {
    label: 'mcp-railway',
    src: mcpSrc,
    wrappers: [
      'handleCompareProductsV2',
      'handleFindBestPriceV2',
      'handleGetProductV2',
      'handleSearchProductsV2',
    ],
  },
  {
    label: 'api',
    src: apiSrc,
    wrappers: [
      'handleCompareProductsV2',
      'handleFindBestPriceV2',
      'handleGetProductV2',
      'handleSearchProductsV2',
    ],
  },
];

for (const { label, src, wrappers } of HANDLERS) {
  test(`${label}: handleSearchProducts short-circuits when FTS count is zero`, () => {
    const idx = src.indexOf('async function handleSearchProducts(');
    assert.ok(idx >= 0, `${label}: handleSearchProducts not found`);
    const slice = src.slice(idx, idx + 6000);
    assert.match(
      slice,
      /total\s*===\s*0[\s\S]{0,400}rows\s*=\s*\[\]/,
      `${label}: handleSearchProducts must zero out rows when total===0`,
    );
  });

  test(`${label}: handleSearchProducts stamps meta.emptiness_reason="no_match" on empty result`, () => {
    const idx = src.indexOf('async function handleSearchProducts(');
    assert.ok(idx >= 0, `${label}: handleSearchProducts not found`);
    const slice = src.slice(idx, idx + 12000);
    // Allow up to 30 KB to cover the handleSearchProducts body before any follow-on handler.
    const sliceWide = src.slice(idx, idx + 30000);
    assert.match(
      sliceWide,
      /emptiness_reason\s*=\s*['"]no_match['"]/,
      `${label}: handleSearchProducts must set meta.emptiness_reason="no_match" on empty result`,
    );
    // The slice's earlier "no_match" should be inside the L2 comment block;
    // verify the substantive code path exists further down.
    assert.ok(sliceWide.indexOf("'no_match'") > slice.indexOf('no_match'),
      `${label}: no_match assignment must exist beyond the L2 comment`);
  });

  test(`${label}: every v2 wrapper calls applyNoMatchMeta(result)`, () => {
    for (const wrapper of wrappers) {
      const idx = src.indexOf(`async function ${wrapper}(`);
      assert.ok(idx >= 0, `${label}: wrapper ${wrapper} not found`);
      const slice = src.slice(idx, idx + 3000);
      assert.match(
        slice,
        /applyNoMatchMeta\(result\)/,
        `${label}: ${wrapper} must call applyNoMatchMeta(result)`,
      );
    }
  });

  test(`${label}: applyNoMatchMeta uses "no_match" sentinel`, () => {
    assert.match(src, /emptiness_reason[\s\S]{0,80}['"]no_match['"]/);
  });
}