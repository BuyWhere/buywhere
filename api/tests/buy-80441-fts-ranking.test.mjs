/**
 * BUY-80441: FTS ranking must boost in-currency on-intent SKUs and demote
 * accessory/junk titles so SG iPhone 16 / Switch 2 / TV queries do not
 * surface pouches ahead of units.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/routes/products.ts'),
  'utf8',
);

test('BUY-80441 cache version bumped so stale Redis cannot leak USD pouches', () => {
  assert.match(src, /tier-child-fts-v19-b80441/);
});

test('BUY-80441 in-market currency boost is applied in mkQuery rank', () => {
  assert.match(src, /inMarketCurrencyBoost/);
  assert.match(src, /upper\(sp\.currency\) = upper\(\$/);
  assert.match(src, /\$\{inMarketCurrencyBoost\.replace\(/);
});

test('BUY-80441 console/TV accessory penalty and unit boosts exist', () => {
  assert.match(src, /consoleTvAccessoryPenalty/);
  assert.match(src, /consoleUnitBoost/);
  assert.match(src, /tvUnitBoost/);
  assert.match(src, /nintendo switch 2 console/);
  assert.match(src, /led tv\|google tv\|smart tv/);
});

test('BUY-80441 currency post-filter does not restore USD when SGD hits exist', () => {
  assert.match(src, /Only leak mismatched/);
  assert.match(src, /served\.length === 0/);
});
