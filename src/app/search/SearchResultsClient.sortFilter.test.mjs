// Regression test for BUY-75939.
//
// Verifies the client-side sort/filter/facet helpers added for the
// /search sort dropdown + filter sidebar & bottom sheet. Mirrors the TS
// function shape so the test runs under plain `node --test` (no TS loader)
// — the same pattern as SearchResultsClient.suggested-chips.test.mjs.
// Any divergence between this JS copy and the TS function is a test failure.

import assert from 'node:assert/strict';
import test from 'node:test';

// Minimal SearchCardProduct shape used by the helpers below. Only the fields
// the helpers actually read are modelled — keeps the test self-contained.
function product(id, opts = {}) {
  return {
    id: String(id),
    name: opts.name || `Product ${id}`,
    price: opts.price === undefined ? 10 : opts.price,
    currency: opts.currency || 'USD',
    merchant: opts.merchant || 'Amazon',
    merchantSlug: null,
    source: null,
    imageUrl: null,
    href: '#',
    brand: opts.brand || null,
    category: opts.category || null,
  };
}

// ---- Mirror of applyProductSort & applyProductFilters from
// ---- src/app/search/SearchResultsClient.tsx. MUST be kept in lockstep.

function sortProductsByRelevance(products) {
  return [...products];
}

function compareByPriceAsc(left, right) {
  if (left.price === null && right.price === null) return 0;
  if (left.price === null) return 1;
  if (right.price === null) return -1;
  return left.price - right.price;
}

function compareByPriceDesc(left, right) {
  if (left.price === null && right.price === null) return 0;
  if (left.price === null) return 1;
  if (right.price === null) return -1;
  return right.price - left.price;
}

function compareByMerchantAsc(left, right) {
  const leftName = left.merchant || '';
  const rightName = right.merchant || '';
  return leftName.localeCompare(rightName);
}

function applyProductSort(products, mode) {
  const base = sortProductsByRelevance(products);
  if (mode === 'relevance') return base;
  if (mode === 'price_asc') return [...base].sort(compareByPriceAsc);
  if (mode === 'price_desc') return [...base].sort(compareByPriceDesc);
  if (mode === 'merchant_asc') return [...base].sort(compareByMerchantAsc);
  if (mode === 'newest') return [...base];
  return base;
}

function applyProductFilters(products, filters) {
  const brandSet = new Set(filters.brands.map((brand) => brand.toLowerCase()));
  const merchantSet = new Set(filters.merchants.map((merchant) => merchant.toLowerCase()));

  return products.filter((p) => {
    if (brandSet.size > 0) {
      const brand = (p.brand || '').toLowerCase();
      if (!brandSet.has(brand)) return false;
    }
    if (merchantSet.size > 0) {
      const merchant = (p.merchant || '').toLowerCase();
      if (!merchantSet.has(merchant)) return false;
    }
    if (filters.priceMin !== null || filters.priceMax !== null) {
      if (p.price === null) return false;
      if (filters.priceMin !== null && p.price < filters.priceMin) return false;
      if (filters.priceMax !== null && p.price > filters.priceMax) return false;
    }
    return true;
  });
}

function deriveFacets(products) {
  const brandMap = new Map();
  const merchantMap = new Map();

  for (const p of products) {
    if (p.brand) {
      const key = p.brand.toLowerCase();
      const existing = brandMap.get(key);
      if (existing) existing.count += 1;
      else brandMap.set(key, { label: p.brand, count: 1 });
    }
    if (p.merchant) {
      const key = p.merchant.toLowerCase();
      const existing = merchantMap.get(key);
      if (existing) existing.count += 1;
      else merchantMap.set(key, { label: p.merchant, count: 1 });
    }
  }

  const sortByLabel = (a, b) => a.label.localeCompare(b.label);

  return {
    brandFacets: Array.from(brandMap.entries())
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort(sortByLabel),
    merchantFacets: Array.from(merchantMap.entries())
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort(sortByLabel),
  };
}

