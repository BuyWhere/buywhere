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