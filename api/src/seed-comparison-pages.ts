/**
 * Seed script: create 3 published comparison_pages rows for FE integration testing.
 *
 * Picks the first available product from each of 3 categories already in the DB.
 * Run with:  npx ts-node --project tsconfig.json src/seed-comparison-pages.ts
 * (Or after build: node dist/seed-comparison-pages.js)
 *
 * Safe to run multiple times — skips pages that already exist by slug.
 */

import { db } from './config';

interface SeedSpec {
  category: 'electronics' | 'grocery' | 'home' | 'health';
  slugSuffix: string;
  expertSummary: string;
}

const SEEDS: SeedSpec[] = [
  {
    category: 'electronics',
    slugSuffix: 'electronics',
    expertSummary:
      'Compare prices for this electronics product across major Singapore retailers. Prices are updated daily from Lazada, Shopee, Best Denki, and others.',
  },
  {
    category: 'home',
    slugSuffix: 'home',
    expertSummary:
      'Find the best deal on this home product in Singapore. Our price tracker monitors multiple retailers so you never overpay.',
  },
  {
    category: 'health',
    slugSuffix: 'health',
    expertSummary:
      'Compare prices and availability for this health product across Singapore retailers. Updated daily.',
  },
];

async function seed() {
  for (const spec of SEEDS) {
    // Pick a product that has at least one retailer price and belongs to the category
    const productResult = await db.query(
      `SELECT p.id, p.name
       FROM products p
       WHERE LOWER(p.category_path::text) LIKE $1
         AND EXISTS (
           SELECT 1 FROM retailer_prices rp WHERE rp.product_id = p.id
         )
       ORDER BY p.id
       LIMIT 1`,
      [`%${spec.category}%`]
    );

    if (productResult.rows.length === 0) {
      // Fall back: pick any product with a price
      const fallback = await db.query(
        `SELECT p.id, p.name
         FROM products p
         WHERE EXISTS (SELECT 1 FROM retailer_prices rp WHERE rp.product_id = p.id)
         ORDER BY p.id
         LIMIT 1`
      );
      if (fallback.rows.length === 0) {
        console.warn(`[seed] No products with retailer prices found — skipping ${spec.category}`);
        continue;
      }
      productResult.rows = fallback.rows;
    }

    const product = productResult.rows[0] as { id: string; name: string };
    const slug = `${product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${spec.slugSuffix}`;
    const cleanSlug = slug.replace(/--+/g, '-').replace(/^-|-$/g, '');

    // Insert — skip if slug already exists
    const result = await db.query(
      `INSERT INTO comparison_pages
         (slug, product_id, category, status, expert_summary, published_at)
       VALUES ($1, $2, $3, 'published', $4, NOW())
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, slug, status`,
      [cleanSlug, product.id, spec.category, spec.expertSummary]
    );

    if (result.rows.length > 0) {
      console.log(`[seed] Created: slug="${cleanSlug}" product="${product.name}" (${product.id})`);
    } else {
      console.log(`[seed] Skipped (already exists): slug="${cleanSlug}"`);
    }
  }

  await db.end();
  console.log('[seed] Done. Use GET /v1/compare/<slug> to verify.');
}

seed().catch((err) => {
  console.error('[seed] Error:', err);
  process.exit(1);
});
