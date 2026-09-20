import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "ProductGridCard.tsx"), "utf8");

// BUY-82520: wrapping-only did not ship a readable CTA. The card must use the
// shortened helper and keep "View details" as a full phrase (no nowrap clip).
// BUY-77758: buyAtCtaLabel() now handles truncation internally (18-char cap), so
// the whitespace-normal class is no longer required — the helper replaces it.
test("BUY-82520: ProductGridCard uses buyAtCtaLabel, not raw merchant in CTA", () => {
  assert.match(source, /buyAtCtaLabel/);
  assert.match(source, /\{buyAtCtaLabel\(product\.merchant\)\}/);
  assert.doesNotMatch(source, /Buy at \{product\.merchant\}/);
  assert.match(source, /View details/);
});
