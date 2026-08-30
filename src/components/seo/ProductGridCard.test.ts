// Regression test for BUY-78023.
//
// Before the fix, fallback products (curated slot IDs like f1, lp1) pointed
// every card anchor — image, merchant tag, title, and the would-be "Buy at"
// CTA — at /search?q=…&country=sg, which leaks the internal search route
// into SSR HTML and confuses AI crawlers.
//
// The fix lives in ProductGridCard.tsx: when affiliateUrl is absent
// (fallback product), prefer product.productUrl (the canonical
// /products/{region}/{slug}/{id} PDP route) over product.href (a
// /search?q=… loopback). The same anchor target flows through every card
// anchor AND the "View details" Next.js Link, so SSR HTML never contains
// /search?q= for fallback products.
//
// Run: npx tsx --test src/components/seo/ProductGridCard.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourcePath = fileURLToPath(new URL("./ProductGridCard.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

test("BUY-78023: fallback path uses product.productUrl over product.href", () => {
  // The fix MUST be present: the affiliateHref ternary's fallback branch
  // references `product.productUrl` before `product.href`.
  assert.match(
    source,
    /product\.productUrl\s*\|\|\s*product\.href/,
    "fallback affiliateHref must prefer product.productUrl over product.href",
  );
});

test("BUY-78023: live path still uses buildAffiliateRedirectUrl for /r/direct/{id}", () => {
  // The fix MUST preserve the existing live-product behavior: real DB IDs
  // still resolve through /r/direct/{id}.
  assert.match(
    source,
    /buildAffiliateRedirectUrl\(product\.id\)/,
    "live affiliateHref must still call buildAffiliateRedirectUrl(product.id)",
  );
});

test("BUY-78023: isMerchantOffer gate stays anchored to /r/ and http(s) prefixes (not /search?q=)", () => {
  // The isMerchantOffer guard must continue to recognize only /r/ and
  // http(s) prefixes as merchant offers — adding /products/ to the prefix
  // set would re-introduce the fake "Buy at {merchant}" button on fallback
  // cards.
  const idx = source.indexOf("isMerchantOffer");
  assert.ok(idx > 0, "isMerchantOffer definition must exist");
  const block = source.slice(idx, idx + 500);
  assert.match(block, /\/r\//, "isMerchantOffer must check /r/ prefix");
  assert.match(block, /http/, "isMerchantOffer must check http(s) prefix");
  assert.doesNotMatch(
    block,
    /startsWith\("\/products\/"\)/,
    "isMerchantOffer must NOT include /products/ prefix (would re-introduce fake merchant button)",
  );
});