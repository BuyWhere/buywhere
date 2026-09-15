/**
 * BUY-82519: bare "laptop" intent + exact-title demotion must not
 * fire on real laptop SKUs.
 *
 *   node --test tests/buy-82519-laptop-intent.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LAPTOP_ACCESSORY_PG_RE_SOURCE,
  LAPTOP_ACCESSORY_SOFT_TOKENS,
  NON_COMPUTER_TITLE_PG_RE_SOURCE,
  isBareDeviceQuery,
} from "../dist/lib/searchRelevanceTaxonomy.js";

test("isBareDeviceQuery treats standalone laptop as computer intent", () => {
  assert.equal(isBareDeviceQuery("laptop"), true);
  assert.equal(isBareDeviceQuery("laptop bag"), false);
});

test("BUY-82519 accessory tokens cover bags/kits/pouches/diagnostics", () => {
  for (const token of ["bag", "diagnostic", "repair kit", "tablet kit", "pouch"]) {
    assert.ok(
      LAPTOP_ACCESSORY_SOFT_TOKENS.includes(token),
      `missing accessory token ${token}`,
    );
  }
});

test("accessory regex matches bag / diagnostic kit, not ThinkPad", () => {
  const jsSrc = LAPTOP_ACCESSORY_PG_RE_SOURCE.replace(/\\m|\\M/g, "");
  const re = new RegExp(jsSrc, "i");
  assert.equal(re.test("Lacoste Laptop Bag"), true);
  assert.equal(re.test("Diesel Laptops diagnostic tablet kit"), true);
  assert.equal(re.test("Lenovo ThinkPad E14 G5"), false);
  assert.equal(re.test("Acer Aspire E5-772 Laptop PC"), false);
});

test("exact 'Laptop' demotion does not match real laptop titles", () => {
  const re = new RegExp(NON_COMPUTER_TITLE_PG_RE_SOURCE.replace(/\\m|\\M/g, ""), "i");
  assert.equal(re.test("Laptop"), true);
  assert.equal(re.test("Wooden Notebook / Laptop"), true);
  assert.equal(re.test("Laptop and tree, and androids"), true);
  assert.equal(re.test("Lenovo G50 Laptop, Intel Core i5"), false);
  assert.equal(re.test("Acer Aspire E5-772 Laptop PC"), false);
});
