// Regression test for BUY-83805.
//
// VidMee (asset vidmee_ss_c8310a46923ac15a0b340946) flagged /laptop-singapore
// mobile: "Open full search" had ~22px clickable height (WCAG 44×44 fail) and
// ~120px blank space below the snapshot/hero. Guard the shared template:
//   - the Open full search Link uses min-h-[44px] (not min-h-11, which may
//     not emit in this Tailwind build)
//   - non-compact snapshot padding is py-8 sm:py-16 (not py-16 on mobile)
//
// Run: `npx tsx --test src/components/seo/SeoLandingPage.mobileTap.test.ts`

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = readFileSync(
  fileURLToPath(new URL("./SeoLandingPage.tsx", import.meta.url)),
  "utf8",
);

test("BUY-83805: Open full search Link has min-h-[44px] tap target", () => {
  const idx = source.indexOf(">\n                Open full search");
  assert.ok(idx > 0, "expected Open full search label");
  const window = source.slice(Math.max(0, idx - 800), idx + 80);
  assert.ok(
    /min-h-\[44px\]/.test(window),
    "Open full search Link must set min-h-[44px] (WCAG 2.5.5 / 2.5.8)",
  );
  assert.ok(
    !/\bmin-h-11\b/.test(window),
    "do not use min-h-11 on this Link — it has compiled to ~22px in prod",
  );
});

test("BUY-83805: non-compact snapshot padding is reduced on mobile", () => {
  assert.ok(
    /compactCatalogCards\s*\?\s*"py-4 sm:py-6"\s*:\s*"py-8 sm:py-16"/.test(source),
    "expected snapshot padding py-4 sm:py-6 compact / py-8 sm:py-16 otherwise",
  );
  assert.ok(
    !/compactCatalogCards\s*\?\s*"py-6"\s*:\s*"py-16"/.test(source),
    "unconditional py-16 on the snapshot must be gone (mobile blank space)",
  );
});
