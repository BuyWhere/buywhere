import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/routes/compareSlug.ts', import.meta.url), 'utf8');
const compiled = readFileSync(new URL('../dist/routes/compareSlug.js', import.meta.url), 'utf8');

test('/v1/compare/:slug falls back to category payload before 404', () => {
  assert.match(source, /buildCategoryComparePayload\(slug, req\)/);
  assert.match(source, /LOWER\(REGEXP_REPLACE\(category_path\[1\]/);
  assert.match(source, /prices:\s*\[/);
  assert.match(source, /in_stock: row\.is_active !== false/);
});

test('SEA compare category requests match stored SG product regions', () => {
  assert.match(source, /if \(lower === 'sea'\) return \['sea', 'sg', 'singapore'\];/);
  assert.match(source, /LOWER\(region\) = ANY/);
  assert.match(compiled, /return \['sea', 'sg', 'singapore'\];/);
});
