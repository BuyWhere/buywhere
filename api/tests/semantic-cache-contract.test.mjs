// Semantic-cache contract guard (2026-08-06, Richmond directive).
//
// This capability has been started and silently lost by fleet branches multiple
// times. This test fails the build if the semantic cache module or its wiring
// disappears from EITHER code tree. DO NOT delete or weaken it to make a branch
// pass — restore the integration instead.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const trees = {
  api: join(here, '..', 'src'),
  'mcp-railway': join(here, '..', '..', 'mcp-railway', 'src'),
};

for (const [name, src] of Object.entries(trees)) {
  test(`${name}: semanticCache module exists with threshold + scope safety`, () => {
    const mod = readFileSync(join(src, 'lib', 'semanticCache.ts'), 'utf8');
    assert.match(mod, /SIM_THRESHOLD = 0\.8[5-9]/, 'similarity threshold must stay in the calibrated 0.85-0.89 band');
    assert.match(mod, /semanticLookup/, 'lookup export missing');
    assert.match(mod, /semanticRegister/, 'register export missing');
    assert.match(mod, /SEMANTIC_CACHE/, 'kill switch missing');
  });

  test(`${name}: products route wires lookup AND register`, () => {
    const route = readFileSync(join(src, 'routes', 'products.ts'), 'utf8');
    assert.match(route, /semanticLookup|semLookup/, `${name} lookup not wired`);
    assert.match(route, /semanticRegister|semRegister/, `${name} register not wired`);
    assert.match(route, /HIT-SEMANTIC/, `${name} semantic hit marker missing`);
  });
}
