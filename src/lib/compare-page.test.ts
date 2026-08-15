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

test("normalizeComparisonOffer handles nested price object from live API", () => {
  const offer = normalizeComparisonOffer({
    id: "54419109",
    title: "Laptop 15.6-inch Intel Core i7",
    merchant: "amazon.com",
    price: { amount: 1074.41, currency: "SGD" },
  });

  assert.equal(offer.price, 1074.41);
  assert.equal(offer.currency, "SGD");
});

test("normalizeComparisonOffer extracts price from nested metadata.in_stock", () => {
  const offer = normalizeComparisonOffer({
    id: "54412356",
    title: "Gaming Laptop",
    merchant: "newegg_us",
    price: { amount: 1499.99, currency: "USD" },
    metadata: { in_stock: true, availability: "in_stock" },
  });

  assert.equal(offer.price, 1499.99);
  assert.equal(offer.inStock, true);
  assert.equal(offer.availability, "In stock");
});

test("normalizeComparisonOffer falls back to price_amount / price_currency fields", () => {
  const offer = normalizeComparisonOffer({
    id: "123",
    name: "Test product",
    merchant: "test_store",
    price_amount: 99.99,
    price_currency: "EUR",
  });

  assert.equal(offer.price, 99.99);
  assert.equal(offer.currency, "EUR");
});

test("normalizeComparisonOffer reads brand/category from metadata", () => {
  const offer = normalizeComparisonOffer({
    id: "456",
    name: "Phone",
    merchant: "shop",
    price: { amount: 699, currency: "USD" },
    metadata: { brand: "Apple", category: "Smartphones" },
  });

  assert.equal(offer.brand, "Apple");
  assert.equal(offer.category, "Smartphones");
});

test("normalizeComparisonOffer uses merchant_name over merchant", () => {
  const offer = normalizeComparisonOffer({
    id: "789",
    name: "Test",
    merchant: "old_merchant",
    merchant_name: "New Merchant",
  });

  assert.equal(offer.merchant, "New Merchant");
});
