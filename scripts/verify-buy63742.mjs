// One-off sanity check that mirrors the BUY-63742 regression test without
// requiring the project's tsx loader. Re-implements the same pure logic
// from SeoLandingPage.tsx so we can prove the guard fires before the
// GitHub Actions deploy finishes.
import assert from "node:assert/strict";

const STALE_CATALOG_DAYS = 30;
const NOW = Date.parse("2026-07-29T00:00:00Z");

function parseCatalogTimestamp(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function buildRefreshedLabel(products, refreshedLabel) {
  if (refreshedLabel) return refreshedLabel;
  const staleCutoff = NOW - STALE_CATALOG_DAYS * 86400_000;
  const latest = products
    .map((p) => parseCatalogTimestamp(p.updatedAt))
    .filter((d) => d !== null)
    .filter((d) => d.getTime() <= NOW && d.getTime() >= staleCutoff)
    .map((d) => d.getTime())
    .reduce((max, ts) => (max === null || ts > max ? ts : max), null);
  if (latest !== null) {
    const formatted = new Date(latest).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
    });
    return `Updated ${formatted}`;
  }
  return "Live prices updated regularly";
}

const QA_REPRO = [
  { updatedAt: "2026-05-05T12:34:56Z" }, // exact date QA flagged
  { updatedAt: "2026-04-11T08:00:00Z" },
];

assert.equal(
  buildRefreshedLabel(QA_REPRO, undefined),
  "Live prices updated regularly",
  "stale 2026-05-05 must fall back, not render as Updated May 5, 2026",
);

assert.equal(
  buildRefreshedLabel([{ updatedAt: new Date(NOW + 86400_000 * 7).toISOString() }], undefined),
  "Live prices updated regularly",
  "future-dated product must be ignored",
);

const FRESH = new Date(NOW - 5 * 86400_000).toISOString();
assert.match(buildRefreshedLabel([{ updatedAt: FRESH }], undefined), /^Updated /, "fresh date must render");

assert.equal(
  buildRefreshedLabel(QA_REPRO, "Reviewed by our team — March 2026"),
  "Reviewed by our team — March 2026",
  "explicit refreshedLabel must always win",
);

assert.equal(
  buildRefreshedLabel([{ updatedAt: null }, { updatedAt: "" }, { updatedAt: "not-a-date" }], undefined),
  "Live prices updated regularly",
  "no usable timestamps must fall back",
);

console.log("BUY-63742 logic check: PASS");
