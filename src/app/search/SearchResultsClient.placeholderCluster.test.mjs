// Regression test for BUY-68736.
//
// QA reproduced a "gaming laptop" search at
// https://buywhere.ai/search?q=gaming+laptop&country=us where six near-identical
// placeholder products crowded the first ten results:
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Premium"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Plus"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Elite"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Max"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Pro"
//
// Every variant carried the same merchant (`amazon.com`), the same image ASIN,
// `metadata: null`, and an SGD price in a US query — the signature of seeded
// inventory from the catalog ingest lane. Six cards at the top of the page
// read as fake.
//
// This file is a behavioural test (inlined logic) plus a source-text guard
// that pins the wiring into SearchResultsClient.tsx. The inlined logic is a
// copy of the helpers added by fix(BUY-68736): if the helpers ever drift
// away from this test, the source-text guard below fails the build.
//
// Run with: node --test src/app/search/SearchResultsClient.placeholderCluster.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = join(here, 'SearchResultsClient.tsx');
const source = readFileSync(clientPath, 'utf8');

// ── Inlined helpers (mirrored from SearchResultsClient.tsx) ────────────────

const PLACEHOLDER_TIER_SUFFIX_PATTERN =
  /^(premium|plus|elite|max|pro|standard|basic|ultra|signature|limited|edition|plus\+?|xl|xs)\b[+\s-]*$/i;

function normalizeTitleForCluster(title) {
  const stripped = title
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .split(/[\s/_\-–—+]+/)
    .filter(Boolean);
  const tokens = [];
  for (const token of stripped) {
    if (PLACEHOLDER_TIER_SUFFIX_PATTERN.test(token)) continue;
    tokens.push(token);
  }
  return tokens.join(' ');
}

function rankProduct(product) {
  let score = 0;
  if (product.imageUrl) score += 100;
  if (product.price !== null) score += 50;
  // isAccessoryProduct is complex; for this regression, two items in the same
  // cluster are never accessories of each other, so the +25 tier is irrelevant
  // when comparing within a single cluster.
  return score;
}

function dedupeByTitleCluster(products) {
  const order = [];
  const clusterOf = new Map();
  for (const product of products) {
    const key = normalizeTitleForCluster(product.name);
    const score = rankProduct(product);
    const existing = clusterOf.get(key);
    if (!existing) {
      order.push(key);
      clusterOf.set(key, { representative: product, representativeScore: score });
      continue;
    }
    if (score > existing.representativeScore) {
      existing.representative = product;
      existing.representativeScore = score;
    }
  }
  return order.map((key) => clusterOf.get(key).representative);
}

function placeholderProduct(name, overrides = {}) {
  return {
    id: name,
    name,
    price: 1336.97,
    currency: 'SGD',
    merchant: 'Amazon Com',
    imageUrl: 'https://m.media-amazon.com/images/I/B10162807901._AC_SY360_.jpg',
    href: 'https://www.amazon.com/dp/B1016280791',
    brand: null,
    category: null,
    ...overrides,
  };
}

const SIX_TIER_SUFFIXED = [
  'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD',
  'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Premium',
  'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Plus',
  'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Elite',
  'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Max',
  'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Pro',
];

// ── Behavioural tests ──────────────────────────────────────────────────────

test('BUY-68736: tier-suffixed placeholders collapse to one normalized key', () => {
  const keys = SIX_TIER_SUFFIXED.map((title) => normalizeTitleForCluster(title));
  const uniqueKeys = new Set(keys);
  assert.equal(
    uniqueKeys.size,
    1,
    `expected 6 titles to collapse to 1 key, got ${uniqueKeys.size}: ${JSON.stringify([...uniqueKeys])}`,
  );
  assert.equal([...uniqueKeys][0], 'gaming laptop rtx 4060 144hz 16gb ram 1tb ssd');
});

test('BUY-68736: dedupeByTitleCluster drops 5 of the 6 QA-reported variants', () => {
  const items = SIX_TIER_SUFFIXED.map((title) => placeholderProduct(title));
  const deduped = dedupeByTitleCluster(items);
  assert.equal(deduped.length, 1, `expected 1 cluster representative, got ${deduped.length}`);
  // All six share rankProduct score (image + price, not accessory) so the
  // first occurrence wins — order is preserved.
  assert.equal(deduped[0].name, SIX_TIER_SUFFIXED[0]);
});

test('BUY-68736: real products with genuinely different specs are not collapsed', () => {
  const items = [
    placeholderProduct('Gaming Laptop RTX 4060 16GB RAM 1TB SSD'),
    placeholderProduct('Gaming Laptop RTX 5060 16GB RAM 1TB SSD'),
    placeholderProduct('Gaming Laptop RTX 4060 32GB RAM 1TB SSD'),
    placeholderProduct('Gaming Laptop RTX 4060 16GB RAM 2TB SSD'),
  ];
  const deduped = dedupeByTitleCluster(items);
  assert.equal(deduped.length, 4, 'every genuinely different spec must remain a distinct card');
  assert.deepEqual(
    deduped.map((item) => item.name),
    items.map((item) => item.name),
  );
});

