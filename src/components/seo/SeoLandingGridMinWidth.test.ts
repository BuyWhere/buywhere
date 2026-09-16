// Regression test for BUY-82522.
//
// VidMee (asset vidmee_ss_a1e6f3e58f7dd4dbf18b809f) flagged /laptop-singapore
// at ~1000px desktop: a 4-col grid crushed product cards to ~183px, mid-word
// title truncation, cramped price/CTAs.
//
// The shared SeoLandingPage catalog snapshot must use auto-fit + minmax(240px)
// (or equivalently 3 cols below 1024px), never xl/lg 4-col tracks that fire
// while the card is still narrower than 240px.
//
// Run: `npx tsx --test src/components/seo/SeoLandingGridMinWidth.test.ts`

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const templatePath = fileURLToPath(new URL("./SeoLandingPage.tsx", import.meta.url));
const template = readFileSync(templatePath, "utf8");

test("non-compact catalog grid uses auto-fit minmax(240px) (BUY-82522)", () => {
  assert.ok(
    /repeat\(auto-fit,\s*minmax\(min\(100%,\s*240px\),\s*1fr\)\)/.test(template),
    "expected catalog grid to use repeat(auto-fit, minmax(min(100%,240px),1fr))"
  );
});

test("non-compact catalog grid must not force 4 columns at xl/lg (BUY-82522)", () => {
  assert.ok(
    !/sm:grid-cols-2 xl:grid-cols-4/.test(template),
    "old sm:grid-cols-2 xl:grid-cols-4 catalog grid must be gone"
  );
  assert.ok(
    !/lg:grid-cols-4/.test(template),
    "catalog snapshot must not use lg:grid-cols-4 (fires at 1024px / ~183–230px cards)"
  );
});

test("live catalog grid must render priced rows even without imageUrl (BUY-77657)", () => {
  // /laptop-singapore JSON-LD lists Apple.sg MacBooks with a live floor, but
  // BUY-80551 `.filter((p) => p.imageUrl)` emptied the ATF grid because those
  // rows have no raster URL. ProductGridImage already silhouettes empty src.
  assert.ok(
    !/\.filter\(\(p\)\s*=>\s*p\.imageUrl\)/.test(template),
    "must not hide live catalog cards solely because imageUrl is missing"
  );
});
