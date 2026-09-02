import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/lib/promoteAmazonUsToSearchProducts.ts'), 'utf8');
const ingest = readFileSync(join(here, '../src/routes/ingest.ts'), 'utf8');

describe('BUY-80070 promoteAmazonUsToSearchProducts extraction', () => {
  it('keeps hash ids as strings (no Number())', () => {
    assert.equal(/Number\(id\)/.test(src), false);
    assert.match(src, /String\(id\)/);
    assert.match(src, /\$1::bigint\[\]/);
  });
  it('batches 1–5 with 25s timeout and ON CONFLICT DO NOTHING', () => {
    assert.match(src, /SEARCH_PRODUCTS_SINK_BATCH/);
    assert.match(src, /statement_timeout = '25s'/);
    assert.match(src, /ON CONFLICT \(id\) DO NOTHING/);
  });
  it('ingest.ts imports shared helper and does not define a local copy', () => {
    assert.match(ingest, /from '\.\.\/lib\/promoteAmazonUsToSearchProducts'/);
    assert.equal(/async function promoteAmazonUsToSearchProducts/.test(ingest), false);
    assert.match(ingest, /void promoteAmazonUsToSearchProducts\(db, sinkIds\)/);
  });
});
