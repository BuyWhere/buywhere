import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const page = readFileSync(join(root, "src/components/seo/SeoLandingPage.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

test("BUY-83430: catalog snapshot section is tagged and min-h-0", () => {
  assert.match(page, /catalog-snapshot-section/);
  assert.match(page, /min-h-0/);
  assert.match(page, /max-sm:pb-6/);
});

test("BUY-83430: desktop py-16 remains for non-compact landings", () => {
  assert.match(page, /py-16 max-sm:min-h-0 max-sm:pt-8 max-sm:pb-6/);
});

test("BUY-83430: globals.css mobile rule sets min-height auto and pb 24px", () => {
  assert.match(css, /@media \(max-width: 639px\)/);
  assert.match(css, /min-height:\s*auto/);
  assert.match(css, /padding-bottom:\s*24px/);
  assert.match(css, /\.catalog-snapshot-section/);
});
