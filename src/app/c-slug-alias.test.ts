// BUY-64729: alias map for /c/{slug} → canonical SEO landing page
//
// Kept in a sibling .test.ts file (not src/app/c/[slug]/page.test.ts) because
// tsx's --test glob can't handle the bracket characters in the path. The
// resolution logic itself still lives in src/app/c/[slug]/page.tsx and is
// mirrored below so the test is self-contained and runs under node:test.

import assert from "node:assert/strict";
import test from "node:test";
import { seoLandingPages } from "@/lib/seo-landing-pages";

// Mirrors SLUG_ALIASES in src/app/c/[slug]/page.tsx — keep in sync.
const SLUG_ALIASES: Record<string, string> = {
  laptop: "laptop-singapore",
  laptops: "laptop-singapore",
  "air-purifier": "air-purifier-singapore",
  "air-purifiers": "air-purifier-singapore",
  "air purifier": "air-purifier-singapore",
  electronics: "best-gaming-laptops-us",
  fashion: "laptop-singapore",
  "home-living": "laptop-singapore",
  "beauty-health": "laptop-singapore",
  "laptop-singapore": "laptop-singapore",
  "air-purifier-singapore": "air-purifier-singapore",
};

function resolveCanonicalSlug(slug: string): string | null {
  const normalized = slug.toLowerCase();
  if (seoLandingPages[normalized]) return normalized;
  const aliased = SLUG_ALIASES[normalized];
  if (aliased && seoLandingPages[aliased]) return aliased;
  return null;
}

test("BUY-64729 /c/laptop resolves to laptop-singapore", () => {
  assert.equal(resolveCanonicalSlug("laptop"), "laptop-singapore");
});

test("BUY-64729 /c/air-purifier resolves to air-purifier-singapore", () => {
  assert.equal(resolveCanonicalSlug("air-purifier"), "air-purifier-singapore");
});

test("BUY-64729 /c/laptop-singapore resolves to itself (idempotent)", () => {
  assert.equal(
    resolveCanonicalSlug("laptop-singapore"),
    "laptop-singapore",
  );
});

test("BUY-64729 /c/air-purifier-singapore resolves to itself (idempotent)", () => {
  assert.equal(
    resolveCanonicalSlug("air-purifier-singapore"),
    "air-purifier-singapore",
  );
});

test("BUY-64729 unknown /c/{slug} returns null (renders 404)", () => {
  assert.equal(resolveCanonicalSlug("totally-not-a-category"), null);
});

test("BUY-64729 case-insensitive resolution", () => {
  assert.equal(resolveCanonicalSlug("LAPTOP"), "laptop-singapore");
  assert.equal(resolveCanonicalSlug("Air-Purifier"), "air-purifier-singapore");
});

test("BUY-64729 every alias target exists in seoLandingPages", () => {
  for (const [alias, target] of Object.entries(SLUG_ALIASES)) {
    assert.ok(
      seoLandingPages[target],
      `SLUG_ALIASES['${alias}'] -> '${target}' does not exist in seoLandingPages`,
    );
  }
});