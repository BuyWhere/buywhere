import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMerchantName,
  formatPrice,
  hasUsableProductImage,
  normalizeProduct,
  sortProductsByImageQuality,
  type SearchApiItem,
} from "@/app/search/normalize-product";

test("normalizeProduct flattens object-shaped price + picks affiliate redirect", () => {
  const item: SearchApiItem = {
    id: 54452825,
    title: "GIGABYTE GAMING A16 Gaming Laptop",
    price: { amount: 1349.99, currency: "USD" },
    merchant_name: "newegg_us",
    click_url: "https://api.buywhere.ai/api/click?url=https%3A%2F%2Fwww.newegg.com/...",
    affiliate_redirect_url: "https://api.buywhere.ai/r/direct/54452825",
    image_url: "https://c1.neweggimages.com/ProductImageCompressAll1280/34-233-624-02.jpg",
    metadata: { brand: "GIGABYTE", category: "Laptops" },
  };

  const result = normalizeProduct(item, "USD");
  assert.equal(result.id, "54452825");
  assert.equal(result.name, "GIGABYTE GAMING A16 Gaming Laptop");
  assert.equal(result.price, 1349.99);
  assert.equal(result.currency, "USD");
  assert.equal(result.merchant, "Newegg Us");
  assert.equal(result.href, "https://api.buywhere.ai/r/direct/54452825");
  assert.equal(result.brand, "GIGABYTE");
  assert.equal(result.category, "Laptops");
  assert.equal(
    result.imageUrl,
    "https://c1.neweggimages.com/ProductImageCompressAll1280/34-233-624-02.jpg",
  );
});

test("normalizeProduct falls back to flat price fields when price is scalar", () => {
  const result = normalizeProduct(
    {
      id: "abc",
      name: "Test Product",
      price_amount: 49.5,
      price_currency: "SGD",
      merchant: "Shopify Wellbots Com",
      url: "https://example.com/p/abc",
      image_url: "https://example.com/i.jpg",
    },
    "USD",
  );
  assert.equal(result.price, 49.5);
  assert.equal(result.currency, "SGD");
  assert.equal(result.merchant, "Shopify Wellbots Com");
  assert.equal(result.href, "https://example.com/p/abc");
});

test("normalizeProduct rejects placeholder image URLs", () => {
  const result = normalizeProduct(
    {
      id: "x",
      name: "Generic Item",
      image_url: "https://example.com/placeholder-image.jpg",
      url: "#",
    },
    "USD",
  );
  assert.equal(result.imageUrl, null);
});

test("formatMerchantName underscores + dashes into Title Case", () => {
  assert.equal(formatMerchantName("newegg_us"), "Newegg Us");
  assert.equal(formatMerchantName("SHOPIFY BUY30620 STOCK"), "SHOPIFY BUY30620 STOCK");
  assert.equal(formatMerchantName(""), "BuyWhere seller");
  assert.equal(formatMerchantName(null), "BuyWhere seller");
});

test("formatPrice renders USD with currency, null falls back to 'Price unavailable'", () => {
  assert.equal(formatPrice(1349.99, "USD"), "$1,349.99");
  assert.equal(formatPrice(null, "USD"), "Price unavailable");
  assert.equal(formatPrice(0.99, "SGD"), "S$0.99");
});

test("hasUsableProductImage drops Unsplash + generic + no-image hosts", () => {
  assert.equal(hasUsableProductImage("https://images.unsplash.com/photo-1"), false);
  assert.equal(hasUsableProductImage("https://example.com/placeholder.jpg"), false);
  assert.equal(hasUsableProductImage("https://example.com/no-image.png"), false);
  assert.equal(hasUsableProductImage("https://c1.neweggimages.com/foo.jpg"), true);
  assert.equal(hasUsableProductImage(null), false);
  assert.equal(hasUsableProductImage("not a url"), false);
});

test("sortProductsByImageQuality keeps image-bearing products on top", () => {
  const sorted = sortProductsByImageQuality([
    { id: "a", name: "No image A", price: 1, currency: "USD", merchant: "M", imageUrl: null, href: "#", brand: null, category: null },
    { id: "b", name: "Image B", price: 2, currency: "USD", merchant: "M", imageUrl: "https://example.com/b.jpg", href: "#", brand: null, category: null },
    { id: "c", name: "No image C", price: 3, currency: "USD", merchant: "M", imageUrl: null, href: "#", brand: null, category: null },
  ]);
  assert.equal(sorted[0].id, "b");
  assert.deepEqual(
    sorted.slice(1).map((p) => p.id),
    ["a", "c"],
  );
});
