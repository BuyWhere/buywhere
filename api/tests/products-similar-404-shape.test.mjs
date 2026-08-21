// BUY-72361 — REST /v1/products/{id}/similar must return a structured 404 with
// code NOT_FOUND when the product has no embedding or the vector DB is unavailable,
// matching the MCP find_similar -32001 envelope. The prior 504-after-10s failure
// mode is the wrong contract — clients burnt the latency budget on a problem
// the MCP surface already answers in <100ms.
//
// This test asserts the source contract by reading the route module directly:
// a) the 10s setTimeout is gone,
// b) the 404 NOT_FOUND body shape is wired,
// c) the OpenAPI document advertises /products/{id}/similar with 404.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const productsSource = readFileSync(new URL('../src/routes/products.ts', import.meta.url), 'utf8');
const wellknownSource = readFileSync(new URL('../src/routes/wellknown.ts', import.meta.url), 'utf8');
const adminEmbeddingsSource = readFileSync(new URL('../src/routes/admin/embeddings.ts', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');

test('products.similar: no 10s setTimeout remains in the similar handler', () => {
  // Scope: only check inside the GET /:id/similar handler, not the search
  // handler at line 544 which keeps its own setTimeout(SEARCH_HANDLER_TIMEOUT_MS).
  const similarStart = productsSource.indexOf("router.get(\n  '/:id/similar'");
  assert.notEqual(similarStart, -1, 'missing /:id/similar route');
  const similarEnd = productsSource.indexOf(");\n\n// GET /v1/products/featured", similarStart);
  assert.notEqual(similarEnd, -1, 'could not find end of /:id/similar handler');
  const similarBlock = productsSource.slice(similarStart, similarEnd);
  assert.equal(
    similarBlock.includes('res.setTimeout(SEARCH_HANDLER_TIMEOUT_MS'),
    false,
    'setTimeout-driven 504 must be removed from products.similar handler'
  );
  assert.equal(
    similarBlock.includes('status(504)'),
    false,
    'no 504 path may remain in the /:id/similar handler'
  );
});

test('products.similar: returns 404 NOT_FOUND when embedding is missing', () => {
  // Scope to the similar handler block so other handlers don't satisfy the regex.
  const similarStart = productsSource.indexOf("router.get(\n  '/:id/similar'");
  const similarEnd = productsSource.indexOf(");\n\n// GET /v1/products/featured", similarStart);
  const similarBlock = productsSource.slice(similarStart, similarEnd);
  assert.match(
    similarBlock,
    /notFoundReason\s*=\s*['"`]No embedding found for this product/,
    'handler must set notFoundReason to the canonical MCP message'
  );
  assert.match(
    similarBlock,
    /status\(404\)\.json\(\{[\s\S]*?error:\s*'Not Found'[\s\S]*?code:\s*'NOT_FOUND'[\s\S]*?message:/,
    'handler must return 404 with { error: Not Found, code: NOT_FOUND, message, meta }'
  );
});

test('products.similar: vector DB query is raced against an explicit timeout', () => {
  const similarStart = productsSource.indexOf("router.get(\n  '/:id/similar'");
  const similarEnd = productsSource.indexOf(");\n\n// GET /v1/products/featured", similarStart);
  const similarBlock = productsSource.slice(similarStart, similarEnd);
  assert.match(
    similarBlock,
    /withTimeout\s*\(\s*vectorDb\.query/,
    'embedding lookup must be wrapped with withTimeout('
  );
  assert.match(
    similarBlock,
    /withTimeout\s*\(\s*vectorDb\.query<[\s\S]*?KNN/s,
    'KNN query must be wrapped with withTimeout('
  );
});

test('openapi: /products/{id}/similar is documented with 404 response', () => {
  assert.match(
    wellknownSource,
    /'\/products\/\{id\}\/similar':\s*\{/,
    'openapi spec must declare /products/{id}/similar'
  );
  assert.match(
    wellknownSource,
    /operationId:\s*'findSimilarProducts'/,
    'openapi spec must define operationId findSimilarProducts'
  );
  assert.match(
    wellknownSource,
    /summary:\s*'Find products similar to a given product/,
    'openapi spec must include the similar summary'
  );
  // 404 must be in the documented responses — find the next ',\n      }' boundary.
  const idx = wellknownSource.indexOf("'/products/{id}/similar'");
  const tail = wellknownSource.slice(idx);
  assert.match(tail, /'404':/, '404 response must be documented');
  assert.match(tail, /NOT_FOUND/, '404 response must mention NOT_FOUND');
});

test('admin: /v1/admin/embeddings/coverage endpoint exists and is wired', () => {
  assert.match(
    adminEmbeddingsSource,
    /router\.get\(['"`]\/v1\/admin\/embeddings\/coverage['"`]/,
    'coverage endpoint must be registered'
  );
  assert.match(
    adminEmbeddingsSource,
    /adminAuth/,
    'coverage endpoint must require admin auth'
  );
  assert.match(
    adminEmbeddingsSource,
    /pct_of_active/,
    'response shape must include coverage.pct_of_active'
  );
  assert.match(
    serverSource,
    /adminEmbeddingsRouter/,
    'server.ts must import and mount the new admin router'
  );
});
