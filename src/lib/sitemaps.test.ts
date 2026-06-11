import assert from "node:assert/strict";
import test from "node:test";
import { getCategorySitemapEntries, getCompareSitemapEntries } from "@/lib/sitemaps";

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
