import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/routes/products.ts', import.meta.url), 'utf8');

test('products featured route is declared before product id route', () => {
  const featuredIndex = source.indexOf("router.get(\n  '/featured'");
  const idIndex = source.indexOf("router.get(\n  '/:id'");

  assert.notEqual(featuredIndex, -1, 'missing /featured route');
  assert.notEqual(idIndex, -1, 'missing /:id route');
  assert.ok(featuredIndex < idIndex, '/featured must be declared before /:id');
});
