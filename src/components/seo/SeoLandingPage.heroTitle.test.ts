// Regression test for BUY-66320.
//
// QA reopened the issue because the H1 on /best-robot-vacuums-2026 read
// "Best Robot Vacuums 2026 from $199 — Roomba & Roborock Deals" while the
// Live Catalog Snapshot directly below showed actual deals at $120 (Tecbot S1),
// $130 (iMass A3), and $130 (Tecbot S3 Pro). The static "from $199" anchor in
// heroTitle was above the catalog floor, so the page contradicted itself.
//
// deriveHeroTitle must:
//   - render "from $N" using the lowest numeric price in the live product list
//   - fall back to the cleaned (anchor-stripped) static heroTitle when no
//     products or no numeric prices are available, so the page never claims a
//     floor that isn't supported by the catalog
//   - preserve any " — <tail>" segment of the static heroTitle
import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./SeoLandingPage";
import type { SeoLandingPageConfig, LandingProduct } from "@/lib/seo-landing-pages";

const { deriveHeroTitle, cleanStaticHeroTitle } = __test__;

function makeConfig(overrides: Partial<SeoLandingPageConfig> = {}): SeoLandingPageConfig {
  return {
    slug: "test-page",
    title: "Test",
    description: "Test",
    heroEyebrow: "Test",
    heroTitle: "Test",
    heroBody: "Test",
    canonicalPath: "/test",
    country: "US",
    currency: "USD",
    locale: "en_US",
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

function makeProduct(price: number | null, currency = "USD"): LandingProduct {
  return {
    id: "x",
    name: "X",
    price,
    currency,
    merchant: "M",
    imageUrl: null,
    href: "/x",
    brand: null,
    category: null,
  };
}

test("renders the live catalog floor in the hero anchor (BUY-66320 QA scenario)", () => {
  // Mirror the live /best-robot-vacuums-2026 wire: catalog floor = $120 (Tecbot S1).
  const title = deriveHeroTitle(
    makeConfig({
      heroTitle: "Best Robot Vacuums 2026 — Roomba & Roborock Deals",
      currency: "USD",
    }),
    [makeProduct(120), makeProduct(130), makeProduct(560), makeProduct(999)],
  );
  assert.equal(title, "Best Robot Vacuums 2026 from $120 — Roomba & Roborock Deals");
});

test("falls back to cleaned static heroTitle when products array is empty", () => {
  // Static heroTitle still carries the stale "from $199" anchor; the helper
  // must strip it so the fallback never contradicts an absent catalog.
  const title = deriveHeroTitle(
    makeConfig({
      heroTitle: "Best Robot Vacuums 2026 from $199 — Roomba & Roborock Deals",
      currency: "USD",
    }),
    [],
  );
  assert.equal(title, "Best Robot Vacuums 2026 — Roomba & Roborock Deals");
});

test("falls back to cleaned static heroTitle when products have no numeric price", () => {
  const title = deriveHeroTitle(
    makeConfig({
      heroTitle: "Best Robot Vacuums 2026 from $199 — Roomba & Roborock Deals",
      currency: "USD",
    }),
    [makeProduct(null), makeProduct(null)],
  );
  assert.equal(title, "Best Robot Vacuums 2026 — Roomba & Roborock Deals");
});

test("ignores zero / negative / NaN prices when computing the floor", () => {
  const title = deriveHeroTitle(
    makeConfig({
      heroTitle: "Best Deals — Picks",
      currency: "USD",
    }),
    [makeProduct(0), makeProduct(-5), makeProduct(Number.NaN), makeProduct(250)],
  );
  assert.equal(title, "Best Deals from $250 — Picks");
});

test("preserves the static ' — <tail>' segment when present", () => {
  const title = deriveHeroTitle(
    makeConfig({
      heroTitle: "Best Air Purifier — Editor Picks",
      currency: "USD",
    }),
    [makeProduct(189)],
  );
  assert.equal(title, "Best Air Purifier from $189 — Editor Picks");
});

test("appends 'from $N' suffix when the static heroTitle has no em-dash separator", () => {
  const title = deriveHeroTitle(
    makeConfig({
      heroTitle: "Best Laptop Deals",
      currency: "USD",
    }),
    [makeProduct(499)],
  );
  assert.equal(title, "Best Laptop Deals from $499");
});

test("uses the page's currency (USD vs SGD)", () => {
  const usdTitle = deriveHeroTitle(
    makeConfig({ heroTitle: "Best Deals — Picks", currency: "USD" }),
    [makeProduct(189)],
  );
  const sgdTitle = deriveHeroTitle(
    makeConfig({ heroTitle: "Best Deals — Picks", currency: "SGD" }),
    [makeProduct(189, "SGD")],
  );
  assert.equal(usdTitle, "Best Deals from $189 — Picks");
  // Intl renders SGD via en-SG as "S$189" in production; tolerate "SGD 189" too.
  assert.ok(
    sgdTitle === "Best Deals from S$189 — Picks" || sgdTitle === "Best Deals from SGD 189 — Picks",
    `unexpected SGD title: ${sgdTitle}`,
  );
});

test("cleanStaticHeroTitle strips any existing 'from $N' anchor", () => {
  assert.equal(
    cleanStaticHeroTitle("Best Robot Vacuums 2026 from $199 — Roomba & Roborock Deals"),
    "Best Robot Vacuums 2026 — Roomba & Roborock Deals",
  );
  assert.equal(cleanStaticHeroTitle("Best Laptop Deals"), "Best Laptop Deals");
});