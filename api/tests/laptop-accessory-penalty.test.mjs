/**
 * BUY-77675: regression test for the laptop-accessory penalty in
 * searchRelevanceTaxonomy.ts. Asserts the shared token list matches every
 * accessory the QA captured (mics, IEMs, headphones, desks, portable
 * monitors, privacy screens, screen cleaners, keyboards) and rejects
 * nothing that is a real laptop.
 *
 * This test does NOT need a running DB — it imports the compiled JS
 * constant directly. Run with:
 *   node --test tests/laptop-accessory-penalty.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  LAPTOP_ACCESSORY_PG_RE_SOURCE,
  LAPTOP_ACCESSORY_SOFT_TOKENS,
} from "../dist/lib/searchRelevanceTaxonomy.js";

test("LAPTOP_ACCESSORY_PG_RE_SOURCE is exported and well-formed", () => {
  assert.ok(typeof LAPTOP_ACCESSORY_PG_RE_SOURCE === "string", "must be a string");
  assert.ok(LAPTOP_ACCESSORY_PG_RE_SOURCE.length > 100, "long-enough alternation");
  // Each alternation alternative is wrapped in \m(?:…\M); the joined
  // source therefore contains every word-boundary marker pair on every
  // token. Spot-check a few instead of asserting on the whole string.
  // Double-escape in JS template literal so the runtime string contains
  // a single backslash (matches the actual exported value).
  assert.ok(
    LAPTOP_ACCESSORY_PG_RE_SOURCE.includes(`\\m(?:microphone)\\M`),
    "every token must be \\m(?:-wrapped",
  );
  assert.ok(
    LAPTOP_ACCESSORY_PG_RE_SOURCE.endsWith(`\\M)`) ||
      LAPTOP_ACCESSORY_PG_RE_SOURCE.endsWith(`\\M`),
    "last alternative ends with \\M",
  );
});

test("LAPTOP_ACCESSORY_SOFT_TOKENS contains the QA-captured accessory categories", () => {
  // Map: category → at least one token that must be present
  const categoryTokens = {
    audio: ["microphone", "headphone", "earbud", "earphone", "airpod", "boya", "lavalier", "lapel"],
    furniture: ["standing desk", "lap desk", "bed desk", "bed table"],
    display: ["portable monitor", "screen extender", "external display", "privacy screen"],
    cleaning: ["screen cleaner", "cleaning spray", "screen wipes"],
    keyboard: ["wireless keyboard", "foldable keyboard", "bluetooth keyboard"],
  };
  for (const [category, tokens] of Object.entries(categoryTokens)) {
    for (const token of tokens) {
      assert.ok(
        LAPTOP_ACCESSORY_SOFT_TOKENS.includes(token),
        `${category} token "${token}" must be in LAPTOP_ACCESSORY_SOFT_TOKENS`,
      );
    }
  }
});

test("LAPTOP_ACCESSORY_PG_RE_SOURCE catches QA-captured accessories (regex syntax)", () => {
  // Postgres ARE syntax uses \m / \M. For JS-side verification we strip
  // them — the actual SQL engine handles word-boundary semantics natively.
  const jsSrc = LAPTOP_ACCESSORY_PG_RE_SOURCE.replace(/\\m|\\M/g, "");
  const re = new RegExp(jsSrc, "i");
  const accessories = [
    "Boya Wireless Lavalier Microphone BOYALINK A1 Mini Lapel Mic for iPhone Android Laptop",
    "BOYA Dual Wireless Lavalier Lapel Microphone for Android Smartphone Laptop",
    "rockpapa On Ear Stereo Headphones Earphones For Adults Kids Childs Teens",
    "WEICON Screen Cleaner 200 ml Touch Screen Cleaner Spray for Laptop Tablet Phone",
    "Laptop Desk for Bed Study Desk Portable Foldable Laptop Table Folding Breakfast Tray",
    "Laptop Lap Desk for Bed Portable Foldable Laptop Table",
    "Portable Monitor 15.6\" FHD 1080P Travel Portable Monitor for Laptop",
    "In Ear Monitors Headphones USB-C HiFi Wired Earbuds with Noise Isolating",
    "Laptop Screen Extender Portable Triple Monitor 15.6 inch FHD 1080P",
    "ProCase Wireless Keyboard for iOS Android Windows Device",
    "Geyes Foldable Bluetooth Keyboard Portable Folding Wireless Keyboard",
    "CARBONADO 30 L Backpack Gaming Backpack For Laptop",
    "Mesh Poofy Laptop Sleeve",
  ];
  for (const title of accessories) {
    assert.equal(re.test(title), true, `accessory must match: ${title}`);
  }
});

test("LAPTOP_ACCESSORY_PG_RE_SOURCE leaves real laptops untouched", () => {
  const jsSrc = LAPTOP_ACCESSORY_PG_RE_SOURCE.replace(/\\m|\\M/g, "");
  const re = new RegExp(jsSrc, "i");
  const laptops = [
    "Razer Blade Stealth 13 Ultrabook Laptop OLED",
    "Lenovo ThinkPad E14 G5",
    "Lenovo ThinkBook 14 G7",
    "MSI Modern 14 C13M-667SG Laptop",
    "MacBook Air 13 M3",
    "ASUS Zenbook 14 OLED",
    "Gaming Laptop i5 16 inch Laptop Computer",
    "2025 AMD Laptop Computer with Ryzen 7",
    "Dell Inspiron 15.6\" Laptop",
    "Lenovo IdeaPad Slim 3i 15.6\"",
    "Lenovo Yoga Slim 7",
    "HP 14 Student-Laptop",
    "Apple MacBook Pro 14",
    "LG gram 14\" Lightweight",
    // Critical model-name negative controls — `pad` and `mouse` style
    // substrings must NOT match inside legitimate laptop model names.
    "HP Pavilion 15",
    "Dell Latitude 7420",
    "HP Spectre x360",
  ];
  for (const title of laptops) {
    assert.equal(re.test(title), false, `laptop must NOT match: ${title}`);
  }
});

test("LAPTOP_ACCESSORY_PG_RE_SOURCE contains no SQL-injection vectors", () => {
  // The source is concatenated into a SQL string literal. Defensive check:
  // the token list must contain no single quotes or other characters that
  // could break out of the literal in the WAY it gets concatenated.
  assert.ok(
    !LAPTOP_ACCESSORY_PG_RE_SOURCE.includes("'"),
    "no single quotes in PG regex source — would break the SQL string literal",
  );
});
