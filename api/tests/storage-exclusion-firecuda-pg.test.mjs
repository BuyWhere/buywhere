/**
 * BUY-69753: real-PG regression for the Firecuda leak on the TIER table.
 *
 * Unlike storage-exclusion-pg.test.mjs (which runs full FTS queries), this test
 * applies the ACTUAL production exclusion fragment to the ACTUAL production rows
 * (Firecuda 54412203 + the laptop rows it outranked) and asserts the predicate
 * outcome directly. This is the smallest verification that proves the SQL fix —
 * no full-catalog scans, runs in seconds against sakura.
 *
 * Runs only when TEST_DATABASE_URL is set; skips silently otherwise.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Pool } = pg;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const describe_or_skip = TEST_DATABASE_URL ? describe : (name, fn) => describe.skip(name, fn);

// Real production rows verified 2026-08-14:
//   54412203 Firecuda 520 SSD    search_products.category='home-living', products.metadata.category='Storage'  -> MUST be excluded
//   54452825 GIGABYTE GAMING A16 search_products.category='home-living', products.metadata.category='Laptops'  -> MUST be kept
//   54452416 GIGABYTE A16 PRO    search_products.category='home-living', products.metadata.category='Laptops'  -> MUST be kept
const MUST_EXCLUDE_IDS = [54412203];
const MUST_KEEP_IDS = [54452825, 54452416];

describe_or_skip('BUY-69753 storage-exclusion tier predicate (real rows)', { skip: !TEST_DATABASE_URL }, () => {
  let pool;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    await pool.query('SET statement_timeout = 20000');
  });

  after(async () => {
    await pool.end();
  });

  async function runPredicate(fragment, ids) {
    // Wrap the fragment in the exact predicate position production uses:
    // `WHERE ... ${fragment}` with sp = search_products.
    const sql = `
      SELECT sp.id,
        sp.category AS sp_category,
        p.category AS p_category,
        p.metadata->>'category' AS p_meta_category
      FROM search_products sp
      LEFT JOIN products p ON p.id = sp.id
      WHERE sp.id = ANY($1::bigint[])
        AND 1 = 1 ${fragment}
    `;
    const res = await pool.query(sql, [ids]);
    return res.rows;
  }

  it('fragment excludes Firecuda 520 (metadata category Storage) on device query', async () => {
    const { deviceStorageExclusionFragment } = await import('../dist/lib/searchRelevanceTaxonomy.js');
    const frag = deviceStorageExclusionFragment('gaming laptop');
    assert.ok(frag.length > 0, 'device query "gaming laptop" must produce an exclusion fragment');

    const rows = await runPredicate(frag, MUST_EXCLUDE_IDS);
    assert.equal(
      rows.length,
      0,
      `Firecuda 54412203 must be excluded; got ${JSON.stringify(rows.map(r => ({ id: r.id, sp: r.sp_category, p: p2c(r), meta: r.p_meta_category })))}`,
    );
  });

  it('fragment keeps real laptops (metadata category Laptops) on device query', async () => {
    const { deviceStorageExclusionFragment } = await import('../dist/lib/searchRelevanceTaxonomy.js');
    const frag = deviceStorageExclusionFragment('gaming laptop');
    const rows = await runPredicate(frag, MUST_KEEP_IDS);
    assert.equal(rows.length, MUST_KEEP_IDS.length, 'both laptop rows must survive the exclusion');
  });

  it('fragment is empty for storage queries (positive control)', async () => {
    const { deviceStorageExclusionFragment } = await import('../dist/lib/searchRelevanceTaxonomy.js');
    for (const q of ['ssd', 'nvme ssd', 'portable ssd', '1tb ssd', 'gaming ssd', 'internal ssd', 'laptop ssd']) {
      assert.equal(deviceStorageExclusionFragment(q), '', `"${q}" must not fire the exclusion`);
    }
  });

  it('fragment is empty for non-device queries', async () => {
    const { deviceStorageExclusionFragment } = await import('../dist/lib/searchRelevanceTaxonomy.js');
    for (const q of ['running shoes', 'coffee maker', 'office chair']) {
      assert.equal(deviceStorageExclusionFragment(q), '', `"${q}" must not fire the exclusion`);
    }
  });

  it('fragment fires for the full device-query matrix from the acceptance criteria', async () => {
    const { deviceStorageExclusionFragment } = await import('../dist/lib/searchRelevanceTaxonomy.js');
    const deviceQueries = [
      'gaming laptop', 'laptop', 'macbook', 'gaming pc', 'desktop computer',
      'iphone', 'android phone', 'smartphone', 'tablet', 'gaming monitor',
      'wireless earbuds', 'smart watch',
    ];
    for (const q of deviceQueries) {
      const frag = deviceStorageExclusionFragment(q);
      assert.ok(frag.length > 0, `"${q}" must fire the exclusion (acceptance set)`);
    }
  });

  it('archive-path fragment (products alias) also uses OR-coalesce, not coalesce(category, metadata)', async () => {
    const { deviceStorageExclusionFragmentProducts } = await import('../dist/lib/searchRelevanceTaxonomy.js');
    const frag = deviceStorageExclusionFragmentProducts('gaming laptop');
    assert.ok(frag.length > 0, 'device query must produce a products-alias fragment');
    assert.ok(
      !/coalesce\(category,\s*metadata/i.test(frag),
      `archive fragment must NOT use coalesce(category, metadata->>'category') — that form leaks when category is non-NULL junk: ${frag}`,
    );
    // And it must actually exclude the Firecuda row on the products table.
    const sql = `SELECT id FROM products WHERE id = ANY($1::bigint[]) AND 1 = 1 ${frag}`;
    const res = await pool.query(sql, [[54412203, 54452825]]);
    const ids = res.rows.map(r => String(r.id));
    assert.ok(!ids.includes('54412203'), 'Firecuda must be excluded on the archive path');
    assert.ok(ids.includes('54452825'), 'laptop must be kept on the archive path');
  });
});

function p2c(r) { return r.p_category; }
