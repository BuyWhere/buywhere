// Regression tests for BUY-64057: SEO landing page currency display
//
// The issue: SGD prices on SEO landing pages were showing as "$" instead of "S$",
// making them indistinguishable from USD prices on US pages.
//
// The fix: formatPrice() now explicitly prepends "S" for SGD currency to ensure
// proper visual distinction between Singapore and US pricing.
import assert from "node:assert/strict";
import test from "node:test";
import { formatPrice } from "./format-price.js";

test("formats SGD prices with S$ prefix", () => {
  assert.equal(formatPrice(2599, "SGD"), "S$2,599");
  assert.equal(formatPrice(159, "SGD"), "S$159");
  assert.equal(formatPrice(100, "SGD"), "S$100");
  assert.equal(formatPrice(0, "SGD"), "S$0");
});

test("formats USD prices with $ prefix", () => {
  assert.equal(formatPrice(2599, "USD"), "$2,599");
  assert.equal(formatPrice(159, "USD"), "$159");
  assert.equal(formatPrice(100, "USD"), "$100");
});

test("handles null prices", () => {
  assert.equal(formatPrice(null, "SGD"), "Price unavailable");
  assert.equal(formatPrice(null, "USD"), "Price unavailable");
});

test("handles other currencies", () => {
  // Other currencies still use Intl.NumberFormat
  assert.equal(formatPrice(100, "EUR"), "€100");
  assert.equal(formatPrice(100, "GBP"), "£100");
});
