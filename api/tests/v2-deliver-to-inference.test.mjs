// v2 deliver_to inference guard — api.buywhere.ai/mcp tree (BUY-73952).
//
// Both endpoints (api.buywhere.ai/mcp and mcp.buywhere.ai/mcp) must infer
// deliver_to from country_code when omitted. The acceptance gate is a 50-cell
// sweep across 5 regions with country_code-only queries: 100% inferred default
// applied. This test catches the source-level contract for the api tree.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mcpPath = path.join(__dirname, '..', 'src', 'routes', 'mcp.ts');
const productsPath = path.join(__dirname, '..', 'src', 'routes', 'products.ts');
const mcpSrc = readFileSync(mcpPath, 'utf-8');
const productsSrc = readFileSync(productsPath, 'utf-8');

const V2_HANDLER_NAMES = [
  'handleSearchProductsV2',
  'handleGetDealsV2',
  'handleCompareProductsV2',
  'handleFindBestPriceV2',
  'handleGetProductV2',
];

test('api inferDeliverTo helper exists in routes/mcp.ts', () => {
  assert.match(
    mcpSrc,
    /function\s+inferDeliverTo\s*\(/,
    'inferDeliverTo helper must be declared in api routes/mcp.ts',
  );
});

test('api every v2 wrapper calls inferDeliverTo before requireDeliverTo', () => {
  for (const name of V2_HANDLER_NAMES) {
    const idx = mcpSrc.indexOf(`async function ${name}`);
    assert.ok(idx >= 0, `${name} not found in api routes/mcp.ts`);
    const nextFn = mcpSrc.indexOf('async function', idx + 30);
    const fnBody = mcpSrc.slice(idx, nextFn > 0 ? nextFn : idx + 2500);
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

test('api each v2 wrapper stamps meta.deliver_to_inferred', () => {
  for (const name of V2_HANDLER_NAMES) {
    const idx = mcpSrc.indexOf(`async function ${name}`);
    assert.ok(idx >= 0, `${name} not found in api routes/mcp.ts`);
    const nextFn = mcpSrc.indexOf('async function', idx + 30);
    const fnBody = mcpSrc.slice(idx, nextFn > 0 ? nextFn : idx + 2500);
    assert.match(
      fnBody,
      /deliver_to_inferred/,
      `${name} must reference meta.deliver_to_inferred when inference happened`,
    );
  }
});

test('REST /v1/products/search infers deliver_to from country_code', () => {
  // products.ts parses country_code/deliver_to; if deliver_to is missing and
  // country_code is present, deliverTo must be set from country_code.
  assert.match(
    productsSrc,
    /deliverToInferred/,
    'products.ts must track deliverToInferred flag',
  );
  assert.match(
    productsSrc,
    /deliverTo\s*=\s*explicitDeliverTo\s*\|\|\s*\(deliverToInferred\s*\?\s*countryCode/,
    'products.ts must compute deliverTo from explicitDeliverTo OR inferred countryCode',
  );
});

test('REST annotateDeliverTo accepts inferred flag and stamps meta.deliver_to_inferred', () => {
  assert.match(
    productsSrc,
    /function\s+annotateDeliverTo\([^)]*inferred\s*=\s*false\)/,
    'annotateDeliverTo must accept inferred=false default parameter',
  );
  assert.match(
    productsSrc,
    /inferred\)\s*meta\.deliver_to_inferred\s*=\s*true/,
    'annotateDeliverTo must stamp meta.deliver_to_inferred=true when inferred=true',
  );
});

test('REST /v1/products/deals also infers deliver_to from country_code', () => {
  // deals handler lives at the bottom of products.ts and has its own deliverTo parsing.
  const dealsIdx = productsSrc.indexOf("'/deals',");
  assert.ok(dealsIdx >= 0, '/deals route not found');
  const nextRoute = productsSrc.indexOf("router.get(\n", dealsIdx + 10);
  const dealsBody = productsSrc.slice(dealsIdx, nextRoute > 0 ? nextRoute : dealsIdx + 5000);
  assert.match(
    dealsBody,
    /deliverToInferred\s*=\s*!deliverTo\s*&&\s*\!\!countryCode/,
    '/deals must compute deliverToInferred when deliver_to is omitted but country_code present',
  );
  assert.match(
    dealsBody,
    /effectiveDeliverTo/,
    '/deals must use effectiveDeliverTo (explicit OR inferred) when annotating',
  );
});