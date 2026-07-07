/**
 * BUY-60378 v2 invariant: catalog SELECT uses `idx_products_updated_at` 
 * via the `updated_at DESC` order key, NOT the missing/INVALID
 * `idx_products_is_active_price`. This fails fast if the planner would
 * fall back to a Seq Scan (`ORDER BY price DESC` on the 154M-row products
 * table while `idx_products_is_active_price` remains INVALID costs
 * ~37M and 57014's at the 60s statement_timeout).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const __dirnameFixed = path.dirname(fileURLToPath(import.meta.url));

describe('BUY-60378 v2 (updated_at order key)', () => {
  it('api-embed catalog SELECT orders by updated_at DESC', () => {
    const src = fs.readFileSync(
      path.resolve(__dirnameFixed, '../../api-embed/api/src/jobs/embedProducts.ts'),
      'utf8'
    );
    // The CTE must use updated_at DESC, not price DESC.
    const cteBlock = src.match(/WITH active_ids[\s\S]*?SELECT id FROM active_ids/);
    assert.ok(cteBlock, 'expected BUY-60378 v2 CTE to be present');
    assert.ok(
      /ORDER BY updated_at DESC/.test(cteBlock[0]),
      'BUY-60378 v2: catalog SELECT must order by updated_at DESC (uses idx_products_updated_at)'
    );
    assert.ok(
      !/ORDER BY price DESC/.test(cteBlock[0]),
      'BUY-60378 v2: catalog SELECT must NOT order by price DESC (would Seq Scan without idx_products_is_active_price)'
    );
  });

  it('api catalog SELECT orders by updated_at DESC', () => {
    const src = fs.readFileSync(
      path.resolve(__dirnameFixed, '../src/jobs/embedProducts.ts'),
      'utf8'
    );
    const cteBlock = src.match(/WITH active_ids[\s\S]*?SELECT id FROM active_ids/);
    assert.ok(cteBlock, 'expected BUY-60378 v2 CTE to be present in api/src');
    assert.ok(
      /ORDER BY updated_at DESC/.test(cteBlock[0]),
      'BUY-60378 v2: api/src catalog SELECT must order by updated_at DESC'
    );
  });
});
