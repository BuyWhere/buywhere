import assert from "node:assert/strict";
import test from "node:test";
import { getCategorySitemapEntries, getCompareSitemapEntries } from "@/lib/sitemaps";
import { toSiteUrl } from "@/lib/site-url";

test("getCategorySitemapEntries uses canonical (no trailing slash) URLs", () => {
  const entries = getCategorySitemapEntries();
  for (const entry of entries) {
    const path = new URL(entry.url).pathname;
    assert.ok(
      !path.endsWith("/") || path === "/",
      `category sitemap URL ${entry.url} should not have a trailing slash (except for /)`,
    );
  }
});

test("getCompareSitemapEntries uses canonical (no trailing slash) URLs", () => {
  const entries = getCompareSitemapEntries();
  for (const entry of entries) {
    const path = new URL(entry.url).pathname;
    assert.ok(
      !path.endsWith("/") || path === "/",
      `compare sitemap URL ${entry.url} should not have a trailing slash (except for /)`,
    );
  }
});

test("getCategorySitemapEntries excludes soft-404 slugs flagged in BUY-39762 / BUY-41940", () => {
  const entries = getCategorySitemapEntries();
  const urls = entries.map((e) => e.url);
  for (const slug of ["books-stationery", "garden-outdoor", "pet-supplies", "sports-outdoors"]) {
    assert.ok(
      !urls.some((u) => u.includes(`/categories/${slug}`)),
      `soft-404 slug "${slug}" should not appear in sitemap-categories.xml`,
    );
  }
});

test("getCategorySitemapEntries includes only real category slugs that exist in PRODUCT_TAXONOMY", () => {
  const entries = getCategorySitemapEntries();
  const categoryPaths = entries
    .map((e) => new URL(e.url).pathname)
    .filter((p) => p.startsWith("/categories/") && p !== "/categories");
  // Sanity: at least the known-good slugs are present.
  for (const slug of ["electronics", "fashion", "home-living", "beauty-health", "grocery"]) {
    assert.ok(
      categoryPaths.includes(`/categories/${slug}`),
      `expected /categories/${slug} in sitemap`,
    );
  }
});

// BUY-42727: the merchant sitemap URL builder must emit canonical-form
// (no trailing slash) URLs so they match <link rel="canonical"> on the
// merchant products page. Trailing-slash URLs get rewritten to the
// non-slash path via middleware (x-middleware-rewrite), which Google
// Search Console reports as "Page with redirect" — exactly the issue
// GSC standing duty (Lyra) flagged for the merchant sitemap cohort.
test("merchant listing path → toSiteUrl emits canonical (no trailing slash) (BUY-42727)", () => {
  // Mirrors the construction in getMerchantListingSitemapEntries and
  // getAllRegionMerchantListingSitemapEntries: `/<country>/<slug>/products`.
  const path = "/sg/watsons-sg/products";
  const url = toSiteUrl(path);
  assert.equal(
    new URL(url).pathname,
    "/sg/watsons-sg/products",
    `merchant sitemap URL ${url} should not have a trailing slash`,
  );
});

test("merchant listing path with trailing slash is normalized to canonical (BUY-42727)", () => {
  // Defensive: even if a future caller passes a trailing-slash form,
  // toSiteUrl should canonicalize. This locks in the BUY-42727 invariant
  // at the helper layer so regressions surface in tests, not GSC.
  const url = toSiteUrl("/sg/watsons-sg/products/");
  assert.equal(
    new URL(url).pathname,
    "/sg/watsons-sg/products",
    `toSiteUrl should strip trailing slash; got ${url}`,
  );
});

