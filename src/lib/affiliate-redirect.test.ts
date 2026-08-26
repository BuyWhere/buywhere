import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAffiliateRedirectHref,
  buildAffiliateRedirectFromProductId,
} from "./affiliate-redirect";

test("buildAffiliateRedirectHref accepts absolute buywhere.ai /r/ URLs", () => {
  assert.equal(
    buildAffiliateRedirectHref(
      "https://buywhere.ai/r/direct/54614597?source=product_card",
    ),
    "/r/direct/54614597?source=product_card",
  );
});

test("buildAffiliateRedirectHref accepts www.buywhere.ai and api.buywhere.ai hosts", () => {
  assert.equal(
    buildAffiliateRedirectHref(
      "https://www.buywhere.ai/r/buywhere/12345?source=ssr_prices",
    ),
    "/r/buywhere/12345?source=ssr_prices",
  );
  assert.equal(
    buildAffiliateRedirectHref(
      "https://api.buywhere.ai/r/direct/prod_123?source=product_card",
    ),
    "/r/direct/prod_123?source=product_card",
  );
});

test("buildAffiliateRedirectHref passes through relative /r/ URLs unchanged", () => {
  assert.equal(
    buildAffiliateRedirectHref("/r/direct/54614597?source=product_card"),
    "/r/direct/54614597?source=product_card",
  );
});

test("buildAffiliateRedirectHref rejects raw merchant URLs", () => {
  assert.equal(
    buildAffiliateRedirectHref("https://shopee.sg/some-product"),
    null,
  );
  assert.equal(
    buildAffiliateRedirectHref("https://www.newegg.com/laptop"),
    null,
  );
});

test("buildAffiliateRedirectHref rejects empty / hash / non-string inputs", () => {
  assert.equal(buildAffiliateRedirectHref(""), null);
  assert.equal(buildAffiliateRedirectHref("#"), null);
  assert.equal(buildAffiliateRedirectHref("   "), null);
  assert.equal(buildAffiliateRedirectHref(null), null);
  assert.equal(buildAffiliateRedirectHref(undefined), null);
});

test("buildAffiliateRedirectFromProductId encodes and appends source", () => {
  assert.equal(
    buildAffiliateRedirectFromProductId("54614597", "product_card"),
    "/r/direct/54614597?source=product_card",
  );
  assert.equal(
    buildAffiliateRedirectFromProductId(12345, "ssr_prices"),
    "/r/direct/12345?source=ssr_prices",
  );
});
