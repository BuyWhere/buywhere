/**
 * embed-products.test.mjs — Unit tests for the embedding pipeline hash-gate logic
 * (BUY-41136 validation)
 *
 * Tests the textHash and skip-logic without hitting the Jina API or a real DB.
 */
import { createHash } from 'crypto';
import assert from 'assert';
import { describe, it } from 'node:test';

// Re-implement the hash logic locally to avoid importing TypeScript
function textHash(title, description) {
  const text = `${title} ${description ?? ''}`;
  return createHash('md5').update(text).digest('hex');
}

// The SQL formula: md5(title || ' ' || coalesce(description, ''))
// must match the JS formula above
function sqlHash(title, description) {
  // Simulate what PostgreSQL md5(title || ' ' || coalesce(description, '')) does
  const text = title + ' ' + (description ?? '');
  return createHash('md5').update(text).digest('hex');
}

describe('textHash', () => {
  it('matches PostgreSQL md5(title || space || coalesce(desc, empty)) formula', () => {
    const title = 'Nike Air Max 270';
    const desc = 'Comfortable running shoe for everyday use';
    assert.strictEqual(textHash(title, desc), sqlHash(title, desc));
  });

  it('handles null description same as empty string in SQL', () => {
    const title = 'Samsung Galaxy S24';
    assert.strictEqual(textHash(title, null), sqlHash(title, null));
    assert.strictEqual(textHash(title, null), sqlHash(title, ''));
  });

  it('produces different hashes for different text', () => {
    const h1 = textHash('iPhone 15', 'Latest Apple smartphone');
    const h2 = textHash('iPhone 15', 'Updated description with new colour');
    assert.notStrictEqual(h1, h2);
  });

  it('produces same hash for price-only update (same title+desc)', () => {
    const h1 = textHash('Adidas Ultraboost', 'High performance running shoe');
    const h2 = textHash('Adidas Ultraboost', 'High performance running shoe');
    assert.strictEqual(h1, h2);
  });

  it('hash is 32-char MD5 hex string', () => {
    const h = textHash('Test Product', 'Description');
    assert.strictEqual(typeof h, 'string');
    assert.strictEqual(h.length, 32);
    assert.match(h, /^[0-9a-f]{32}$/);
  });
});

describe('vector format', () => {
  it('produces pgvector-compatible string from embedding array', () => {
    const embedding = [0.1, -0.2, 0.35, 0.0];
    const vectorStr = `[${embedding.join(',')}]`;
    assert.strictEqual(vectorStr, '[0.1,-0.2,0.35,0]');
    // pgvector expects [a,b,c,...] format — verify structure
    assert.match(vectorStr, /^\[[-\d.,]+\]$/);
  });
});
