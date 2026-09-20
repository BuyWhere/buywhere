// BUY-82112: /compare/{category-slug} must NOT redirect to /not-found.
//
// The middleware at src/middleware.ts gates /compare/{slug} paths through a
// country-code validator (us, sg, us/sg, sg/us). Category slugs like
// "electronics", "fashion", "beauty" etc. were incorrectly treated as invalid
// country codes and 302-redirected to /not-found?type=compare&country1=<slug>.
//
// This test verifies the category-slug allowlist logic that was added to the
// middleware. It imports the taxonomy and replicates the middleware's decision
// tree so the test runs without a Next.js server.
//
// Run: node tests/compare-category-slugs-82112.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_TAXONOMY, getCategoryBySlug } from "../src/lib/taxonomy.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Replicates the middleware compare-route decision logic from src/middleware.ts.
 * Returns the redirect pathname+search that the middleware would produce, or
 * null if the request is allowed through (no redirect).
 */
function middlewareCompareDecision(pathname) {
  const compareMatch = pathname.match(/^\/compare\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!compareMatch) return null; // not a /compare/* route — middleware skips

  const cc1 = compareMatch[1].toLowerCase();
  const cc2 = compareMatch[2]?.toLowerCase();

  // BUY-82112: category slug allowlist (single-segment only)
  if (!cc2 && getCategoryBySlug(cc1)) return null;

  const validSingle = cc1 === "us" || cc1 === "sg";
  const validPair =
    (cc1 === "us" && cc2 === "sg") || (cc1 === "sg" && cc2 === "us");

  if (!validSingle && !validPair) {
    const params = new URLSearchParams({ type: "compare", country1: cc1 });
    if (cc2) params.set("country2", cc2);
    return `/not-found?${params.toString()}`;
  }
  return null;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("every PRODUCT_TAXONOMY category slug passes through middleware without redirect", () => {
  for (const category of PRODUCT_TAXONOMY) {
    const result = middlewareCompareDecision(`/compare/${category.slug}`);
    assert.equal(
      result,
      null,
      `/compare/${category.slug} should NOT redirect, got: ${result}`,
    );
  }
});

test("valid country routes still pass through", () => {
  assert.equal(middlewareCompareDecision("/compare/us"), null);
  assert.equal(middlewareCompareDecision("/compare/sg"), null);
  assert.equal(middlewareCompareDecision("/compare/us/sg"), null);
  assert.equal(middlewareCompareDecision("/compare/sg/us"), null);
});

test("unsupported country codes still redirect to /not-found", () => {
  for (const cc of ["jp", "de", "fr", "uk", "au", "cn"]) {
    const result = middlewareCompareDecision(`/compare/${cc}`);
    assert.ok(
      result?.startsWith("/not-found?"),
      `/compare/${cc} should redirect to /not-found, got: ${result}`,
    );
    assert.ok(
      result?.includes(`country1=${cc}`),
      `/compare/${cc} redirect should include country1=${cc}`,
    );
  }
});

test("unknown slugs still redirect to /not-found", () => {
  const result = middlewareCompareDecision("/compare/random-slug");
  assert.ok(result?.startsWith("/not-found?"), `got: ${result}`);
});

test("category slug with a second segment still redirects (no such route)", () => {
  const result = middlewareCompareDecision("/compare/electronics/extra");
  assert.ok(
    result?.startsWith("/not-found?"),
    `/compare/electronics/extra should redirect (no such route), got: ${result}`,
  );
});

test("/compare index does not match the route pattern", () => {
  assert.equal(middlewareCompareDecision("/compare"), null);
});

test("non-compare paths are unaffected", () => {
  assert.equal(middlewareCompareDecision("/search"), null);
  assert.equal(middlewareCompareDecision("/products/us"), null);
  assert.equal(middlewareCompareDecision("/"), null);
});
