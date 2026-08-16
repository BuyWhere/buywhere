import assert from "node:assert/strict";
import test from "node:test";
import { normalizeComparisonOffer } from "@/lib/compare-page";

test("normalizeComparisonOffer uses API affiliate redirect URLs before falling back", () => {
  const offer = normalizeComparisonOffer({
    id: "prod_123",
    name: "Sample product",
    merchant: "sample_store",
    affiliate_redirect_url: "https://api.buywhere.ai/r/direct/prod_123?source=product_card",
    click_url: "https://merchant.example/product/prod_123",
  });

  assert.equal(offer.href, "https://api.buywhere.ai/r/direct/prod_123?source=product_card");
});

test("normalizeComparisonOffer uses click_url when affiliate_redirect_url is absent", () => {
  const offer = normalizeComparisonOffer({
    id: "prod_456",
    name: "Another product",
    merchant: "sample_store",
    click_url: "https://merchant.example/product/prod_456",
  });

  assert.equal(offer.href, "https://merchant.example/product/prod_456");
});

test("normalizeComparisonOffer reads availability from API metadata", () => {
  const offer = normalizeComparisonOffer({
    id: "prod_789",
    name: "Metadata availability product",
    merchant: "newegg_us",
    metadata: {
      availability: "in_stock",
      in_stock: true,
    },
  });

  assert.equal(offer.availability, "In stock");
  assert.equal(offer.inStock, true);
});

test("normalizeComparisonOffer handles metadata available: true", () => {
  const offer = normalizeComparisonOffer({
    id: "prod_888",
    name: "Available product",
    merchant: "walmart_us",
    metadata: {
      available: true,
    },
  });

  assert.equal(offer.availability, "Available");
  assert.equal(offer.inStock, true);
});

test("normalizeComparisonOffer normalizes unavailable string from metadata", () => {
  const offer = normalizeComparisonOffer({
    id: "prod_999",
    name: "Unavailable product",
    merchant: "walmart_us",
    metadata: {
      availability: "unavailable",
    },
  });

  assert.equal(offer.availability, "Out of stock");
  assert.equal(offer.inStock, false);
});

test("normalizeComparisonOffer reads price from API object form { amount, currency }", () => {
  // BUY-69923: /v1/products/search returns `price: { amount: 1074.41, currency: "SGD" }`.
  // The compare page previously only handled number|string and normalized every
  // object price to null → "Price unavailable" on all rows / Priced offers = 0.
  const offer = normalizeComparisonOffer({
    id: "54419109",
    title: "Laptop 15.6-inch Intel Core i7 16GB RAM 512GB SSD",
    merchant: "amazon.com",
    price: { amount: 1074.41, currency: "SGD" },
    metadata: { availability: "in_stock", in_stock: true },
  });

  assert.equal(offer.price, 1074.41);
  assert.equal(offer.currency, "SGD");
});

test("normalizeComparisonOffer still reads price from string amount inside object form", () => {
  const offer = normalizeComparisonOffer({
    id: "54412356",
    title: "GIGABYTE GAMING A16",
    merchant: "newegg_us",
    price: { amount: "1499.99", currency: "USD" },
  });

  assert.equal(offer.price, 1499.99);
  assert.equal(offer.currency, "USD");
});

test("normalizeComparisonOffer keeps scalar price working", () => {
  const offer = normalizeComparisonOffer({
    id: "prod_scalar",
    title: "Scalar price product",
    merchant: "bestbuy",
    price: 899,
    currency: "USD",
  });

  assert.equal(offer.price, 899);
  assert.equal(offer.currency, "USD");
});

test("normalizeComparisonOffer falls back to top-level currency when object price has none", () => {
  const offer = normalizeComparisonOffer({
    id: "prod_nocur",
    title: "Object price without currency",
    merchant: "amazon.com",
    price: { amount: 42 },
    currency: "USD",
  });

  assert.equal(offer.price, 42);
  assert.equal(offer.currency, "USD");
});
