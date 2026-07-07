import assert from "node:assert/strict";
import test from "node:test";
import {
  getComparisonProductTypeCategory,
  isComparisonOfferRelevantToQuery,
  normalizeComparisonOffer,
  type ComparisonOffer,
} from "@/lib/compare-page";

function offer(overrides: Partial<ComparisonOffer>): ComparisonOffer {
  return {
    id: "1",
    name: "Apple iPhone 15 Pro 128GB Natural Titanium",
    merchant: "Amazon",
    price: 999,
    currency: "USD",
    imageUrl: null,
    href: "#",
    availability: "In stock",
    inStock: true,
    brand: "Apple",
    category: "Smartphones",
    lastUpdated: null,
    ...overrides,
  };
}

test("compare query relevance keeps iPhone 15 Pro offers", () => {
  assert.equal(
    isComparisonOfferRelevantToQuery(offer({}), "iphone 15 pro"),
    true,
  );
});

test("compare query relevance rejects unrelated Sony headphone offers", () => {
  assert.equal(
    isComparisonOfferRelevantToQuery(
      offer({
        name: "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
        brand: "Sony",
        category: "Headphones",
      }),
      "iphone 15 pro",
    ),
    false,
  );
});

test("compare query relevance rejects headphone offers for laptop queries", () => {
  assert.equal(
    isComparisonOfferRelevantToQuery(
      offer({
        name: "Sony WH-1000XM5 Wireless Noise Canceling Headphones for Laptop",
        brand: "Sony",
        category: "Headphones",
      }),
      "laptop",
    ),
    false,
  );
});

test("compare query maps laptop to laptop category filter", () => {
  assert.equal(getComparisonProductTypeCategory("laptop"), "Laptop");
});

test("compare query relevance tolerates model-token punctuation differences", () => {
  assert.equal(
    isComparisonOfferRelevantToQuery(
      offer({ name: "Sony WH1000XM5 Noise Canceling Headphones", brand: "Sony" }),
      "sony wh-1000xm5",
    ),
    true,
  );
});

test("normalizeComparisonOffer drops placeholder links", () => {
  const normalized = normalizeComparisonOffer({
    id: 12,
    name: "Test Product",
    buy_url: "#",
    price: 100,
    source: "Amazon",
  });

  assert.equal(normalized.href, "");
});

test("normalizeComparisonOffer keeps relative click redirect links", () => {
  const normalized = normalizeComparisonOffer({
    id: 15,
    title: "Apple iPhone 15 Pro 256GB",
    click_url: "/api/clickthrough?product_id=15",
    price: "1599.00",
    source: "shopee_sg",
  });

  assert.equal(normalized.name, "Apple iPhone 15 Pro 256GB");
  assert.equal(normalized.href, "/api/clickthrough?product_id=15");
});
