import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateAllowlistSlugs,
  isMerchantAllowedForCountry,
} from "@/lib/merchant-allowlist";

// BUY-77121 — the catalog search API returns merchant slugs in three shapes:
//   (a) the allowlist's bare form ("challenger", "apple_sg"),
//   (b) domain-style ("challenger.com.sg", "walmart.com"),
//   (c) ingest-feed suffixed ("apple_sg_buy_xml").
// The country allowlist lookup must accept all three — otherwise live SG/US
// product cards get filtered out before the rendered page sees them and the
// SEO landing page renders with zero priced products. The cases below cover
// each variant against the SG and US allowlists.

test("BUY-77121: domain-style slugs normalize to the allowlist's bare form", () => {
  // SG — the actual catalog-side form observed at 2026-08-29
  assert.equal(
    isMerchantAllowedForCountry({ merchant: "challenger.com.sg" }, "SG"),
    true,
    "challenger.com.sg must match SG allowlist entry 'challenger'",
  );
  // US — bare '.com' domain variant
  assert.equal(
    isMerchantAllowedForCountry({ merchant: "walmart.com" }, "US"),
    true,
    "walmart.com must match US allowlist entry 'walmart'",
  );
  assert.equal(
    isMerchantAllowedForCountry({ merchant: "amazon.com" }, "US"),
    true,
    "amazon.com must match US allowlist entry 'amazon'",
  );
});

test("BUY-77121: ingest-suffix slugs (e.g. apple_sg_buy_xml) normalize to the allowlist form", () => {
  assert.equal(
    isMerchantAllowedForCountry({ merchant: "apple_sg_buy_xml" }, "SG"),
    true,
    "apple_sg_buy_xml must match 'apple' / 'apple_sg' allowlist entries",
  );
  assert.equal(
    isMerchantAllowedForCountry({ merchant: "apple_us_buy_xml" }, "US"),
    true,
    "apple_us_buy_xml must match 'apple' / 'apple_us'",
  );
});

test("BUY-77121: bare allowlist slugs still match (no regression)", () => {
  assert.equal(isMerchantAllowedForCountry({ merchant: "challenger" }, "SG"), true);
  assert.equal(isMerchantAllowedForCountry({ merchant: "challenger_sg" }, "SG"), true);
  assert.equal(isMerchantAllowedForCountry({ merchant: "walmart" }, "US"), true);
  assert.equal(isMerchantAllowedForCountry({ merchant: "amazon" }, "US"), true);
});

test("BUY-77121: non-allowlisted merchants still rejected", () => {
  assert.equal(
    isMerchantAllowedForCountry({ merchant: "compumarts.com" }, "US"),
    false,
    "compumarts.com must NOT match US allowlist (was the BUY-73741 leak)",
  );
  assert.equal(
    isMerchantAllowedForCountry({ merchant: "namshi" }, "SG"),
    false,
    "namshi must NOT match SG allowlist (BUY-73741 denylist family)",
  );
});

test("BUY-77121: empty / missing merchant still rejected", () => {
  assert.equal(isMerchantAllowedForCountry({}, "SG"), false);
  assert.equal(isMerchantAllowedForCountry({ merchant: null }, "US"), false);
  assert.equal(isMerchantAllowedForCountry({ merchant: "" }, "SG"), false);
});

test("BUY-77121: candidateAllowlistSlugs returns variants in priority order", () => {
  const candidates = candidateAllowlistSlugs("challenger.com.sg");
  assert.ok(candidates.includes("challenger.com.sg"), "raw form preserved first");
  assert.ok(candidates.includes("challenger"), "first label extracted");
  assert.ok(candidates.includes("challenger_sg"), "first_label + country suffix form");
  // Raw form must be at index 0 so legitimate bare-form matches hit first.
  assert.equal(candidates[0], "challenger.com.sg");
});

test("BUY-77121: ingest suffix (apple_sg_buy_xml) strips _buy_xml to apple_sg", () => {
  const candidates = candidateAllowlistSlugs("apple_sg_buy_xml");
  assert.ok(candidates.includes("apple_sg_buy_xml"));
  assert.ok(candidates.includes("apple_sg"), "strips _buy_xml suffix");
  // 'apple' isn't auto-derived from 'apple_sg' (no dot, no extra strip), so
  // the candidate list stops at apple_sg — the SG allowlist already contains
  // both 'apple' and 'apple_sg'.
});
