import assert from "node:assert/strict";
import test from "node:test";
import { stripMerchantTenantSuffix } from "@/lib/merchant-name";

// BUY-66324 — every merchant string that flows into SEO landing-page product
// cards, comparison tables, or JSON-LD seller blocks must be cleaned through
// stripMerchantTenantSuffix before reaching the public render. These cases
// cover each pattern QA reported plus regressions for the BUY-65558 fix that
// the function originally shipped to handle.

test("plain platform names pass through with title-case", () => {
  assert.equal(stripMerchantTenantSuffix("shopify"), "Shopify");
  assert.equal(stripMerchantTenantSuffix("Walmart"), "Walmart");
  assert.equal(stripMerchantTenantSuffix("best buy"), "Best Buy");
});

test("leading underscore tenant suffix is stripped", () => {
  assert.equal(stripMerchantTenantSuffix("shopify_buy30620_crate"), "Shopify");
  assert.equal(stripMerchantTenantSuffix("shopify_buy30620_hunt2"), "Shopify");
  assert.equal(stripMerchantTenantSuffix("walmart_us"), "Walmart");
  assert.equal(stripMerchantTenantSuffix("google_shopping"), "Google Shopping");
});

test("already-de-underscored input with trailing tenant tokens is stripped (BUY-65558 regression)", () => {
  assert.equal(stripMerchantTenantSuffix("Shopify Buy30620 Crate"), "Shopify");
  assert.equal(stripMerchantTenantSuffix("Shopify Scrape"), "Shopify");
  assert.equal(stripMerchantTenantSuffix("Shopify Wellbots Com"), "Shopify");
});

test("uppercase upstream input is title-cased on output (BUY-66324)", () => {
  assert.equal(stripMerchantTenantSuffix("SHOPIFY BUY30620 STOCK"), "Shopify");
  assert.equal(stripMerchantTenantSuffix("SHOPIFY SCRAPE"), "Shopify");
  assert.equal(stripMerchantTenantSuffix("WALMART_US"), "Walmart");
});

test("leading ingest ID followed by filler word followed by retailer is mapped to clean name", () => {
  assert.equal(stripMerchantTenantSuffix("BUY30590 RETAILER BESTBUY"), "Best Buy");
  assert.equal(stripMerchantTenantSuffix("BUY12345 Retailer Bestbuy"), "Best Buy");
  assert.equal(stripMerchantTenantSuffix("buy12345 retailer bestbuy"), "Best Buy");
});

test("unknown platforms fall through as-is (single-token lookup miss)", () => {
  // No leading ID, no platform match, no alias — tokens are joined with the
  // default title-case so the badge at least renders something readable
  // instead of raw underscores or all-caps.
  assert.equal(stripMerchantTenantSuffix("lordandtaylorcom"), "Lord and Taylor");
});

test("empty / null / undefined inputs return empty string", () => {
  assert.equal(stripMerchantTenantSuffix(""), "");
  assert.equal(stripMerchantTenantSuffix(null), "");
  assert.equal(stripMerchantTenantSuffix(undefined), "");
});

test("single-token platform stays a single token", () => {
  assert.equal(stripMerchantTenantSuffix("amazon"), "Amazon");
  assert.equal(stripMerchantTenantSuffix("AMAZON"), "Amazon");
});

test("trailing filler words are dropped when a real platform matches first", () => {
  // "Shopify Wellbots Com" -> "Shopify" because "shopify" is the platform
  // root; trailing "Com" never reaches the alias check.
  assert.equal(stripMerchantTenantSuffix("Shopify Wellbots Com"), "Shopify");
  assert.equal(stripMerchantTenantSuffix("shopify_wellbots_com"), "Shopify");
});

// BUY-72907 — QA re-verification FAILED 2026-08-22: cards still showed
// platform names like "Shopify" / "Google Shopping" instead of the actual
// store, and region-tagged values like "Decathlon Sg" instead of "Decathlon".
// "merchant_direct" also leaked as the raw channel label. Cover each path
// that maps a noisy ingest lane string to the public-facing retailer name.
test("BUY-72907: regional suffix is stripped from retailer names", () => {
  assert.equal(stripMerchantTenantSuffix("Decathlon Sg"), "Decathlon");
  assert.equal(stripMerchantTenantSuffix("Decathlon SG"), "Decathlon");
  assert.equal(stripMerchantTenantSuffix("Shopee Sg"), "Shopee");
  assert.equal(stripMerchantTenantSuffix("Lazada My"), "Lazada");
  assert.equal(stripMerchantTenantSuffix("Shopee Sng"), "Shopee");
  assert.equal(stripMerchantTenantSuffix("Lazada Ph"), "Lazada");
  assert.equal(stripMerchantTenantSuffix("Amazon Us"), "Amazon");
  assert.equal(stripMerchantTenantSuffix("Best Buy Us"), "Best Buy");
});

test("BUY-72907: 'Merchant Direct' maps to neutral public seller label", () => {
  assert.equal(stripMerchantTenantSuffix("Merchant Direct"), "BuyWhere seller");
  assert.equal(stripMerchantTenantSuffix("merchant_direct"), "BuyWhere seller");
  assert.equal(stripMerchantTenantSuffix("MERCHANT DIRECT"), "BuyWhere seller");
});

test("BUY-72907: trailing filler + regional suffix are both stripped", () => {
  // "Decathlon Sg Com" -> "Decathlon"
  assert.equal(stripMerchantTenantSuffix("Decathlon Sg Com"), "Decathlon");
  assert.equal(stripMerchantTenantSuffix("BUY30590 RETAILER BESTBUY SG"), "Best Buy");
});