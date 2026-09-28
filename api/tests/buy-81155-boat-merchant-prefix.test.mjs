import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes', 'products.ts');
const src = readFileSync(root, 'utf8');

test('BUY-81155 US search fences prefixed Shopify merchant_ids for boat/datablitz', () => {
  assert.match(src, /NOT ILIKE '%boat-lifestyle\.com%'/);
  assert.match(src, /NOT ILIKE '%boat_lifestyle_com%'/);
  assert.match(src, /NOT ILIKE '%datablitz\.com\.ph%'/);
  assert.ok((src.match(/NOT ILIKE '%boat_lifestyle_com%'/g) || []).length >= 2);
});
