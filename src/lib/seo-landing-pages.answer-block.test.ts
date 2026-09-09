import assert from "node:assert/strict";
import test from "node:test";
import { buildAnswerBlock, type LandingProduct } from "@/lib/seo-landing-pages";

function product(name: string, price: number | null, merchant: string): LandingProduct {
  return {
    id: `${merchant}-${name}`,
    name,
    price,
    currency: "USD",
    merchant,
    imageUrl: null,
    href: "https://example.com/" + name,
    brand: null,
    category: "test",
  };
}

const checked = { iso: "2026-08-25T16:30:00.000Z", text: "August 25, 2026" };

test("buildAnswerBlock returns null when fewer than 2 priced merchants", () => {
  const products = [
    product("Acme Widget", 199, "amazon_us"),
  ];
  const result = buildAnswerBlock(
    { searchQuery: "widgets", country: "US", currency: "USD" },
    products,
    checked,
  );
  assert.equal(result, null);
});

test("buildAnswerBlock returns null when all offers have null prices", () => {
  const products = [
    product("Acme Widget", null, "amazon_us"),
    product("Acme Widget Plus", null, "walmart_us"),
  ];
  const result = buildAnswerBlock(
    { searchQuery: "widgets", country: "US", currency: "USD" },
    products,
    checked,
  );
  assert.equal(result, null);
});

test("buildAnswerBlock names the cheapest + next retailer with the delta", () => {
  const products = [
    product("Acme Widget", 749, "walmart_us"),
    product("Acme Widget", 799, "amazon_us"),
    product("Acme Widget", 829, "bestbuy_us"),
  ];
  const result = buildAnswerBlock(
    { searchQuery: "Widget", country: "US", currency: "USD" },
    products,
    checked,
  );
  assert.ok(result, "expected answer block to render");
  // Verdict sentence must name cheapest + delta + next retailer.
  assert.match(result.text, /cheapest Widget in US today/i);
  assert.match(result.text, /Walmart/i);
  assert.match(result.text, /Amazon/i);
  assert.match(result.text, /less than/i);
  // Delta = 799 - 749 = 50
  assert.match(result.text, /US\$749/);
  assert.match(result.text, /US\$50/);
  // Trailing "Prices checked … across <N> retailers" clause.
  assert.match(result.text, /Prices checked/);
  assert.match(result.text, /August 25, 2026/);
  assert.match(result.text, /across 3 retailers/);
  assert.equal(result.retailerCount, 3);
  assert.equal(result.cheapestPrice, 749);
  assert.equal(result.nextPrice, 799);
  assert.equal(result.checkedIso, checked.iso);
});

test("buildAnswerBlock deduplicates merchants by lowest price", () => {
  // Two Walmart rows at $749 and $799 — keep the cheapest.
  const products = [
    product("Widget (cheap)", 749, "walmart_us"),
    product("Widget (pricier)", 799, "walmart_us"),
    product("Widget Pro", 799, "amazon_us"),
  ];
  const result = buildAnswerBlock(
    { searchQuery: "Widget", country: "US", currency: "USD" },
    products,
    checked,
  );
  assert.ok(result, "expected answer block to render");
  // 2 distinct merchants, not 3.
  assert.equal(result.retailerCount, 2);
  // Delta still 799 - 749 = 50 even though Walmart appears twice upstream.
  assert.match(result.text, /US\$50/);
});

test("buildAnswerBlock renders SG currency formatting", () => {
  const products = [
    product("Widget", 1000, "shopee_sg"),
    product("Widget", 1100, "lazada_sg"),
    product("Widget", 1100, "amazon_sg"),
  ];
  const result = buildAnswerBlock(
    { searchQuery: "Widget", country: "SG", currency: "SGD" },
    products,
    checked,
  );
  assert.ok(result, "expected answer block to render");
  // SG prefix on the dollar amount.
  assert.match(result.text, /S\$/);
  assert.match(result.text, /S\$1,000/);
  // Country in the verdict.
  assert.match(result.text, /in SG today/);
});

test("buildAnswerBlock word count is in the 40-60 range", () => {
  const products = [
    product("Widget", 749, "walmart_us"),
    product("Widget", 799, "amazon_us"),
    product("Widget", 829, "bestbuy_us"),
  ];
  const result = buildAnswerBlock(
    { searchQuery: "Widget", country: "US", currency: "USD" },
    products,
    checked,
  );
  assert.ok(result, "expected answer block to render");
  const wordCount = result.text.split(/\s+/).filter(Boolean).length;
  // BUY-74928 spec: 40-60 words. Allow 35-65 for currency-formatter variance.
  assert.ok(
    wordCount >= 35 && wordCount <= 65,
    `word count ${wordCount} outside the 35-65 band (text=${result.text})`,
  );
});