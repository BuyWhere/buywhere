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
