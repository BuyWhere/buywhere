import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./SearchResultsClient";

const { hasUsableProductImage } = __test__;

// Regression test for BUY-67241.
//
// Live probe of https://buywhere.ai/search?q=wireless+headphones&country=us
// via /api/v1/products/search returned 20 cards split 11x cdn.shopify.com +
// 9x contents.mediadecathlon.com. Both hosts return 410 (or 404/410 mix) for
// the rows we ingest, so the browser fires "Failed to load resource: 410"
// console errors for every card before the onError fallback can hide the
// broken image.
//
// hasUsableProductImage must:
//   - reject contents.mediadecathlon.com and www.mediadecathlon.com (hard
//     410, cache-control: max-age=2592000 = 30-day dead cache)
//   - reject any subdomain of mediadecathlon (e.g. cdn.mediadecathlon.com)
//   - reject cdn.shopify.com, shopify.com, www.shopify.com (mixed 200/404/410
//     in the wireless-headphones catalog; QA 2026-08-09T02:13Z observed
//     broken ratio too high to keep the host)
//   - reject any subdomain of shopify.com and shopifycdn.com (covers
//     burst.shopifycdn.com)
//   - keep working ordinary product CDN URLs (Amazon, Newegg, ASUS, Sony, …)
//   - still reject the existing unsplash / placeholder / example hosts
//     (regression guard for BUY-63954, BUY-63507, BUY-64057, BUY-69615,
//     BUY-68364)
//
// The companion BrandedPlaceholder (imageError state) handles any residual
// unknown-host 410 at render time.

test("BUY-67241: rejects contents.mediadecathlon.com URLs (verified hard-410 host)", () => {
  // Direct repro from QA's wireless-headphones search.
  assert.equal(
    hasUsableProductImage(
      "https://contents.mediadecathlon.com/picture-product-3/sony-wireless-headphones-1234.jpg"
    ),
    false
  );
  // Apex and www variants must also be rejected.
  assert.equal(hasUsableProductImage("https://www.mediadecathlon.com/path/img.png"), false);
  // Any subdomain of mediadecathlon (contents, www, cdn, …) is suspect.
  assert.equal(hasUsableProductImage("https://cdn.mediadecathlon.com/path/img.png"), false);
  assert.equal(hasUsableProductImage("https://static.mediadecathlon.com/path/img.png"), false);
});

test("BUY-67241: rejects cdn.shopify.com URLs (QA 2026-08-09 — mixed 200/404/410, broken ratio too high)", () => {
  // Direct repro from QA's reopen: live API at
  // https://buywhere.ai/api/v1/products/search?q=wireless+headphones&country=us
  // returned 11/20 rows with cdn.shopify.com URLs, several returning 410.
  assert.equal(
    hasUsableProductImage(
      "https://cdn.shopify.com/s/files/1/0240/9337/files/1_JBudsOpen_Cloud.jpg?v=1773247734"
    ),
    false
  );
  // Apex and www variants must also be rejected.
  assert.equal(hasUsableProductImage("https://shopify.com/path/img.png"), false);
  assert.equal(hasUsableProductImage("https://www.shopify.com/path/img.png"), false);
  // Any subdomain of shopify is suspect.
  assert.equal(hasUsableProductImage("https://burst.shopifycdn.com/path/img.png"), false);
  assert.equal(hasUsableProductImage("https://cdn.shopify.com/s/files/1/abc/def.jpg"), false);
});

test("BUY-67241: keeps accepting ordinary merchant product CDN URLs", () => {
  // Sanity — the filter must not regress legitimate hosts.
  assert.equal(
    hasUsableProductImage("https://m.media-amazon.com/images/I/71abc.jpg"),
    true
  );
  assert.equal(
    hasUsableProductImage("https://c1.neweggimages.com/neweggimg/2018/abc.jpg"),
    true
  );
  assert.equal(
    hasUsableProductImage("https://dlcdnwebimgs.asus.com/gain/abc.jpg"),
    true
  );
});

test("BUY-67241: still rejects the existing unsplash / placeholder / example hosts", () => {
  // Regression guard for the prior hotlink / synthetic-host blocks.
  assert.equal(
    hasUsableProductImage("https://source.unsplash.com/abc/200x200"),
    false
  );
  assert.equal(
    hasUsableProductImage("https://images.unsplash.com/abc.jpg"),
    false
  );
  assert.equal(
    hasUsableProductImage("https://example.sg/products/abc.jpg"),
    false
  );
  assert.equal(
    hasUsableProductImage("https://cdn.example.com/img.jpg"),
    false
  );
  assert.equal(
    hasUsableProductImage("https://buywhere.ai/og-image.png"),
    false
  );
});
