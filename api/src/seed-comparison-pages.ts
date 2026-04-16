/**
 * Seed script: create 3 published comparison_pages rows for FE integration testing.
 * Uses real product groups found in the products table (BUY-2270).
 * Safe to run multiple times — ON CONFLICT DO NOTHING.
 * Run: npx ts-node --project tsconfig.json src/seed-comparison-pages.ts
 */

import { db } from './config';

const SEEDS = [
  {
    slug: 'tplink-tapo-c100-home-security-wifi-camera',
    productIds: [2530224, 2808300, 9306, 3507649, 139434, 4989629],
    category: 'electronics',
    expertSummary:
      'The TP-Link Tapo C100 is one of the best-value home security cameras in Singapore. ' +
      'It offers 1080p full HD recording, night vision, and easy app setup. ' +
      'Compare prices across FairPrice, Challenger, and Amazon SG to find the best deal.',
  },
  {
    slug: 'gopro-hero13-black-creator-edition',
    productIds: [2799382, 13579, 3562995, 140282, 5000341],
    category: 'electronics',
    expertSummary:
      'The GoPro Hero13 Black Creator Edition bundles the flagship action camera with accessories for content creators. ' +
      'HyperSmooth 6.0 stabilisation and 5.3K video make it the top pick for adventure vlogging. ' +
      'Price is consistent across Singapore retailers — check availability before buying.',
  },
  {
    slug: 'dji-osmo-pocket-3',
    productIds: [2797747, 9091, 3498641, 140296, 5000385],
    category: 'electronics',
    expertSummary:
      'The DJI OSMO Pocket 3 is the most portable gimbal camera for travel and daily shooting. ' +
      'The 1-inch CMOS sensor and ActiveTrack subject tracking are standout features at this price point. ' +
      'Available at Challenger and FairPrice in Singapore — stock varies.',
  },
];

async function seed() {
  for (const s of SEEDS) {
    const result = await db.query(
      `INSERT INTO comparison_pages
         (slug, product_ids, category, status, expert_summary, published_at)
       VALUES ($1, $2, $3, 'published', $4, NOW())
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, slug, status`,
      [s.slug, s.productIds, s.category, s.expertSummary]
    );
    if (result.rows.length > 0) {
      console.log(`[seed] Created: slug="${s.slug}" products=${s.productIds.length}`);
    } else {
      console.log(`[seed] Skipped (already exists): slug="${s.slug}"`);
    }
  }

  await db.end();
  console.log('\n[seed] Done. Test endpoints:');
  for (const s of SEEDS) {
    console.log(`  GET /v1/compare/${s.slug}`);
  }
}

seed().catch((err) => {
  console.error('[seed] Error:', err);
  process.exit(1);
});
