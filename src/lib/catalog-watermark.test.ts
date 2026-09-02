import assert from "node:assert/strict";
import test from "node:test";
import {
  compareHeroFreshnessCopy,
  formatUtcLongDate,
  homeTopDealFreshnessCopy,
  parseWatermarkMs,
  pickCatalogWatermark,
} from "@/lib/catalog-watermark";

const NOW = Date.parse("2026-09-02T12:00:00Z");

test("parseWatermarkMs rejects missing, invalid, and future values", () => {
  assert.equal(parseWatermarkMs(null, NOW), null);
  assert.equal(parseWatermarkMs("", NOW), null);
  assert.equal(parseWatermarkMs("not-a-date", NOW), null);
  assert.equal(parseWatermarkMs("2026-09-03T00:00:00Z", NOW), null);
  assert.equal(parseWatermarkMs("2026-09-01T12:00:00Z", NOW), Date.parse("2026-09-01T12:00:00Z"));
});

test("formatUtcLongDate uses en-US long UTC", () => {
  assert.equal(formatUtcLongDate(Date.parse("2026-09-01T12:00:00Z")), "September 1, 2026");
});

test("pickCatalogWatermark prefers request-time max over env", () => {
  const env = "2026-08-01T00:00:00Z";
  const picked = pickCatalogWatermark(
    ["2026-08-15T00:00:00Z", "2026-09-01T12:00:00Z"],
    env,
    NOW,
  );
  assert.equal(picked, Date.parse("2026-09-01T12:00:00Z"));
});

test("pickCatalogWatermark falls back to LAST_REFRESH_ISO when offers empty", () => {
  const picked = pickCatalogWatermark([], "2026-08-20T00:00:00Z", NOW);
  assert.equal(picked, Date.parse("2026-08-20T00:00:00Z"));
});

test("pickCatalogWatermark treats future env as missing", () => {
  assert.equal(pickCatalogWatermark([], "2026-12-01T00:00:00Z", NOW), null);
});

test("compareHeroFreshnessCopy omits date when watermark missing", () => {
  assert.equal(
    compareHeroFreshnessCopy(null),
    "Live retailer pricing · cached up to 5 minutes",
  );
  assert.equal(
    compareHeroFreshnessCopy(Date.parse("2026-09-01T12:00:00Z")),
    "Last refreshed: September 1, 2026 · live data cached for 5 minutes",
  );
});

test("homeTopDealFreshnessCopy omits date when watermark missing", () => {
  assert.equal(homeTopDealFreshnessCopy(null), "Top-deal module");
  assert.equal(
    homeTopDealFreshnessCopy(Date.parse("2026-09-01T12:00:00Z")),
    "Top-deal module · refreshed September 1, 2026",
  );
});
