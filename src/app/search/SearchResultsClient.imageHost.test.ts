// Regression test for BUY-67241.
//
// QA inspected the wireless-headphones search results at
// https://buywhere.ai/search?q=wireless+headphones&country=us and found
// 4 product cards whose <img> URLs returned HTTP 410 (Sony wireless
// headphone images hosted under contents.mediadecathlon.com). The
// browser fired the broken request and a "Failed to load resource: 410"
// console error per card.
//
// hasUsableProductImage must:
//   - reject the always-410 mediadecathlon host BEFORE the <img> renders
//     (so no broken request is issued and no console error fires)
//   - keep rejecting the existing unsplash / placeholder / no-image
//     hosts (so we don't regress BUY-63954, BUY-63507, BUY-64057)
//   - still return true for ordinary product CDN URLs (e.g. amazon,
//     shopify, asus) so legitimate product cards keep their images
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
  // Amazon product images (the most common live source).
  assert.equal(
    hasUsableProductImage("https://m.media-amazon.com/images/I/71abc.jpg"),
    true
  );
  // Shopify CDN.
  assert.equal(
    hasUsableProductImage("https://cdn.shopify.com/s/files/product.png"),
    true
  );
  // Brand.com CDN.
  assert.equal(
    hasUsableProductImage("https://www.sony.com/image/headphones.png"),
    true
  );
});

test("BUY-67241: rejects empty / null / unparseable URLs", () => {
  assert.equal(hasUsableProductImage(undefined), false);
  assert.equal(hasUsableProductImage(null), false);
  assert.equal(hasUsableProductImage(""), false);
  assert.equal(hasUsableProductImage("not-a-url"), false);
});
