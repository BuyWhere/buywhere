import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./SearchResultsClient";

const { hasUsableProductImage } = __test__;

// ---------------------------------------------------------------------------
// BUY-71639: [QA] Product card images use placeholder graphics instead of real
// product photos on search results.
//
// Root cause: `hasUsableProductImage()` used `fullUrl.includes(...)` on
// substrings, which filtered out legitimate merchant CDN images whose slugs
// merely CONTAINED a sentinel word as descriptive text (e.g.
// `/generic-hero.png`, `/no-image-classifier/SKU.jpg`,
// `/laptop-no-image-filter/...`). This made /search show the branded SVG
// placeholder for products whose SEO pages (/laptop-singapore) rendered real
// images. The filter now only blocks URLs whose FINAL path segment is a
// sentinel filename; genuinely broken URLs are caught by ProductGridImage's
// own `<img onError>` fallback.
// ---------------------------------------------------------------------------

// --- Real product images: must be accepted ---
test("BUY-71639: passes Amazon CDN images", () => {
  assert.equal(hasUsableProductImage("https://m.media-amazon.com/images/I/71xyz.jpg"), true);
});

test("BUY-71639: passes URLs with sentinel word inside a descriptive slug", () => {
  // "no-image-classifier" is a Shopify folder; SKU.jpg is the real product image.
  assert.equal(hasUsableProductImage("https://cdn.shopify.com/s/files/no-image-classifier/12345.jpg"), true);
  // "laptop-no-image-filter" is a descriptive folder name.
  assert.equal(hasUsableProductImage("https://cdn.walmart.com/products/laptop-no-image-filter/abc.jpg"), true);
});

test("BUY-71639: passes URLs with generic in a descriptive slug segment", () => {
  assert.equal(hasUsableProductImage("https://target.scene7.com/is/image/Target/12345_generic_123"), true);
  assert.equal(hasUsableProductImage("https://images.bestbuy.com/is/image/BobVila/something-generic-product.jpg"), true);
  assert.equal(hasUsableProductImage("https://cdn.example.com/images/generic-hero.png"), true);
});

test("BUY-71639: passes URLs with no-image as a long real filename", () => {
  // "no-image-product.jpg" is a real product whose SKU happens to read "no-image-product".
  assert.equal(hasUsableProductImage("https://cdn.example.com/no-image-product.jpg"), true);
});

test("BUY-71639: passes classic retailer CDN shapes", () => {
  assert.equal(hasUsableProductImage("https://i.ebayimg.com/images/g/ABC123/s-l1600.jpg"), true);
  assert.equal(hasUsableProductImage("https://example.com/product-image.png"), true);
});

// --- Sentinel / placeholder images: must be rejected ---
test("BUY-71639: blocks sentinel hosts (unsplash)", () => {
  assert.equal(hasUsableProductImage("https://images.unsplash.com/photo-123"), false);
  assert.equal(hasUsableProductImage("https://source.unsplash.com/random"), false);
});

// BUY-72904: Decathlon Wedia CDN serves HTTP 410 + 259-byte PNG placeholder for
// deleted/unavailable assets (contents.mediadecathlon.com/m26294962 etc.).
// Blocking the host means imageUrl becomes null → ProductGridImage renders
// BrandedPlaceholder without ever emitting the doomed <img> request.
test("BUY-72904: blocks Decathlon Wedia CDN (HTTP 410 placeholder host)", () => {
  assert.equal(hasUsableProductImage("https://contents.mediadecathlon.com/m26294962"), false);
  assert.equal(hasUsableProductImage("https://contents.mediadecathlon.com/m26294991/1k.jpg"), false);
  assert.equal(hasUsableProductImage("https://www.contents.mediadecathlon.com/m26294962.jpg"), false);
  // A neighboring Decathlon media host must still pass if it ever appears.
  assert.equal(hasUsableProductImage("https://media.decathlon.com/img/m26294962.jpg"), true);
});

test("BUY-71639: blocks sentinel filenames as the final path segment", () => {
  assert.equal(hasUsableProductImage("https://cdn.example.com/placeholder.png"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/generic.jpg"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/no-image.jpg"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/image-unavailable.png"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/missing-image.jpg"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/spacer.png"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/blank.gif"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/fallback.jpg"), false);
});

test("BUY-71639: blocks sentinel + digit variant (CDN cache-busting)", () => {
  assert.equal(hasUsableProductImage("https://cdn.example.com/placeholder-1.png"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/generic-42.jpg"), false);
});

test("BUY-71639: blocks bare .svg/.gif files (loading spinners / error icons)", () => {
  assert.equal(hasUsableProductImage("https://cdn.example.com/assets/product.svg"), false);
});

test("BUY-71639: blocks query-string sentinel params", () => {
  assert.equal(hasUsableProductImage("https://cdn.example.com/assets/product.jpg?placeholder=1"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/assets/product.jpg?no_image=1"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/assets/product.jpg?missing-image=1"), false);
  assert.equal(hasUsableProductImage("https://cdn.example.com/assets/product.jpg?generic=1"), false);
});
