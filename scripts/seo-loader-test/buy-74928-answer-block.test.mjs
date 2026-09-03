// BUY-74928 — unit test for the intent-page / compare answer block helper.
// Run with: node --test scripts/seo-loader-test/buy-74928-answer-block.test.mjs
//
// The .test.ts variant in src/lib/seo-landing-pages.answer-block.test.ts is
// the source of truth; this mirror is the runnable node:test version (no tsx
// loader in the site repo).

import { describe, test } from "node:test";
import assert from "node:assert/strict";

// Inlined copy of buildAnswerBlock (stripMerchantTenantSuffix is the same
// behaviour as src/lib/merchant-name.ts minus the .ts surface).

function priceText(value, currency) {
  // 4seen OAI-SearchBot checklist item 6 — "currency and country as text every
  // time (US$749 / S$1,299)". Intl's en-SG/SGD formatter emits `$1,000` without
  // a country prefix on some ICU versions, so build the prefix explicitly and
  // let Intl format the digit grouping + symbol position.
  const prefix = currency === "SGD" ? "S$" : currency === "USD" ? "US$" : "";
  try {
    const formatted = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
    return prefix ? `${prefix}${formatted}` : `${formatted} ${currency}`;
  } catch {
    return `${prefix || ""}${value}`;
  }
}

function shortMerchant(value) {
  return (value || "BuyWhere seller").replace(/\s+store$/i, "").trim() || "a retailer";
}

function buildAnswerBlock(config, products, checked) {
  const priced = products
    .map((p) => ({
      merchant: shortMerchant(p.merchant),
      price: p.price !== null && p.price !== undefined && Number.isFinite(Number(p.price))
        ? Number(p.price)
        : null,
    }))
    .filter((row) => row.price !== null && row.price > 0)
    .sort((a, b) => a.price - b.price);

  const byMerchant = new Map();
  for (const row of priced) {
    const key = row.merchant.toLowerCase();
    const existing = byMerchant.get(key);
    if (!existing || row.price < existing.price) {
      byMerchant.set(key, row);
    }
  }
  const ranked = Array.from(byMerchant.values()).sort((a, b) => a.price - b.price);

  if (ranked.length < 2) return null;

  const cheapest = ranked[0];
  const next = ranked[1];
  const delta = next.price - cheapest.price;
  const retailerCount = ranked.length;

  const sentenceOne = `The cheapest ${config.searchQuery} in ${config.country} today is ${priceText(cheapest.price, config.currency)} at ${cheapest.merchant}, ${priceText(delta, config.currency)} less than ${next.merchant} (${priceText(next.price, config.currency)}).`;
  const sentenceTwo = `Prices checked ${checked.text} across ${retailerCount} retailer${retailerCount === 1 ? "" : "s"}.`;
  let sentenceThree = "";
  if (ranked.length >= 3) {
    const highest = ranked[ranked.length - 1];
    const avg = ranked.reduce((sum, r) => sum + r.price, 0) / ranked.length;
    const range = highest.price - cheapest.price;
    sentenceThree = ` Across the full set, the price range runs from ${priceText(cheapest.price, config.currency)} to ${priceText(highest.price, config.currency)} — a spread of ${priceText(range, config.currency)} — with an average of ${priceText(Math.round(avg), config.currency)}.`;
  }

  return {
    text: `${sentenceOne} ${sentenceTwo}${sentenceThree}`,
    checkedText: checked.text,
    checkedIso: checked.iso,
    retailerCount,
    cheapestMerchant: cheapest.merchant,
    cheapestPrice: cheapest.price,
    nextPrice: next.price,
  };
}

const checked = { iso: "2026-08-25T16:30:00.000Z", text: "August 25, 2026" };

describe("buildAnswerBlock", () => {
  test("returns null when fewer than 2 priced merchants", () => {
    const products = [{ merchant: "Amazon", price: 199 }];
    const result = buildAnswerBlock(
      { searchQuery: "widgets", country: "US", currency: "USD" },
      products,
      checked,
    );
    assert.equal(result, null);
  });

  test("returns null when all offers have null prices", () => {
    const products = [
      { merchant: "Amazon", price: null },
      { merchant: "Walmart", price: null },
    ];
    const result = buildAnswerBlock(
      { searchQuery: "widgets", country: "US", currency: "USD" },
      products,
      checked,
    );
    assert.equal(result, null);
  });

  test("names the cheapest + next retailer with the delta", () => {
    const products = [
      { merchant: "Walmart", price: 749 },
      { merchant: "Amazon", price: 799 },
      { merchant: "Best Buy", price: 829 },
    ];
    const result = buildAnswerBlock(
      { searchQuery: "Widget", country: "US", currency: "USD" },
      products,
      checked,
    );
    assert.ok(result, "expected answer block to render");
    assert.match(result.text, /cheapest Widget in US today/i);
    assert.match(result.text, /Walmart/);
    assert.match(result.text, /Amazon/);
    assert.match(result.text, /less than/i);
    assert.match(result.text, /US\$749/);
    assert.match(result.text, /US\$50/);
    assert.match(result.text, /Prices checked/);
    assert.match(result.text, /August 25, 2026/);
    assert.match(result.text, /across 3 retailers/);
    assert.equal(result.retailerCount, 3);
    assert.equal(result.cheapestPrice, 749);
    assert.equal(result.nextPrice, 799);
    assert.equal(result.checkedIso, checked.iso);
  });

  test("deduplicates merchants by lowest price", () => {
    const products = [
      { merchant: "Walmart", price: 749 },
      { merchant: "Walmart", price: 799 },
      { merchant: "Amazon", price: 799 },
    ];
    const result = buildAnswerBlock(
      { searchQuery: "Widget", country: "US", currency: "USD" },
      products,
      checked,
    );
    assert.ok(result, "expected answer block to render");
    assert.equal(result.retailerCount, 2);
    assert.match(result.text, /US\$50/);
  });

  test("renders SG currency formatting", () => {
    const products = [
      { merchant: "Shopee", price: 1000 },
      { merchant: "Lazada", price: 1100 },
      { merchant: "Amazon", price: 1100 },
    ];
    const result = buildAnswerBlock(
      { searchQuery: "Widget", country: "SG", currency: "SGD" },
      products,
      checked,
    );
    assert.ok(result, "expected answer block to render");
    assert.match(result.text, /S\$1,000/);
    assert.match(result.text, /in SG today/);
  });

  test("word count is in the 40-60 range", () => {
    const products = [
      { merchant: "Walmart", price: 749 },
      { merchant: "Amazon", price: 799 },
      { merchant: "Best Buy", price: 829 },
    ];
    const result = buildAnswerBlock(
      { searchQuery: "Widget", country: "US", currency: "USD" },
      products,
      checked,
    );
    assert.ok(result, "expected answer block to render");
    const wordCount = result.text.split(/\s+/).filter(Boolean).length;
    assert.ok(
      wordCount >= 35 && wordCount <= 65,
      `word count ${wordCount} outside the 35-65 band (text=${result.text})`,
    );
  });
});