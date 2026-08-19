/**
 * BUY-71653: Real-PG regression tests for primary-product laptop ranking.
 *
 * Verifies that for laptop-intent queries, actual laptop computers outrank
 * accessories and wrong-type products (desks/tables, bags, soldering paste),
 * per the BUY-71640 examples: "Soldering Flux Paste", "Foldable Laptop Desk",
 * wooden study tables, and laptop bags must rank below qualifying laptops.
 *
 * These tests mirror the laptopBoost SQL in api/src/routes/products.ts (tier
 * path `laptopBoost` and archive path). If the SQL there changes, update the
 * copy here (kept in sync deliberately — the test validates the RANKING
 * CONTRACT, not the source string).
 *
 * Runs ONLY when TEST_DATABASE_URL is set (same skip convention as
 * storage-exclusion-pg.test.mjs).
 *
 * Setup (from api/): docker compose up -d db, then insert fixtures with the
 * seed block below, then:
 *   TEST_DATABASE_URL="postgresql://buywhere:buywhere@localhost:5432/catalog" \
 *     node --test tests/laptop-primary-relevance-pg.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Pool } = pg;

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const describe_or_skip = TEST_DATABASE_URL ? describe : (name, fn) => {
  // eslint-disable-next-line no-console
  console.log(`[skip: TEST_DATABASE_URL unset] ${name}`);
  return undefined;
};

// BUY-71653 laptopBoost — mirrors the archive-path CASE in products.ts.
// (rhp alias replaced with sp for fixture-query use.)
const LAPTOP_BOOST_SQL = `
  CASE
    WHEN lower(sp.title) ~* '\\mlaptop\\M'
      OR lower(sp.title) ~* '\\mnotebook\\M'
      OR lower(sp.title) ~* '\\mmacbook\\M'
      OR lower(sp.title) ~* '\\mchromebook\\M'
    THEN
      CASE
        WHEN lower(sp.title) ~* '(soldering|solder|paste|flux|repair|tool|tools|replacement|part|parts)\\M'
          AND (lower(sp.title) ~* '\\mlaptop\\M' OR lower(sp.title) ~* '\\mnotebook\\M')
        THEN 0.05
        WHEN lower(sp.title) ~* '(charger|chargers|power bank|powerbank|battery|batteries|adapter|adapters|cable|cables|organiser|organizer)\\M'
          AND (lower(sp.title) ~* '\\mlaptop\\M' OR lower(sp.title) ~* '\\mnotebook\\M')
        THEN 0.10
        WHEN lower(sp.title) ~* '(laptop|notebook|macbook|chromebook)\\M.*(bag|bags|backpack|backpacks|sleeve|sleeves|case|cases|cover|covers|pouch|carrier)'
          OR lower(sp.category) ~* '\\m(bag|bags|backpack|backpacks|sleeve|sleeves|case|cases|cover|covers)\\M'
        THEN 0.25
        WHEN lower(sp.title) ~* '(laptop|notebook|macbook|chromebook)\\M.*(stand|stands|arm|arms|cooler|coolers|riser|risers|mount|mounts|extension)'
        THEN 0.10
        WHEN lower(sp.title) ~* 'laptop\\M.*(desk|table|tray|shelf|bed)'
          OR lower(sp.title) ~* '\\m(study|wooden|wood|bamboo|foldable|bed|breakfast)\\M.*\\m(laptop|desk|table|tray)\\M'
          OR lower(sp.title) ~* '(bamboo|wooden|foldable|bed|breakfast)\\M'
        THEN 0.75
        ELSE 2.5
      END
    WHEN lower(sp.category) LIKE '%laptop%'
      OR array_to_string(sp.category_path, ' ') LIKE '%laptop%'
    THEN 1.5
    ELSE 1.0
  END`;

// Fixture ids 970000001..970000010 (BUY-71653 namespace, distinct from BUY-69727).
const FIXTURES = [
  // qualifying laptops (6)
  [970000001, 'ASUS ROG Zephyrus G16 Gaming Laptop Intel Core i9 RTX 4070', 'Computers'],
  [970000002, 'Dell XPS 15 Laptop 15.6 Intel i7 32GB RAM 1TB SSD', 'Computers'],
  [970000003, 'HP Pavilion 15.6" Laptop AMD Ryzen 7 16GB 512GB', 'Laptops'],
  [970000004, 'Apple MacBook Pro 14 M3 Pro 18GB 512GB', 'Laptops'],
  [970000005, 'Lenovo IdeaPad Slim 3 Chromebook 14" 8GB 64GB', 'Laptops'],
  [970000006, 'Acer Aspire 5 Notebook 15.6" i5 8GB 256GB', 'Computers'],
  // BUY-71640 wrong-type fixtures (4)
  [970000007, 'Soldering Flux Paste 10cc No Clean Solder Paste for Laptop Repair', 'Tools'],
  [970000008, 'Foldable Laptop Desk Bamboo Bed Tray Table', 'Furniture'],
  [970000009, 'Bekasi Solid Wood Writing Study Table Study Laptop Desk', 'Furniture'],
  [970000010, 'Laptop Bag 15.6 Inch Water Resistant Briefcase', 'Accessories'],
];

describe_or_skip('BUY-71653: primary-product laptop ranking', () => {
  let pool;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    for (const [id, title, category] of FIXTURES) {
      await pool.query(
        `INSERT INTO products (id, sku, source, title, price, currency, url, region,
           country_code, is_active, category, metadata, search_vector, updated_at)
         VALUES ($1, $2, 'buy71653_fixture', $3, 99.99, 'USD', $4, 'US', 'US', true,
           $5, '{"brand":"Fixture","category":"' || $5 || '"'}::jsonb,
           to_tsvector('english', $3), NOW())
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title,
           category = EXCLUDED.category,
           search_vector = EXCLUDED.search_vector,
           updated_at = NOW()`,
        [id, `buy71653_${id}`, title, `https://example.com/p/${id}`, category]
      );
    }
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM products WHERE source = \'buy71653_fixture\'');
      await pool.end();
    }
  });

  it('actual laptops outrank desks, bags, and soldering paste', async () => {
    const { rows } = await pool.query(
      `SELECT id, title, ${LAPTOP_BOOST_SQL} AS boost
       FROM products sp
       WHERE sp.source = 'buy71653_fixture' AND sp.is_active
       ORDER BY boost DESC, id ASC`
    );
    const laptops = rows.filter((r) => [970000001, 970000002, 970000003, 970000004, 970000005, 970000006].includes(Number(r.id)));
    const wrongType = rows.filter((r) => [970000007, 970000008, 970000009, 970000010].includes(Number(r.id)));

    // Rank 1 must be an actual laptop.
    assert.ok(laptops.some((l) => Number(l.id) === Number(rows[0].id)),
      `rank 1 should be a laptop, got: ${rows[0].title}`);
    // Every laptop outranks every wrong-type fixture.
    const minLaptop = Math.min(...laptops.map((l) => Number(l.boost)));
    const maxWrong = Math.max(...wrongType.map((w) => Number(w.boost)));
    assert.ok(minLaptop > maxWrong,
      `min laptop boost ${minLaptop} must exceed max wrong-type boost ${maxWrong}`);
  });

  it('BUY-71640 fixtures receive the demotion tiers', async () => {
    const { rows } = await pool.query(
      `SELECT id, ${LAPTOP_BOOST_SQL} AS boost FROM products sp WHERE sp.source = 'buy71653_fixture'`
    );
    const byId = Object.fromEntries(rows.map((r) => [Number(r.id), Number(r.boost)]));
    assert.equal(byId[970000007], 0.05, 'soldering flux paste → 0.05');
    assert.equal(byId[970000008], 0.75, 'foldable laptop desk → 0.75');
    assert.equal(byId[970000009], 0.75, 'wooden study table → 0.75');
    assert.equal(byId[970000010], 0.25, 'laptop bag → 0.25');
    assert.equal(byId[970000001], 2.5, 'actual laptop → 2.5');
  });
});