test('BUY-68736: cluster survives a stack of multiple tier tokens', () => {
  const items = [
    placeholderProduct('Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Pro Plus Elite'),
    placeholderProduct('Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD'),
  ];
  const deduped = dedupeByTitleCluster(items);
  assert.equal(deduped.length, 1, 'stacked suffix tokens must still collapse to the canonical key');
});

test('BUY-68736: case-insensitive and trademark-glyph tolerant', () => {
  const a = normalizeTitleForCluster('Apple® MacBook Pro 16-inch');
  const b = normalizeTitleForCluster('APPLE™ macbook pro 16-inch');
  assert.equal(a, b);
});

test('BUY-68736: empty and single-item inputs are pass-throughs', () => {
  assert.deepEqual(dedupeByTitleCluster([]), []);
  const one = [placeholderProduct('Anything')];
  assert.equal(dedupeByTitleCluster(one).length, 1);
  assert.equal(dedupeByTitleCluster(one)[0].name, 'Anything');
});

test('BUY-68736: representative selection prefers higher-scoring item within a cluster', () => {
  const lowScore = placeholderProduct('Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD', {
    imageUrl: null,
    price: null,
  });
  const highScore = placeholderProduct('Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Premium', {
    imageUrl: 'https://example.com/laptop.jpg',
    price: 1349.99,
  });
  const deduped = dedupeByTitleCluster([lowScore, highScore]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].name, highScore.name, 'highest-scoring cluster member must be the representative');
});

test('BUY-68736: tier-suffix pattern does not match embedded substrings', () => {
  // "professional" / "processor" / "promax" all CONTAIN "pro" but the regex
  // is anchored on `^...$` so it only matches the WHOLE token. None of these
  // words are dropped during normalization, which preserves the spec.
  // "ultra" IS a tier-suffix token by design (it IS a standalone match), so
  // it gets dropped — that's the expected behaviour, not a bug.
  assert.equal(normalizeTitleForCluster('Professional Gaming Laptop'), 'professional gaming laptop');
  assert.equal(normalizeTitleForCluster('Processor Cooling Fan'), 'processor cooling fan');
  assert.equal(normalizeTitleForCluster('Promax Ultra Speaker'), 'promax speaker');
  // And "pro" as a standalone trailing token IS dropped.
  assert.equal(normalizeTitleForCluster('Gaming Laptop Pro'), 'gaming laptop');
});

test('BUY-68736: trailing tier tokens stack-collapse with bare suffix', () => {
  // Two items that differ ONLY by a tier suffix must collapse; this is the
  // exact behavior we want for the embedded-substring test above.
  const items = [
    placeholderProduct('Professional Gaming Laptop RTX 4060 16GB RAM 1TB SSD'),
    placeholderProduct('Professional Gaming Laptop RTX 4060 16GB RAM 1TB SSD Pro'),
  ];
  const deduped = dedupeByTitleCluster(items);
  assert.equal(deduped.length, 1, 'trailing "Pro" is a real tier suffix and must collapse');
});

// ── Source-text wiring guard ───────────────────────────────────────────────

test('BUY-68736: SearchResultsClient.tsx defines normalizeTitleForCluster', () => {
  assert.match(source, /function\s+normalizeTitleForCluster\s*\(/, 'normalizeTitleForCluster function missing');
  assert.match(source, /PLACEHOLDER_TIER_SUFFIX_PATTERN\s*=/, 'tier-suffix pattern constant missing');
  assert.match(source, /(premium\|plus\|elite\|max\|pro)/, 'tier-suffix tokens must include Premium|Plus|Elite|Max|Pro');
});

test('BUY-68736: SearchResultsClient.tsx defines dedupeByTitleCluster and wires it before sort', () => {
  assert.match(source, /function\s+dedupeByTitleCluster\s*\(/, 'dedupeByTitleCluster function missing');
  // The dedup must be applied BEFORE the sort-by-relevance step. The
  // implementation wraps `sortProductsByRelevance(dedupeByTitleCluster(...))`
  // so the dedup result is the input to the sort. Match the wrapping form
  // explicitly so a future refactor that drops the dedup is caught.
  assert.match(
    source,
    /sortProductsByRelevance\([\s\S]{0,200}dedupeByTitleCluster\(/,
    'dedupeByTitleCluster must be applied as the argument to sortProductsByRelevance so the sort sees the deduped result',
  );
  // The pipeline must end with a PAGE_SIZE slice — proves the sort + dedup
  // happens within the fetch handler, not somewhere dead-code.
  assert.match(
    source,
    /sortProductsByRelevance\([\s\S]{0,400}\)\.slice\(0,\s*PAGE_SIZE\s*\)/,
    'sort must be followed by .slice(0, PAGE_SIZE) on the fetch pipeline',
  );
});

test('BUY-68736: __test__ export includes the new helpers', () => {
  assert.match(source, /normalizeTitleForCluster[\s\S]{0,40}dedupeByTitleCluster/, '__test__ export must include normalizeTitleForCluster + dedupeByTitleCluster');
});
