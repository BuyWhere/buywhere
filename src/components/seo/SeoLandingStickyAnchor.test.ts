// Regression test for BUY-74692.
//
// VidMee (asset vidmee_ss_e1a5b9d7dd166dd52b3c0866) flagged that the Live
// Catalog Snapshot product cards on /best-gaming-laptops-us (and the shared
// template siblings /best-robot-vacuums-2026, /air-purifier-singapore)
// sit below the 836-px fold at 1440×900 because the hero consumes ~510 px
// of vertical space (sticky site header + bg-gradient section with
// py-16 lg:py-24 padding).
//
// The fix lives in the shared template SeoLandingPage.tsx:
//   - hero padding: py-16 lg:py-24 → py-12 lg:py-16 (saves 64 px top+bottom)
//   - new client component SeoLandingStickyAnchor renders a sticky
//     `<a href="#live-deals">` below the hero
//   - snapshot H2 gains `id="live-deals"` as the anchor target
//   - SSR HTML contains the anchor and id (works without JS)
//   - prefers-reduced-motion skips the IntersectionObserver hide dance
//
// This test fails CI if any of the following drift:
//   - hero padding regression on the shared template
//   - the sticky anchor or the live-deals id is removed
//   - the anchor text or href is changed
//
// Run: `npx tsx --test src/components/seo/SeoLandingStickyAnchor.test.ts`

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const templatePath = fileURLToPath(new URL("./SeoLandingPage.tsx", import.meta.url));
const anchorComponentPath = fileURLToPath(new URL("./SeoLandingStickyAnchor.tsx", import.meta.url));

const template = readFileSync(templatePath, "utf8");

test("SeoLandingPage renders the sticky anchor component below the hero", () => {
  assert.ok(
    /<SeoLandingStickyAnchor\s*\/>/.test(template),
    "expected SeoLandingStickyAnchor to be rendered inside the template"
  );
});

test("SeoLandingPage hero uses the compact py-12 lg:py-16 padding (BUY-74692)", () => {
  // The compactCatalogCards branch uses py-6; the main hero branch must
  // use py-12 lg:py-16 (was py-16 lg:py-24 pre-BUY-74692).
  assert.ok(
    /compactCatalogCards\s*\?\s*"py-6"\s*:\s*"py-12 lg:py-16"/.test(template),
    "expected hero padding to be py-12 lg:py-16 on the main branch"
  );
  assert.ok(
    !/compactCatalogCards\s*\?\s*"py-6"\s*:\s*"py-16 lg:py-24"/.test(template),
    "old py-16 lg:py-24 hero padding must be gone"
  );
});

test("snapshot H2 has id='live-deals' as the sticky anchor target", () => {
  assert.ok(
    /<h2\s+id="live-deals"\s+className="[^"]*">/.test(template),
    "expected snapshot H2 to carry id=\"live-deals\""
  );
});

test("SeoLandingStickyAnchor component file exists and is a Client Component", () => {
  assert.ok(existsSync(anchorComponentPath), "expected anchor component file at " + anchorComponentPath);
  const anchorSrc = readFileSync(anchorComponentPath, "utf8");
  assert.ok(
    /"use client"/.test(anchorSrc),
    "SeoLandingStickyAnchor must be a Client Component (uses IntersectionObserver)"
  );
});

test("sticky anchor links to #live-deals with the expected visible label", () => {
  const anchorSrc = readFileSync(anchorComponentPath, "utf8");
  assert.ok(
    /href="#live-deals"/.test(anchorSrc),
    "anchor href must be #live-deals"
  );
  assert.ok(
    /View live deals/.test(anchorSrc),
    "anchor label must include 'View live deals'"
  );
});

test("sticky anchor respects prefers-reduced-motion (BUY-74692 spec)", () => {
  const anchorSrc = readFileSync(anchorComponentPath, "utf8");
  assert.ok(
    /prefers-reduced-motion/.test(anchorSrc),
    "sticky anchor must branch on prefers-reduced-motion"
  );
});

test("sticky anchor uses IntersectionObserver to hide when #live-deals is in view", () => {
  const anchorSrc = readFileSync(anchorComponentPath, "utf8");
  assert.ok(
    /IntersectionObserver/.test(anchorSrc),
    "sticky anchor must use IntersectionObserver"
  );
  assert.ok(
    /document\.getElementById\("live-deals"\)/.test(anchorSrc),
    "sticky anchor must observe the #live-deals target"
  );
});