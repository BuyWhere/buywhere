// Regression test for BUY-63742.
//
// QA reopened the issue because the hero "Updated …" badge on
// /air-purifier-singapore rendered a stale catalog date ("May 5, 2026" while
// today is 2026-07-29) that read as a placeholder to buyers.
//
// buildRefreshedLabel must:
//   - honour an explicit `refreshedLabel` override
//   - render the freshest product `updatedAt` only when it is recent enough
//     (≤ STALE_CATALOG_DAYS days, not in the future)
//   - fall back to the generic "Live prices updated regularly" copy whenever
//     no trustworthy timestamp is available, so a bad row never reaches the
//     hero badge.
import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./SeoLandingPage";
import type { SeoLandingPageConfig, LandingProduct } from "@/lib/seo-landing-pages";

const { buildRefreshedLabel, STALE_CATALOG_DAYS } = __test__;

function makeConfig(overrides: Partial<SeoLandingPageConfig> = {}): SeoLandingPageConfig {
  return {
    slug: "test-page",
    title: "Test",
    description: "Test",
    heroEyebrow: "Test",
    heroTitle: "Test",
    heroBody: "Test",
    canonicalPath: "/test",
    country: "SG",
    currency: "SGD",
    locale: "en_SG",
    searchQuery: "test",
    productSectionTitle: "Test",
    comparisonSectionTitle: "Test",
    comparisonColumns: [],
    comparisonRows: [],
    highlightSectionTitle: "Test",
    highlights: [],
    adviceSectionTitle: "Test",
    advicePoints: [],
    faqSectionTitle: "Test",
    faqs: [],
    fallbackProducts: [],
    ...overrides,
  };
}

function makeProduct(updatedAt: string | null): LandingProduct {
  return {
    id: "x",
    name: "X",
    price: 100,
    currency: "SGD",
    merchant: "M",
    imageUrl: null,
    href: "/x",
    brand: null,
    category: null,
    updatedAt,
  };
}

test("uses an explicit refreshedLabel override when date is valid", () => {
  const label = buildRefreshedLabel(
    makeConfig({ refreshedLabel: "Reviewed by our team — March 2026" }),
    [makeProduct("2026-07-29T00:00:00Z")],
  );
  assert.equal(label, "Reviewed by our team — March 2026");
});

test("rejects hardcoded refreshedLabel with future date (BUY-63853)", () => {
  // A hardcoded label like "Updated July 21, 2026" when today is July 22, 2026
  // should fall back to dynamic (or generic) rather than showing a future date.
  // Use a clearly future date to ensure test stability.
  const futureLabel = `Updated December 25, 2099`; // Way in the future
  const label = buildRefreshedLabel(makeConfig({ refreshedLabel: futureLabel }), [
    makeProduct("2026-07-29T00:00:00Z"),
  ]);
  // Should NOT return the future-dated label - should fall back to dynamic or generic
  assert.notEqual(label, futureLabel);
});

test("ignores future-dated product updates (BUY-63742)", () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const label = buildRefreshedLabel(makeConfig(), [
    makeProduct(future),
    makeProduct(null),
  ]);
  // All products are either future-dated or null → should fall back to generic copy
  assert.equal(label, "Live prices updated regularly");
});

test("ignores catalog updates older than STALE_CATALOG_DAYS days (BUY-63742)", () => {
  // QA flagged the exact 2026-05-05 catalog date on /air-purifier-singapore.
  // With today = 2026-07-29 that is ~85 days old — well outside the
  // STALE_CATALOG_DAYS window (30), so the badge must fall back.
  const stale = new Date(Date.now() - (STALE_CATALOG_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
  const label = buildRefreshedLabel(makeConfig(), [makeProduct(stale)]);
  assert.equal(label, "Live prices updated regularly");
});

test("renders the freshest in-window product update", () => {
  const recentA = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const recentB = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const label = buildRefreshedLabel(makeConfig(), [
    makeProduct(recentA),
    makeProduct(recentB),
    makeProduct(null),
    makeProduct("not-a-date"),
  ]);
  assert.match(label, /^Updated /);
  assert.match(label, new RegExp(String(new Date().getFullYear())));
});

test("falls back to generic copy when no timestamps are usable", () => {
  const label = buildRefreshedLabel(makeConfig(), [
    makeProduct(null),
    makeProduct(undefined as unknown as null),
    makeProduct(""),
  ]);
  assert.equal(label, "Live prices updated regularly");
});
