// BUY-81345 / BUY-78003 — REST product serializers must pass merchantMap into
// buildProduct. This test is a compile-time/source guard: products.ts must
// define mapProducts and every former direct buildProduct call site must go
// through it (except the helper itself).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/routes/products.ts'), 'utf8');

describe('BUY-78003 REST merchantMap join', () => {
  it('defines mapProducts helper that calls lookupMerchantMap', () => {
    assert.match(src, /async function mapProducts\(/);
    assert.match(src, /lookupMerchantMap\(/);
    assert.match(src, /buildProduct\(row, currency, compact, merchantMap\)/);
  });

  it('does not call buildProduct without merchantMap outside mapProducts', () => {
    const withoutHelper = src.replace(
      /async function mapProducts\([\s\S]*?\n\}/,
      '',
    );
    assert.doesNotMatch(
      withoutHelper,
      /buildProduct\([^)]*\)/,
      'REST routes must serialize via mapProducts so merchant_name is populated',
    );
  });
});
