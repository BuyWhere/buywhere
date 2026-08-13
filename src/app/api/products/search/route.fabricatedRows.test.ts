// Regression test for BUY-68736.
//
// QA searched "gaming laptop" (country=us) on https://buywhere.ai/search and
// got six near-identical cards in the first ten results:
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Premium"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Plus"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Elite"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Max"
//   "Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Pro"
//
// These are fabricated catalog rows, and the structural tell is the ASIN: a
// real Amazon ASIN is exactly 10 characters, while every seeded row carries an
// 11-character one whose /dp/ link resolves to an Amazon "not found" stub.
//
// isFabricatedAmazonItem must:
//   - flag an Amazon /dp/ link whose ASIN is not 10 characters
//   - NOT flag a well-formed 10-character Amazon ASIN
//   - NOT flag non-Amazon merchants, whose id schemes are unrelated
//   - fall back to click_url / affiliate_url when `url` is absent
//   - tolerate missing/malformed urls without throwing
//
// dropFabricatedItems must:
//   - remove exactly the six QA-reported rows and keep the genuine ones
//   - preserve the relative order of the survivors
//   - fail open when every row looks fabricated (an empty results page is a
//     worse outcome than showing seeded rows)
//   - NOT collapse real product families — the rejected title-clustering
//     approach merged "iPhone 15" / "15 Plus" / "15 Pro" / "15 Pro Max"

import assert from 'node:assert/strict';
import test from 'node:test';
import { isFabricatedAmazonItem, dropFabricatedItems } from './fabricatedRows';

const amazonUrl = (asin: string) => `https://www.amazon.com/dp/${asin}?tag=buywhere-20`;

// The six rows QA reported, with the real 11-char ASINs observed live.
const fabricatedRows = [
  { name: 'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD', url: amazonUrl('B1016280791') },
  { name: 'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Premium', url: amazonUrl('B1016228331') },
  { name: 'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Plus', url: amazonUrl('B1016112561') },
  { name: 'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Elite', url: amazonUrl('B1016023131') },
  { name: 'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Max', url: amazonUrl('B1016248221') },
  { name: 'Gaming Laptop RTX 4060 144Hz 16GB RAM 1TB SSD Pro', url: amazonUrl('B1016256381') },
];

// Genuine rows observed in the same live response.
const genuineRows = [
  { name: 'GIGABYTE GAMING A16 Gaming Laptop - RTX 5060', url: 'https://www.newegg.com/p/N82E16834234567' },
  { name: 'Honeyuan H13 Air Purifier', url: amazonUrl('B0B9678Z4L') },
];

test('flags Amazon rows whose ASIN is not 10 characters', () => {
  for (const row of fabricatedRows) {
    assert.equal(isFabricatedAmazonItem(row), true, `expected fabricated: ${row.name}`);
  }
});

test('does not flag a well-formed 10-character Amazon ASIN', () => {
  assert.equal(isFabricatedAmazonItem({ url: amazonUrl('B0B9678Z4L') }), false);
  assert.equal(isFabricatedAmazonItem({ url: amazonUrl('B00MVWGQX0') }), false);
  assert.equal(isFabricatedAmazonItem({ url: 'https://www.amazon.co.uk/gp/product/B0CJF7WYWY' }), false);
});

test('does not flag non-Amazon merchants', () => {
  // Newegg/Shopify ids are not ASINs; an 11-char id there is perfectly normal.
  assert.equal(isFabricatedAmazonItem({ url: 'https://www.newegg.com/p/N82E16834234567' }), false);
  assert.equal(isFabricatedAmazonItem({ url: 'https://shop.example.com/products/12345678901' }), false);
  // A lookalike host must not be treated as Amazon.
  assert.equal(isFabricatedAmazonItem({ url: 'https://notamazon.example.com/dp/B1016280791' }), false);
});

test('falls back to click_url / affiliate_url when url is absent', () => {
  assert.equal(isFabricatedAmazonItem({ click_url: amazonUrl('B1016280791') }), true);
  assert.equal(isFabricatedAmazonItem({ affiliate_url: amazonUrl('B1016280791') }), true);
  assert.equal(isFabricatedAmazonItem({ click_url: amazonUrl('B0B9678Z4L') }), false);
});

test('tolerates missing or malformed urls', () => {
  assert.equal(isFabricatedAmazonItem({}), false);
  assert.equal(isFabricatedAmazonItem({ url: null }), false);
  assert.equal(isFabricatedAmazonItem({ url: 'not a url' }), false);
  assert.equal(isFabricatedAmazonItem({ url: 'https://www.amazon.com/' }), false);
});

test('drops the six QA-reported rows and keeps the genuine ones', () => {
  const mixed = [genuineRows[0], ...fabricatedRows, genuineRows[1]];
  const result = dropFabricatedItems(mixed);

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((item) => item.name),
    [genuineRows[0].name, genuineRows[1].name],
    'survivors must keep their original relative order',
  );
  for (const item of result) {
    assert.ok(!/RTX 4060 144Hz/.test(String(item.name)), 'no placeholder row may survive');
  }
});

test('fails open when every row looks fabricated', () => {
  const result = dropFabricatedItems(fabricatedRows);
  assert.equal(result.length, fabricatedRows.length, 'an empty results page is worse than seeded rows');
});

test('does not collapse real product families', () => {
  // The rejected title-clustering fix stripped trailing tier tokens, which
  // merged these four distinct products into a single card. Filtering on ASIN
  // shape leaves every genuine variant intact.
  const iphoneFamily = [
    { name: 'iPhone 15', url: amazonUrl('B0CHX1W1XY') },
    { name: 'iPhone 15 Plus', url: amazonUrl('B0CHX2F5QT') },
    { name: 'iPhone 15 Pro', url: amazonUrl('B0CHX1K2ZP') },
    { name: 'iPhone 15 Pro Max', url: amazonUrl('B0CHX8P4RN') },
    { name: 'MacBook Pro 14', url: amazonUrl('B0CM5JV268') },
    { name: 'MacBook 14', url: amazonUrl('B0CM5H6RJL') },
  ];

  const result = dropFabricatedItems(iphoneFamily);
  assert.equal(result.length, iphoneFamily.length);
  assert.deepEqual(
    result.map((item) => item.name),
    iphoneFamily.map((item) => item.name),
  );
});
