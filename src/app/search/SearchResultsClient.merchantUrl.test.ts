// Regression test for BUY-72907.
//
// QA found that search result cards displayed platform names like "Shopify" and
// "Google Shopping" instead of the actual retailer/store name. Users saw
// platform badges instead of the actual merchant, reducing trust in "View Deal"
// decisions.
//
// Fix: extract merchant from product URL domain before falling back to the
// legacy merchant/source chain. A Wellbots product scraped via Shopify should
// show "Wellbots" from its URL, not "Shopify" from its source field.
import assert from "node:assert";
import test from "node:test";
import { __test__ } from "./SearchResultsClient";

const { normalizeProduct } = __test__;

test("BUY-72907: URL-derived merchant overrides platform source", () => {
  // A Wellbots product that happens to be scraped via Shopify.
  // Should show "Wellbots" from the URL, not "Shopify" from source.
  const product = normalizeProduct(
    {
      id: "123",
      title: "Sony WH-1000XM5 Wireless Headphones",
      price: { amount: 329.99, currency: "USD" },
      merchant: "shopify_wellbots_com", // Internal platform ID
      merchant_name: "Shopify Wellbots Com", // Also platform-based
      source: "shopify", // Falls back to "Shopify"
      click_url: "https://www.wellbots.com/products/sony-wh-1000xm5",
      affiliate_redirect_url: "https://www.wellbots.com/track/123",
    },
    "USD",
  );

  assert.equal(product.merchant, "Wellbots", "expected URL domain to override platform source");
});

test("BUY-72907: falls back to merchant_name when URL unavailable", () => {
  const product = normalizeProduct(
    {
      id: "456",
      title: "Apple AirPods Pro",
      price: { amount: 249.99, currency: "USD" },
      merchant: "shopify_wellbots_com",
      merchant_name: "Wellbots", // Clean merchant_name available
      source: "shopify",
      // No URL fields
    },
    "USD",
  );

  assert.equal(product.merchant, "Wellbots", "expected merchant_name fallback");
});

test("BUY-72907: URL domain extracted and title-cased from click_url", () => {
  // When click_url is present, URL domain should be used as merchant.
  // Note: best_buy_us → "Bestbuy" is a pre-existing alias gap in
  // stripMerchantTenantSuffix; the URL path extracts the right domain.
  const product = normalizeProduct(
    {
      id: "789",
      title: "Bose QuietComfort",
      price: { amount: 329.99, currency: "USD" },
      merchant: "best_buy_us",
      click_url: "https://www.bestbuy.com/product/123",
    },
    "USD",
  );

  assert.equal(product.merchant, "Best Buy", "expected URL-derived domain with alias mapping");
});

test("BUY-72907: Google Shopping products show actual retailer from URL", () => {
  // Google Shopping feed products should show the actual store, not "Google Shopping"
  const product = normalizeProduct(
    {
      id: "999",
      title: "Samsung Galaxy Buds3",
      price: { amount: 149.99, currency: "USD" },
      merchant: "google_shopping",
      merchant_name: "google_shopping",
      source: "google_shopping",
      click_url: "https://www.walmart.com/ip/samsung-galaxy-buds3/123",
    },
    "USD",
  );

  assert.equal(product.merchant, "Walmart", "expected retailer from Google Shopping URL");
});

test("BUY-72907: skips non-retailer domains (google, facebook, etc.)", () => {
  const product = normalizeProduct(
    {
      id: "888",
      title: "Generic Product",
      price: { amount: 99.99, currency: "USD" },
      merchant: "google_shopping",
      click_url: "https://www.google.com/url?url=https://example.com", // Tracking redirect
    },
    "USD",
  );

  // Falls back to merchant_name/merchant/source since google is filtered
  assert.equal(product.merchant, "Google Shopping", "expected platform fallback for non-retailer domains");
});

test("BUY-72907: skips our own redirect domains (buywhere)", () => {
  // Products with buywhere.ai redirect/affiliate URLs should fall through
  // to merchant_name/merchant/source, not show "Buywhere" as the merchant.
  const product = normalizeProduct(
    {
      id: "777",
      title: "Sony WH-1000XM5",
      price: { amount: 329.99, currency: "USD" },
      merchant: "wellbots_com",
      merchant_name: "Wellbots",
      source: "shopify",
      click_url: "https://buywhere.ai/redirect/abc123",
    },
    "USD",
  );

  // Should fall through to merchant_name since buywhere is denylisted
  assert.equal(product.merchant, "Wellbots", "expected buywhere redirect to fall through to merchant_name");
});

test("BUY-72907: handles URL parsing edge cases", () => {
  // Subdomains should be stripped
  assert.equal(
    normalizeProduct(
      { id: "1", title: "Test", price: { amount: 10, currency: "USD" }, click_url: "https://store.wellbots.com/product" },
      "USD",
    ).merchant,
    "Wellbots",
  );

  // www should be stripped
  assert.equal(
    normalizeProduct(
      { id: "2", title: "Test", price: { amount: 10, currency: "USD" }, click_url: "https://www.bestbuy.com/product" },
      "USD",
    ).merchant,
    "Best Buy",
  );

  // m. subdomain should be stripped
  assert.equal(
    normalizeProduct(
      { id: "3", title: "Test", price: { amount: 10, currency: "USD" }, click_url: "https://m.newegg.com/product" },
      "USD",
    ).merchant,
    "Newegg",
  );
});
