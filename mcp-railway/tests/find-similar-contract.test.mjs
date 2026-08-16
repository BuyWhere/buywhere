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
    assert.match(source, /SELECT id::text AS id, sku FROM products WHERE id = \$1::bigint AND is_active = true LIMIT 1/);
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

describe('MCP find_similar query-shape regression (BUY-70113 seq-scan fix)', () => {
  it('binds numeric ids as bigint so products_pkey is used (no id::text filter)', () => {
    // The source-lookup path must not filter on a text-cast id — that defeats
    // products_pkey and Seq-Scans the ~300M-row catalog until statement_timeout.
    assert.match(source, /WHERE id = \$1::bigint AND is_active = true LIMIT 1/);
    // The detail-enrichment path likewise.
    assert.match(source, /WHERE id IN \(\$\{ph\}::bigint\[\]\) AND is_active = true/);
    assert.doesNotMatch(source, /WHERE id::text (?:=|IN)/);
  });

  it('looks up canonical embeddings by native bigint, not text-cast product_id', () => {
    assert.match(source, /WHERE product_id = ANY\(\$1::bigint\[\]\)/);
    assert.doesNotMatch(source, /WHERE product_id::text = ANY/);
  });

  it('probes the legacy sku vector table on catalogDb, where that schema lives', () => {
    // search_proof.product_vectors exists only in the catalog DB; querying it on
    // vectorDb always throws and the swallowed catch made the fallback dead code.
    const legacyBlock = source.match(
      /catalogDb\.query<\{ vector_key: string; embedding: string; vector_table: string \}>\(\s*\n\s*`SELECT sku AS vector_key[\s\S]*?search_proof\.product_vectors/
    );
    assert.ok(legacyBlock, 'legacy fallback must run on catalogDb.query');
    assert.doesNotMatch(
      source,
      /vectorDb\.query<\{ vector_key: string; embedding: string; vector_table: string \}>\(\s*\n\s*`SELECT sku AS vector_key/
    );
  });

  it('keeps a numeric-input SKU bridge when the id row is missing', () => {
    // A 13-digit Shopify variant id is a legacy vector SKU, not products.id; the
    // handler must still probe the sku-keyed table with the raw input.
    assert.match(source, /else if \(!isNumericProductId\)/);
    assert.match(source, /sourceSku = resolvedId/);
  });
});
