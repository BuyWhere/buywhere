// v2 deliver_to inference guard (BUY-73952).
//
// Both api.buywhere.ai/mcp and mcp.buywhere.ai/mcp must infer deliver_to from
// country_code when omitted, so agent queries that pass country_code but skip
// deliver_to still get shipping-ranked results. The acceptance gate is 50-cell
// sweep across 5 regions with country_code-only queries: 100% inferred default
// applied. This test catches the source-level contract: each v2 wrapper calls
// inferDeliverTo before requireDeliverTo, and the resulting response carries
// meta.deliver_to_inferred=true.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mcpPath = path.join(__dirname, '..', 'src', 'routes', 'mcp.ts');
const src = readFileSync(mcpPath, 'utf-8');

const V2_HANDLER_NAMES = [
  'handleSearchProductsV2',
  'handleGetDealsV2',
  'handleCompareProductsV2',
  'handleFindBestPriceV2',
  'handleGetProductV2',
];

test('inferDeliverTo helper exists in mcp.ts', () => {
  assert.match(
    src,
    /function\s+inferDeliverTo\s*\(/,
    'inferDeliverTo helper must be declared in routes/mcp.ts',
  );
});

test('inferDeliverTo accepts country_code and country alias', () => {
  assert.match(
    src,
    /inferDeliverTo[\s\S]{0,400}?args\.country_code[\s\S]{0,200}?args\.country/,
    'inferDeliverTo must read args.country_code and fall back to args.country',
  );
});

test('inferDeliverTo returns boolean (true = inference happened)', () => {
  assert.match(
    src,
    /function\s+inferDeliverTo[\s\S]{0,500}?return\s+(true|false)/,
    'inferDeliverTo must return a boolean',
  );
});

test('every v2 wrapper calls inferDeliverTo before requireDeliverTo', () => {
  for (const name of V2_HANDLER_NAMES) {
    const idx = src.indexOf(`async function ${name}`);
    assert.ok(idx >= 0, `${name} not found`);
    // Find the end of the function by scanning forward to the next "async function" or end of file.
    const nextFn = src.indexOf('async function', idx + 30);
    const fnBody = src.slice(idx, nextFn > 0 ? nextFn : idx + 2000);
    const inferIdx = fnBody.indexOf('inferDeliverTo(args)');
    const requireIdx = fnBody.indexOf('requireDeliverTo(args,');
    assert.ok(inferIdx >= 0, `${name} must call inferDeliverTo`);
    assert.ok(requireIdx >= 0, `${name} must call requireDeliverTo`);
    assert.ok(
      inferIdx < requireIdx,
      `${name} must call inferDeliverTo BEFORE requireDeliverTo`,
    );
  }
});

test('each v2 wrapper stamps meta.deliver_to_inferred after handler returns', () => {
  for (const name of V2_HANDLER_NAMES) {
    const idx = src.indexOf(`async function ${name}`);
    assert.ok(idx >= 0, `${name} not found`);
    const nextFn = src.indexOf('async function', idx + 30);
    const fnBody = src.slice(idx, nextFn > 0 ? nextFn : idx + 2000);
    assert.match(
      fnBody,
      /deliver_to_inferred/,
      `${name} must reference meta.deliver_to_inferred when inference happened`,
    );
  }
});

test('VALID_DELIVER_TO still gates inference (no fallback for unsupported codes)', () => {
  // If country_code is "USA" or "ZZ", inference must NOT set deliver_to; instead
  // requireDeliverTo rejects with INVALID_DELIVER_TO. Confirm the helper falls
  // through to requireDeliverTo for unsupported codes.
  const idx = src.indexOf('function inferDeliverTo');
  assert.ok(idx >= 0, 'inferDeliverTo must be declared');
  const fnEnd = src.indexOf('\n}\n', idx);
  assert.ok(fnEnd > idx, 'inferDeliverTo must close');
  const fnBody = src.slice(idx, fnEnd);
  assert.match(
    fnBody,
    /VALID_DELIVER_TO\.has\(normalised\)/,
    'inferDeliverTo must validate against VALID_DELIVER_TO before writing args.deliver_to',
  );
});