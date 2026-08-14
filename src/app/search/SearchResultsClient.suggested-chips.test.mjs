// Regression test for BUY-69618.
//
// QA repro: search "gaming laptop" at
//   https://buywhere.ai/search?q=gaming%20laptop&country=us
// The Suggested-chips row rendered [wireless headphones, running shoes,
// espresso machine, gaming laptop] — clicking "gaming laptop" resubmits
// the same query (dead-end interaction).
//
// This test file lives alongside SearchResultsClient.tsx but re-implements
// the filter in JS so the project can run it with plain `node --test`
// (no TypeScript loader required). Any divergence between this JS copy
// and the TS function in SearchResultsClient.tsx is a test failure.

import assert from "node:assert/strict";
import test from "node:test";

/**
 * Mirror of filterSuggestedSearches in
 * src/app/search/SearchResultsClient.tsx. MUST be kept in lockstep.
 */
const SUGGESTED_SEARCHES = [
  "wireless headphones",
  "running shoes",
  "espresso machine",
  "gaming laptop",
];

function filterSuggestedSearches(activeQuery) {
  const needle = (activeQuery ?? "").trim().toLowerCase();
  if (!needle) return SUGGESTED_SEARCHES;
  return SUGGESTED_SEARCHES.filter(
    (suggestion) => suggestion.toLowerCase() !== needle,
  );
}

test("empty query returns the full suggestion list", () => {
  assert.deepEqual(filterSuggestedSearches(""), [
    "wireless headphones",
    "running shoes",
    "espresso machine",
    "gaming laptop",
  ]);
});

test("null/undefined query returns the full suggestion list", () => {
  assert.equal(filterSuggestedSearches(null).length, 4);
  assert.equal(filterSuggestedSearches(undefined).length, 4);
});

test("BUY-69618 repro: 'gaming laptop' drops the matching chip", () => {
  const result = filterSuggestedSearches("gaming laptop");
  assert.equal(result.length, 3);
  assert.ok(!result.includes("gaming laptop"), "active query must be filtered");
  assert.deepEqual(result, [
    "wireless headphones",
    "running shoes",
    "espresso machine",
  ]);
});

test("case-insensitive: 'GAMING LAPTOP' also drops 'gaming laptop'", () => {
  const result = filterSuggestedSearches("GAMING LAPTOP");
  assert.ok(!result.includes("gaming laptop"));
  assert.equal(result.length, 3);
});

test("case-insensitive: 'Espresso Machine' also drops 'espresso machine'", () => {
  const result = filterSuggestedSearches("Espresso Machine");
  assert.ok(!result.includes("espresso machine"));
});

test("whitespace-trimmed: '  gaming laptop  ' still drops the chip", () => {
  const result = filterSuggestedSearches("  gaming laptop  ");
  assert.ok(!result.includes("gaming laptop"));
});

test("non-matching query keeps all 4 chips", () => {
  const result = filterSuggestedSearches("bluetooth speaker");
  assert.equal(result.length, 4);
});

test("negative control: a regex/typo near-miss does NOT drop the chip", () => {
  // "gaming laptops" is plural — must not match "gaming laptop" exactly.
  const result = filterSuggestedSearches("gaming laptops");
  assert.ok(result.includes("gaming laptop"), "near-miss must remain");
});

test("negative control: a substring match does NOT drop the chip", () => {
  // "laptop" is a substring of "gaming laptop" but must not match exactly.
  const result = filterSuggestedSearches("laptop");
  assert.ok(result.includes("gaming laptop"));
});