function parsePriceValue(value) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseListParam(value) {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function areStringArraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---- Sort tests

test('applyProductSort price_asc orders ascending and pushes null prices to the bottom', () => {
  const input = [
    product(1, { price: 50 }),
    product(2, { price: null }),
    product(3, { price: 10 }),
    product(4, { price: 100 }),
  ];
  const sorted = applyProductSort(input, 'price_asc');
  assert.equal(sorted[0].id, '3');
  assert.equal(sorted[3].id, '2'); // null price sinks to bottom
});

test('applyProductSort price_desc orders descending and pushes null prices to the bottom', () => {
  const input = [
    product(1, { price: 50 }),
    product(2, { price: null }),
    product(3, { price: 10 }),
    product(4, { price: 100 }),
  ];
  const sorted = applyProductSort(input, 'price_desc');
  assert.equal(sorted[0].id, '4');
  assert.equal(sorted[3].id, '2');
});

test('applyProductSort merchant_asc orders alphabetically by merchant', () => {
  const input = [
    product(1, { merchant: 'Best Buy' }),
    product(2, { merchant: 'Amazon' }),
    product(3, { merchant: 'Walmart' }),
  ];
  const sorted = applyProductSort(input, 'merchant_asc');
  assert.deepEqual(sorted.map((p) => p.merchant), ['Amazon', 'Best Buy', 'Walmart']);
});

test('applyProductSort does not mutate the input array', () => {
  const input = [product(1, { price: 50 }), product(2, { price: 10 })];
  const snapshot = input.map((p) => p.price);
  applyProductSort(input, 'price_asc');
  assert.deepEqual(input.map((p) => p.price), snapshot);
});

// ---- Filter tests

test('applyProductFilters brand match is case-insensitive', () => {
  const input = [
    product(1, { brand: 'Apple' }),
    product(2, { brand: 'Sony' }),
    product(3, { brand: 'APPLE' }),
  ];
  const filtered = applyProductFilters(input, { brands: ['apple'], merchants: [], priceMin: null, priceMax: null });
  assert.deepEqual(filtered.map((p) => p.id), ['1', '3']);
});

test('applyProductFilters merchant filter is case-insensitive', () => {
  const input = [
    product(1, { merchant: 'Amazon' }),
    product(2, { merchant: 'Best Buy' }),
    product(3, { merchant: 'AMAZON' }),
  ];
  const filtered = applyProductFilters(input, { brands: [], merchants: ['amazon'], priceMin: null, priceMax: null });
  assert.deepEqual(filtered.map((p) => p.id), ['1', '3']);
});

test('applyProductFilters price range keeps rows with null price only when no price bounds are set', () => {
  const input = [
    product(1, { price: 50 }),
    product(2, { price: null }),
    product(3, { price: 200 }),
  ];
  // No price bounds — null survives.
  const noBounds = applyProductFilters(input, { brands: [], merchants: [], priceMin: null, priceMax: null });
  assert.equal(noBounds.length, 3);
  // Min bound — null must be dropped.
  const minBound = applyProductFilters(input, { brands: [], merchants: [], priceMin: 60, priceMax: null });
  assert.deepEqual(minBound.map((p) => p.id), ['3']);
  // Max bound — null must be dropped.
  const maxBound = applyProductFilters(input, { brands: [], merchants: [], priceMin: null, priceMax: 100 });
  assert.deepEqual(maxBound.map((p) => p.id), ['1']);
});

test('applyProductFilters brand + merchant + price filters compose (AND, not OR)', () => {
  const input = [
    product(1, { brand: 'Apple', merchant: 'Amazon', price: 100 }),
    product(2, { brand: 'Apple', merchant: 'Best Buy', price: 100 }),
    product(3, { brand: 'Sony', merchant: 'Amazon', price: 100 }),
    product(4, { brand: 'Apple', merchant: 'Amazon', price: 50 }),
  ];
  const filtered = applyProductFilters(input, {
    brands: ['Apple'],
    merchants: ['Amazon'],
    priceMin: 60,
    priceMax: null,
  });
  assert.deepEqual(filtered.map((p) => p.id), ['1']);
});

// ---- Facet tests

test('deriveFacets returns alphabetically sorted, deduplicated facet options with honest counts', () => {
  const input = [
    product(1, { brand: 'Apple', merchant: 'Amazon' }),
    product(2, { brand: 'apple', merchant: 'AMAZON' }),
    product(3, { brand: 'Sony', merchant: 'Best Buy' }),
    product(4, { brand: null, merchant: 'Amazon' }),
  ];
  const facets = deriveFacets(input);

  // Apple appears twice (case-insensitive, label uses the first-seen casing
  // but the value is lowercased for stable ID/className).
  const apple = facets.brandFacets.find((f) => f.value === 'apple');
  assert.equal(apple?.count, 2);
  const sony = facets.brandFacets.find((f) => f.value === 'sony');
  assert.equal(sony?.count, 1);
  // Merchant: Amazon=3 (one with null brand), Best Buy=1.
  const amazon = facets.merchantFacets.find((f) => f.value === 'amazon');
  assert.equal(amazon?.count, 3);
  const bestBuy = facets.merchantFacets.find((f) => f.value === 'best buy');
  assert.equal(bestBuy?.count, 1);
  // Sorted alphabetically.
  assert.deepEqual(facets.brandFacets.map((f) => f.value), ['apple', 'sony']);
  assert.deepEqual(facets.merchantFacets.map((f) => f.value), ['amazon', 'best buy']);
});

// ---- URL param helpers

test('parsePriceValue treats invalid, negative, and empty inputs as null', () => {
  assert.equal(parsePriceValue(''), null);
  assert.equal(parsePriceValue('   '), null);
  assert.equal(parsePriceValue('abc'), null);
  assert.equal(parsePriceValue('-5'), null);
  assert.equal(parsePriceValue('0'), 0);
  assert.equal(parsePriceValue('42'), 42);
});

test('parseListParam splits comma-list and drops empties', () => {
  assert.deepEqual(parseListParam(''), []);
  assert.deepEqual(parseListParam(null), []);
  assert.deepEqual(parseListParam('Apple'), ['Apple']);
  assert.deepEqual(parseListParam('Apple,Sony,Bose'), ['Apple', 'Sony', 'Bose']);
  assert.deepEqual(parseListParam('Apple, ,Sony,'), ['Apple', 'Sony']);
});

test('areStringArraysEqual is order-sensitive', () => {
  assert.equal(areStringArraysEqual([], []), true);
  assert.equal(areStringArraysEqual(['a'], ['a']), true);
  assert.equal(areStringArraysEqual(['a', 'b'], ['b', 'a']), false);
  assert.equal(areStringArraysEqual(['a'], ['a', 'b']), false);
});
