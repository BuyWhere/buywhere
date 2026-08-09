// Regression test for BUY-67241.
//
// QA inspected the wireless-headphones search results at
// https://buywhere.ai/search?q=wireless+headphones&country=us and found
// 20 product cards whose <img> URLs were split 11x cdn.shopify.com +
// 9x contents.mediadecathlon.com, with the browser firing
// "Failed to load resource: 410" console errors per card.
//
// contents.mediadecathlon.com is a hard-410 host (cache-control:
// max-age=2592000 = 30-day dead cache). cdn.shopify.com is mixed (some
// 200, some 404/410) but the broken ratio is high enough that we filter
// the whole host and render the BrandedPlaceholder instead.
//
// hasUsableProductImage must:
//   - reject the always-410 mediadecathlon host BEFORE the <img> renders
//     (so no broken request is issued and no console error fires)
//   - reject cdn.shopify.com + *.shopify.com + *.shopifycdn.com for the
//     same reason (QA 2026-08-09T02:13Z; supersedes PR #392 which only
//     filtered mediadecathlon)
//   - keep rejecting the existing unsplash / placeholder / no-image
//     hosts (so we don't regress BUY-63954, BUY-63507, BUY-64057)
//   - still return true for ordinary product CDN URLs (e.g. amazon,
//     newegg, asus, sony) so legitimate product cards keep their images
//
// The companion BrandedPlaceholder (imageError state) handles the
// remaining unknown-host 410 case at render time.

import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./SearchResultsClient";

const { hasUsableProductImage } = __test__;

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
  // returned 11 cdn.shopify.com URLs of which several return 404/410.
  assert.equal(
    hasUsableProductImage(
      "https://cdn.shopify.com/s/files/1/0065/3095/7363/products/jbl_everest_310_brown_.jpg"
    ),
    false
  );
  assert.equal(
    hasUsableProductImage(
      "https://cdn.shopify.com/s/files/1/0672/2106/1933/files/Beats-by-Dr-Dre-Solo3-Wireless.jpg"
    ),
    false
  );
  // Apex and www variants must also be rejected.
  assert.equal(hasUsableProductImage("https://shopify.com/path/img.png"), false);
  assert.equal(hasUsableProductImage("https://www.shopify.com/path/img.png"), false);
  // Burst CDN is shopifycdn.com — must be rejected too.
  assert.equal(hasUsableProductImage("https://burst.shopifycdn.com/path/img.png"), false);
});

test("BUY-67241: still rejects the pre-existing unsplash / placeholder hosts", () => {
  assert.equal(hasUsableProductImage("https://source.unsplash.com/featured/300"), false);
  assert.equal(hasUsableProductImage("https://images.unsplash.com/photo-x.jpg"), false);
  assert.equal(hasUsableProductImage("https://example.com/placeholder.png"), false);
  assert.equal(hasUsableProductImage("https://example.com/no-image.jpg"), false);
  assert.equal(hasUsableProductImage("https://example.com/no_image.jpg"), false);
  assert.equal(hasUsableProductImage("https://example.com/missing-image.jpg"), false);
  assert.equal(hasUsableProductImage("https://example.com/generic.png"), false);
});

test("BUY-67241: still accepts ordinary product CDN URLs", () => {
  // Amazon product images (the most common live source for laptop
  // search; 13/13 returned 200 on the laptop probe).
  assert.equal(
    hasUsableProductImage("https://m.media-amazon.com/images/I/71abc.jpg"),
    true
  );
  // Newegg CDN (7/7 returned 200 on the laptop probe).
  assert.equal(
    hasUsableProductImage("https://c1.neweggimages.com/productimage/abc.jpg"),
    true
  );
  // Brand.com direct CDN.
  assert.equal(
    hasUsableProductImage("https://www.sony.com/image/headphones.png"),
    true
  );
  // Edifier direct CDN.
  assert.equal(
    hasUsableProductImage("https://www.edifier.com/cdn/products/w820nb.png"),
    true
  );
});

test("BUY-67241: rejects empty / null / unparseable URLs", () => {
  assert.equal(hasUsableProductImage(undefined), false);
  assert.equal(hasUsableProductImage(null), false);
  assert.equal(hasUsableProductImage(""), false);
  assert.equal(hasUsableProductImage("not-a-url"), false);
});
