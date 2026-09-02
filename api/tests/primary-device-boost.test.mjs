import test from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_ACCESSORY_PG_RE_SOURCE,
  primaryDeviceCategoryBoostSql,
  deviceAccessoryPenaltySql,
} from "../dist/lib/searchRelevanceTaxonomy.js";

function jsRe() {
  return new RegExp(DEVICE_ACCESSORY_PG_RE_SOURCE.replace(/\\m|\\M/g, "\\b"), "i");
}

test("DEVICE_ACCESSORY_PG_RE_SOURCE matches cases/mounts/AppleCare", () => {
  const re = jsRe();
  for (const title of [
    "iPhone 15 Pro Max Eagle 3 Magnetic Golf Case",
    "Quad Lock MAG Case Mount",
    "OtterBox Defender Series Case",
    "AppleCare+ for iPhone",
    "iPhone camera lens kit",
  ]) {
    assert.ok(re.test(title), title);
  }
});

test("DEVICE_ACCESSORY_PG_RE_SOURCE leaves primary devices", () => {
  const re = jsRe();
  for (const title of [
    "iPhone 17 512GB",
    "iPad Air 11-inch M3",
    "AirPods Pro 3",
    "Samsung Galaxy Tab S10",
  ]) {
    assert.equal(re.test(title), false, title);
  }
});

test("boost SQL interpolates alias and accessory regex", () => {
  const sql = primaryDeviceCategoryBoostSql("rh");
  assert.match(sql, /rh\.title/);
  assert.match(sql, /THEN 4\.0/);
  assert.ok(sql.includes(DEVICE_ACCESSORY_PG_RE_SOURCE.split("|")[0]));
  const penalty = deviceAccessoryPenaltySql("sp");
  assert.match(penalty, /THEN 0\.12/);
  assert.match(penalty, /sp\.title/);
});
