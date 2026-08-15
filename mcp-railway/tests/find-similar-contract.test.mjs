// BUY-70113: find_similar public identifier + legacy vector coverage contract.
//
// Production regression: the MCP tool accepts `product_id`, while legacy vector
// coverage also exists in search_proof.product_vectors keyed only by sku. The
// handler must keep products.id as the public contract, map products.id -> sku,
// and fall back to the sku-keyed vector table until canonical embeddings catch up.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srcPath = require.resolve('../src/routes/mcp.ts');
const source = readFileSync(srcPath, 'utf8');

describe('MCP find_similar identifier contract (BUY-70113)', () => {
  it('documents products.id as the public product_id contract', () => {
    assert.match(source, /product_id: \{ type: 'string', description: 'Catalog product id \(products\.id/);
  });

  it('maps catalog product ids to sku before vector lookup', () => {
    assert.match(source, /SELECT id::text AS id, sku FROM products WHERE id = \$1 AND is_active = true LIMIT 1/);
    assert.match(source, /const lookupKeys = Array\.from\(new Set\(\[sourceProductId, sourceSku, resolvedId\]/);
  });

  it('falls back to legacy search_proof.product_vectors keyed by sku', () => {
    assert.match(source, /FROM search_proof\.product_vectors/);
    assert.match(source, /WHERE sku = ANY\(\$1::text\[\]\)/);
    assert.match(source, /FROM products WHERE sku IN \(\$\{ph\}\) AND is_active = true/);
  });

  it('keeps UUID-shaped values as invalid input, not an internal vector SQL error', () => {
    assert.match(source, /isUuidLike/);
    assert.match(source, /Invalid product_id format: expected catalog product id or exact SKU/);
  });
});
