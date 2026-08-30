import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSGLegacyProductRedirect,
  buildUSLegacyProductRedirect,
  extractLegacyProductQuery,
} from "@/lib/legacy-product-redirect";

test("extractLegacyProductQuery strips numeric identifiers", () => {
  assert.equal(
    extractLegacyProductQuery("sony-wh-1000xm5-wireless-noise-canceling-headphones-12345"),
    "sony wh 1000xm5 wireless noise canceling headphones",
  );
});

test("extractLegacyProductQuery strips mixed alphanumeric identifiers", () => {
  assert.equal(
    extractLegacyProductQuery("apple-iphone-16-pro-max-sku12345"),
    "apple iphone 16 pro max",
  );
});

test("extractLegacyProductQuery preserves plain text slugs", () => {
  assert.equal(
    extractLegacyProductQuery("dyson-v15-detect-cordless-vacuum"),
    "dyson v15 detect cordless vacuum",
  );
});

test("buildUSLegacyProductRedirect falls back to compare index", () => {
  assert.equal(buildUSLegacyProductRedirect(""), "/compare/us/");
});

test("buildSGLegacyProductRedirect uses SG search with the derived query", () => {
  assert.equal(
    buildSGLegacyProductRedirect("apple-airpods-pro-2nd-generation-sg-product-1"),
    "/search?q=apple%20airpods%20pro%202nd%20generation&country=SG",
  );
});
