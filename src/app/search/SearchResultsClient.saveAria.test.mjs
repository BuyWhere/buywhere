// BUY-84243 / BUY-82212: search product cards must expose a named save/wishlist
// control so axe `button-name` does not flag the icon-only bookmark button.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const searchSource = readFileSync(resolve(here, 'SearchResultsClient.tsx'), 'utf8');
const wishlistSource = readFileSync(
  resolve(here, '../../components/WishlistButton.tsx'),
  'utf8'
);

test('BUY-84243: SearchCard mounts WishlistButton', () => {
  assert.match(searchSource, /import WishlistButton from '@\/components\/WishlistButton'/);
  assert.match(searchSource, /<WishlistButton[\s\S]*product=\{\{/);
});

test('BUY-84243: WishlistButton icon control has aria-label and aria-pressed', () => {
  assert.match(wishlistSource, /aria-label=\{label\}/);
  assert.match(wishlistSource, /aria-pressed=\{active\}/);
  assert.match(wishlistSource, /Save \$\{product\.name\} to wishlist/);
});
