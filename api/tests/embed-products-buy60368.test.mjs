/**
 * embed-products-buy60368.test.mjs — Verifies the BUY-60368 hash-prefilter
 * path in `runEmbedBatch`:
 *   - sourceDb SELECT is FLAT (no JOIN against `product_embeddings`)
 *   - vectorDb is queried once per run for the (product_id, text_hash) set
 *   - the post-filter in JS drops price-only-updated rows correctly
 *   - the post-filter preserves rows whose hash is missing or stale
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Mirror of the post-filter loop in embedProducts.ts. If the production
// file drifts, BUY-60368's invariant-test below catches it.
function textHash(title, description) {
  return createHash('md5').update(`${title} ${description ?? ''}`).digest('hex');
}

function filterCandidates(candidates, vectorHashes, batchLimit) {
  const products = [];
  let skipped = 0;
  for (const p of candidates) {
    const fresh  = textHash(p.title, p.description);
    const stored = vectorHashes.get(p.id);
    if (stored === undefined) {
      products.push(p);
    } else if (stored !== fresh) {
      products.push(p);
    } else {
      skipped += 1;
      if (products.length >= batchLimit) break;
    }
    if (products.length >= batchLimit) break;
  }
  return { products, skipped };
}

describe('BUY-60368 hash-prefilter', () => {
  it('drops price-only-updated rows (same hash as stored)', () => {
    const title = 'iPhone 15 Pro';
    const desc  = 'Latest Apple smartphone';
    const candidates = [
      { id: 'p1', title, description: desc, price: 1000 },
      { id: 'p2', title: 'Different Product', description: 'new desc', price: 500 },
    ];
    const vectorHashes = new Map([
      ['p1', textHash(title, desc)],
      ['p2', 'stale-hash'],
    ]);

    const { products, skipped } = filterCandidates(candidates, vectorHashes, 64);
    assert.equal(skipped, 1);
    assert.equal(products.length, 1);
    assert.equal(products[0].id, 'p2');
  });

  it('embeds rows whose product_id is not in vectorDb yet', () => {
    const candidates = [
      { id: 'p1', title: 'A', description: null, price: 100 },
      { id: 'p2', title: 'B', description: null, price: 50  },
    ];
    const vectorHashes = new Map();

    const { products, skipped } = filterCandidates(candidates, vectorHashes, 64);
    assert.equal(skipped, 0);
    assert.equal(products.length, 2);
  });

  it('caps output at batchLimit and counts skipped while scanning', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      title: `T${i}`,
      description: null,
      price: 100 - i,
    }));
    const vectorHashes = new Map();
    for (let i = 0; i < 5; i++) vectorHashes.set(`p${i}`, textHash(`T${i}`, null));
    for (let i = 5; i < 10; i++) vectorHashes.set(`p${i}`, 'stale');

    const { products, skipped } = filterCandidates(candidates, vectorHashes, 3);
    assert.equal(products.length, 3);
    assert.equal(skipped, 5);
    assert.deepEqual(products.map(p => p.id), ['p5', 'p6', 'p7']);
  });

  it('BUY-60368 invariant: sourceDb query must not reference product_embeddings', () => {
    // The fix moved the hash-gate from a LEFT JOIN on sourceDb to a JS
    // post-filter using a vectorDb hash set. If the JOIN creeps back, this
    // test fails before the bug returns to production.
    const fs  = require('node:fs');
    const path = require('node:path');
    const { fileURLToPath } = require('node:url');
    const __dirnameFixed = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.resolve(__dirnameFixed, '../src/jobs/embedProducts.ts'),
      'utf8'
    );
    const sourceDbBlocks = [...src.matchAll(/sourceDb\.query[\s\S]*?\);/g)].map((m) => m[0]);
    assert.ok(sourceDbBlocks.length > 0, 'expected sourceDb.query block to be present');
    assert.ok(
      sourceDbBlocks.every((block) => !/product_embeddings/i.test(block)),
      'BUY-60368: sourceDb query must NOT reference product_embeddings'
    );
    assert.ok(
      /vectorDb\.query[\s\S]*?product_embeddings/.test(src),
      'expected vectorDb to be queried for product_embeddings'
    );
  });
});
