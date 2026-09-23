// BUY-83804: homepage suggestion chips must stay single-line on mobile.
// Guard the source so a later layout tweak cannot drop nowrap / shrink-0
// and force labels like "wireless headphones" onto two lines.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "HomeProductSearch.tsx"),
  "utf8",
);

test("BUY-83804: chip row is a horizontally scrollable nowrap flex", () => {
  assert.match(src, /overflow-x-auto/);
  assert.match(src, /flex-nowrap/);
});

test("BUY-83804: chip buttons cannot wrap or shrink", () => {
  assert.match(src, /whitespace-nowrap/);
  assert.match(src, /shrink-0/);
  assert.match(src, /min-h-11/);
});
