import assert from "node:assert/strict";
import test from "node:test";
import { buildAffiliateRedirectUrl, buildAffiliateRedirectFromMerchantUrl } from "@/lib/click-attribution";

test("buildAffiliateRedirectUrl appends encoded pathname for SSR source_page", () => {
  assert.equal(
    buildAffiliateRedirectUrl("12345", "/search"),
    "/r/direct/12345?pathname=%2Fsearch",
  );
  assert.equal(
    buildAffiliateRedirectUrl(987, "/products/us/sony-wh-1000xm5"),
    "/r/direct/987?pathname=%2Fproducts%2Fus%2Fsony-wh-1000xm5",
  );
});

test("buildAffiliateRedirectUrl omits query when pathname is missing", () => {
  assert.equal(buildAffiliateRedirectUrl("12345"), "/r/direct/12345");
});

test("buildAffiliateRedirectUrl returns null for curated slot ids", () => {
  assert.equal(buildAffiliateRedirectUrl("lp1", "/best-macbooks-us"), null);
});

test("buildAffiliateRedirectFromMerchantUrl wraps http(s) destinations in /r?u=", () => {
  assert.equal(
    buildAffiliateRedirectFromMerchantUrl("https://www.amazon.sg/dp/B0FQFBXLLZ"),
    "/r?u=" + encodeURIComponent("https://www.amazon.sg/dp/B0FQFBXLLZ"),
  );
  assert.equal(
    buildAffiliateRedirectFromMerchantUrl("/r/direct/123"),
    "/r/direct/123",
  );
  assert.equal(buildAffiliateRedirectFromMerchantUrl("#"), null);
  assert.equal(buildAffiliateRedirectFromMerchantUrl("/search?q=airpods"), null);
});
