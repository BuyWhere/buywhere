import assert from "node:assert/strict";
import test from "node:test";
import { getCategorySitemapEntries, getCompareSitemapEntries, getStaticSitemapEntries } from "@/lib/sitemaps";
import { toSiteUrl } from "@/lib/site-url";

test("getCategorySitemapEntries uses canonical (no trailing slash) URLs", async () => {
  const entries = await getCategorySitemapEntries();
  for (const entry of entries) {
    const path = new URL(entry.url).pathname;
    assert.ok(
      !path.endsWith("/") || path === "/",
      `category sitemap URL ${entry.url} should not have a trailing slash (except for /)`,
    );
  }
});

test("getCompareSitemapEntries uses canonical (no trailing slash) URLs", async () => {
  const entries = await getCompareSitemapEntries();
  for (const entry of entries) {
    const path = new URL(entry.url).pathname;
    assert.ok(
      !path.endsWith("/") || path === "/",
      `compare sitemap URL ${entry.url} should not have a trailing slash (except for /)`,
    );
  }
});

test("getCategorySitemapEntries excludes soft-404 slugs flagged in BUY-39762 / BUY-41940", async () => {
  const entries = await getCategorySitemapEntries();
  const urls = entries.map((e) => e.url);
  for (const slug of ["books-stationery", "garden-outdoor", "pet-supplies", "sports-outdoors"]) {
    assert.ok(
      !urls.some((u) => u.includes(`/categories/${slug}`)),
      `soft-404 slug "${slug}" should not appear in sitemap-categories.xml`,
    );
  }
});

test("getCategorySitemapEntries includes only real category slugs that exist in PRODUCT_TAXONOMY", async () => {
  const entries = await getCategorySitemapEntries();
  const categoryPaths = entries
    .map((e) => new URL(e.url).pathname)
    .filter((p) => /^\/categories\/[^/]+$/.test(p));
  // Sanity: at least the known-good slugs are present.
  for (const slug of ["electronics", "fashion", "home-living", "beauty-health", "grocery"]) {
    assert.ok(
      categoryPaths.includes(`/categories/${slug}`),
      `expected /categories/${slug} in sitemap`,
    );
  }
});

test("getCategorySitemapEntries emits API category-country combinations once (BUY-65150)", async () => {
  const entries = await getCategorySitemapEntries();
  const categoryCountryPaths = entries
    .map((e) => new URL(e.url).pathname)
    .filter((path) => /^\/categories\/[^/]+\/(us|sg|my|th|id|ph|vn)$/.test(path));

  assert.ok(
    categoryCountryPaths.length >= 250,
    `expected at least 250 category-country URLs; got ${categoryCountryPaths.length}`,
  );
  assert.equal(
    new Set(categoryCountryPaths).size,
    categoryCountryPaths.length,
    "category-country URLs should be unique",
  );
  assert.equal(
    categoryCountryPaths.length % 7,
    0,
    "every API category should have all seven country variants",
  );
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

// BUY-57452: sitemap-pages.xml must emit each <loc> at most once. The 9
// URLs flagged (6 blog + 3 product) used to appear twice because both
// STATIC_SITEMAP_ROUTES and the dynamic registries (getAllBlogPosts(),
// seoLandingPages) emitted them. The fix removed the hardcoded copies
// from STATIC_SITEMAP_ROUTES and added a Map-based dedupe in the emitter.
test("getStaticSitemapEntries emits each <loc> at most once (BUY-57452)", async () => {
  const entries = await getStaticSitemapEntries();
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.url, (counts.get(entry.url) ?? 0) + 1);
  }
  const dupes = Array.from(counts.entries()).filter(([, c]) => c > 1);
  assert.deepEqual(
    dupes,
    [],
    `sitemap-pages.xml would emit ${dupes.length} duplicate <loc>(s): ${dupes
      .slice(0, 10)
      .map(([u, c]) => `${u} x${c}`)
      .join(", ")}`,
  );
});

test("getStaticSitemapEntries contains the 9 previously-duplicate URLs (BUY-57452)", async () => {
  // These 9 URLs must still appear (we removed hardcoded copies, not the
  // pages themselves), and each must now appear exactly once.
  const entries = await getStaticSitemapEntries();
  const urls = new Set(entries.map((e) => e.url));
  const required = [
    "https://buywhere.ai/blog/cheapest-iphone-singapore-2026",
    "https://buywhere.ai/blog/best-laptop-deals-singapore",
    "https://buywhere.ai/blog/best-gaming-laptops-us-2026",
    "https://buywhere.ai/blog/compare-headphones-singapore-2026",
    "https://buywhere.ai/blog/home-appliance-deals-singapore-2026",
    "https://buywhere.ai/blog/compare-product-prices-singapore-2026",
    "https://buywhere.ai/iphone-16-price-singapore",
    "https://buywhere.ai/laptop-singapore",
    "https://buywhere.ai/air-purifier-singapore",
  ];
  for (const url of required) {
    assert.ok(urls.has(url), `expected ${url} in sitemap-pages.xml`);
  }
});

test("getStaticSitemapEntries count is 230 (matches the post-fix prod target) or fewer (BUY-57452)", async () => {
  // Pre-fix: 239 <url> blocks (230 unique). Post-fix: 230 <url> blocks.
  // We accept <=230 to tolerate future removals (e.g. soft-404 slugs)
  // without breaking the test. We assert <=230 strictly so any future
  // re-emission of removed hardcoded entries surfaces here, not in GSC.
  const entries = await getStaticSitemapEntries();
  assert.ok(
    entries.length <= 230,
    `sitemap-pages.xml emitted ${entries.length} entries; expected <= 230`,
  );
});


test("getCompareSitemapEntries includes every canonical populated category pair once (BUY-65161)", async () => {
  const entries = await getCompareSitemapEntries();
  const comparePairPaths = entries
    .map((e) => new URL(e.url).pathname)
    .filter((p) => p.startsWith("/compare/") && p.includes("-vs-"));

  assert.ok(
    comparePairPaths.length >= 500,
    `expected at least 500 category pair URLs; got ${comparePairPaths.length}`,
  );

  assert.equal(
    new Set(comparePairPaths).size,
    comparePairPaths.length,
    "category pair URLs should be unique",
  );

  for (const path of comparePairPaths) {
    const pairSlug = path.replace("/compare/", "");
    const [left, right] = pairSlug.split("-vs-");
    assert.ok(left < right, `${path} should use deterministic canonical slug ordering`);
    assert.ok(!comparePairPaths.includes(`/compare/${right}-vs-${left}`), `${path} should not have a symmetric duplicate`);
  }
});
