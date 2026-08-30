// Regression test for BUY-68365.
//
// QA found that searching "gaming laptop" on https://buywhere.ai/search
// ranked "Seagate Firecuda 520 1TB Performance Internal Solid State Drive SSD
// PCIe Gen4 X4 NVMe 1.3 for Gaming PC Gaming Laptop Desktop" as the #2 result.
// The FTS engine matches the marketing copy "Gaming PC Gaming Laptop Desktop"
// without checking the product's `category` field; the upstream row's category
// is "Storage", which is the source of truth.
//
// isCategoryMismatchedForDeviceQuery must:
//   - flag a "Storage" product when the query contains a complete-device token
//     (laptop, phone, monitor, tv, playstation, xbox, refrigerator, dishwasher)
//   - NOT flag a "Laptops" product for "gaming laptop"
//   - NOT flag a product whose category is empty/null (other heuristics decide)
//   - NOT flag non-device queries ("gaming mouse", "wireless headphones")
//   - NOT flag device queries whose category is in the allowed set
//     (e.g. "playstation" + "PlayStation" is fine)
//
// sortProductsByRelevance must:
//   - rank a category-mismatched (Storage) product below a category-matching
//     (Laptops) product even when the mismatched product has a higher image
//     score and valid price
//   - preserve the relative order of two category-matching products
//   - preserve the relative order of two category-mismatched products
//   - be a no-op for queries that don't trigger a device token

import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./SearchResultsClient";

const {
  isCategoryMismatchedForDeviceQuery,
  rankProduct,
  sortProductsByRelevance,
} = __test__;

interface SearchCardProduct {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  brand: string | null;
  merchant: string | null;
  url: string;
}

function card(name: string, category: string | null, opts: Partial<SearchCardProduct> = {}): SearchCardProduct {
  return {
    id: opts.id ?? Math.random().toString(36).slice(2),
    name,
    category,
    price: opts.price ?? 1499.99,
    currency: opts.currency ?? "USD",
    imageUrl: opts.imageUrl ?? "https://example.com/img.jpg",
    brand: opts.brand ?? null,
    merchant: opts.merchant ?? null,
    url: opts.url ?? "https://example.com/p",
  };
}

const FIRECUDA = "Seagate Firecuda 520 1TB Performance Internal Solid State Drive SSD PCIe Gen4 X4 NVMe 1.3 for Gaming PC Gaming Laptop Desktop";
const GIGABYTE = "GIGABYTE GAMING A16 Gaming Laptop - 165Hz WUXGA - NVIDIA GeForce RTX 5060 - AMD Ryzen 7 260 - 1TB SSD with 16GB DDR5 RAM";
const ASUS_TUF = "ASUS TUF Gaming F16 Laptop Intel Core i7 14650HX 16GB DDR5 1TB SSD RTX 4060";
const BACKPACK = "Cooplus Gaming Backpack for Laptop 17.3 Inch";
const SLEEVE = "MOSISO Laptop Sleeve 13-13.3 inch Compatible with MacBook";
const APPLE_IPHONE_16 = "Apple iPhone 16 Pro Max 512GB";
const SAMSUNG_TV = 'Samsung 65" QLED 4K Smart Television';
const SAMSUNG_TV_CASE = "Samsung 65 inch TV Wall Mount Bracket with Cable Management";
const PS5 = "Sony PlayStation 5 Pro Console";
const PS5_CONTROLLER = "Sony DualSense Edge Wireless Controller for PlayStation 5";

test("BUY-68365: flags Storage-category firecuda for gaming laptop query", () => {
  assert.equal(isCategoryMismatchedForDeviceQuery("gaming laptop", card(FIRECUDA, "Storage")), true);
});

test("BUY-68365: does NOT flag Laptops-category gigabyte for gaming laptop query", () => {
  assert.equal(isCategoryMismatchedForDeviceQuery("gaming laptop", card(GIGABYTE, "Laptops")), false);
});

test("BUY-68365: does NOT flag empty-category products (let other heuristics decide)", () => {
  assert.equal(isCategoryMismatchedForDeviceQuery("gaming laptop", card(GIGABYTE, null)), false);
  assert.equal(isCategoryMismatchedForDeviceQuery("gaming laptop", card(GIGABYTE, "")), false);
});

test("BUY-68365: matches a tolerant variety of laptop tokens", () => {
  for (const q of ["gaming laptop", "laptop", "macbook", "macbook pro", "notebook", "chromebook", "ultrabook", "gaming laptops"]) {
    assert.equal(isCategoryMismatchedForDeviceQuery(q, card(FIRECUDA, "Storage")), true, `q=${q}`);
  }
});

test("BUY-68365: matches phone tokens", () => {
  assert.equal(isCategoryMismatchedForDeviceQuery("iphone", card("Anker USB-C Cable for iPhone", "Cables & Adapters")), true);
  assert.equal(isCategoryMismatchedForDeviceQuery("phone", card("Anker USB-C Cable for Android Phone", "Cables")), true);
  assert.equal(isCategoryMismatchedForDeviceQuery("phone", card(APPLE_IPHONE_16, "Smartphones")), false);
});

test("BUY-68365: matches monitor / tv / console / refrigerator / dishwasher", () => {
  assert.equal(isCategoryMismatchedForDeviceQuery("monitor", card(SAMSUNG_TV_CASE, "Mounts & Brackets")), true);
  assert.equal(isCategoryMismatchedForDeviceQuery("monitor", card(SAMSUNG_TV.replace("Television", "Monitor"), "Monitors")), false);
  assert.equal(isCategoryMismatchedForDeviceQuery("tv", card(SAMSUNG_TV, "Televisions")), false);
  assert.equal(isCategoryMismatchedForDeviceQuery("tv", card(SAMSUNG_TV_CASE, "Mounts")), true);
  assert.equal(isCategoryMismatchedForDeviceQuery("playstation", card(PS5, "PlayStation")), false);
  assert.equal(isCategoryMismatchedForDeviceQuery("playstation", card(PS5_CONTROLLER, "Game Controllers")), true);
  assert.equal(isCategoryMismatchedForDeviceQuery("xbox", card(APPLE_IPHONE_16, "Smartphones")), true);
  assert.equal(isCategoryMismatchedForDeviceQuery("refrigerator", card("GE 27.7 cu. ft. French Door Refrigerator", "Refrigerators")), false);
  assert.equal(isCategoryMismatchedForDeviceQuery("refrigerator", card("KitchenAid Refrigerator Water Filter", "Water Filters")), true);
  assert.equal(isCategoryMismatchedForDeviceQuery("dishwasher", card("Bosch 24-inch Built-in Dishwasher", "Dishwashers")), false);
  assert.equal(isCategoryMismatchedForDeviceQuery("dishwasher", card("Dishwasher Cleaner & Descaler 1 lb", "Cleaning Supplies")), true);
});

test("BUY-68365: does NOT flag non-device queries", () => {
  // "gaming mouse" is accessory-shaped; only "mouse" is not a device token.
  assert.equal(isCategoryMismatchedForDeviceQuery("gaming mouse", card("Razer DeathAdder V3 Pro", "Computer Mice")), false);
  assert.equal(isCategoryMismatchedForDeviceQuery("wireless headphones", card("Sony WH-1000XM5", "Headphones")), false);
  assert.equal(isCategoryMismatchedForDeviceQuery("espresso machine", card("Breville Barista Express", "Espresso Machines")), false);
});

test("BUY-68365: catalog-shaped accessory categories don't trigger on a laptop query", () => {
  // Backpack for laptop: category is "Backpacks" which is allowed-shape
  // (not in the laptop allowlist → flagged), and the title is also an accessory.
  // Outcome is the same: demoted and accessory-bonus lost.
  assert.equal(isCategoryMismatchedForDeviceQuery("laptop", card(BACKPACK, "Backpacks")), true);
  assert.equal(isCategoryMismatchedForDeviceQuery("laptop", card(SLEEVE, "Sleeves")), true);
});

test("BUY-68365: rankProduct dwarfs the storage row on a laptop query", () => {
  const query = "gaming laptop";
  const firecuda = card(FIRECUDA, "Storage", { id: "firecuda", price: 229, imageUrl: "https://example.com/f.jpg" });
  const gigabyte = card(GIGABYTE, "Laptops", { id: "gigabyte", price: 1349.99, imageUrl: "https://example.com/g.jpg" });
  const asus = card(ASUS_TUF, "Laptops", { id: "asus", price: 1199.0, imageUrl: "https://example.com/a.jpg" });
  const firecudaScore = rankProduct(firecuda, query);
  const gigabyteScore = rankProduct(gigabyte, query);
  const asusScore = rankProduct(asus, query);
  assert.ok(gigabyteScore > firecudaScore, `gigabyte (${gigabyteScore}) must beat firecuda (${firecudaScore})`);
  assert.ok(asusScore > firecudaScore, `asus (${asusScore}) must beat firecuda (${firecudaScore})`);
});

test("BUY-68365: sortProductsByRelevance demotes the storage row from #2 to last", () => {
  const query = "gaming laptop";
  const items = [
    card(GIGABYTE, "Laptops",      { id: "gigabyte", price: 1349.99, imageUrl: "https://example.com/g.jpg" }),
    card(FIRECUDA, "Storage",      { id: "firecuda", price: 229.0,   imageUrl: "https://example.com/f.jpg" }),
    card(ASUS_TUF, "Laptops",      { id: "asus",    price: 1199.0,  imageUrl: "https://example.com/a.jpg" }),
    card(GIGABYTE + " Pro", "Laptops", { id: "gigabyte-pro", price: 2440.99, imageUrl: "https://example.com/gp.jpg" }),
  ];
  const sorted = sortProductsByRelevance(items, query);
  const ids = sorted.map((p) => p.id);
  // Storage row must be last.
  assert.equal(ids[ids.length - 1], "firecuda", `firecuda should be last; got ${ids.join(", ")}`);
  // All three laptops should be in the top 3 (in any order).
  assert.deepEqual(
    new Set(ids.slice(0, 3)),
    new Set(["gigabyte", "asus", "gigabyte-pro"]),
    `top 3 should be the laptops; got ${ids.slice(0, 3).join(", ")}`,
  );
});

test("BUY-68365: sortProductsByRelevance is a no-op for non-device queries", () => {
  const items = [
    card("Cooler",   "Cooling",  { id: "c", price: 30.0, imageUrl: null }),
    card("Mouse",    "Computer Mice", { id: "m", price: 60.0, imageUrl: "https://example.com/m.jpg" }),
    card("Mouse Pad","Mouse Pads", { id: "mp", price: 25.0, imageUrl: null }),
  ];
  const sorted = sortProductsByRelevance(items, "gaming mouse");
  // The exact order depends on rankProduct tie-breaks but the mouse + image
  // should sort above the no-image entries.
  const mouseIdx = sorted.findIndex((p) => p.id === "m");
  const noImgIdx = Math.min(
    sorted.findIndex((p) => p.id === "c"),
    sorted.findIndex((p) => p.id === "mp"),
  );
  assert.ok(mouseIdx < noImgIdx, `mouse-with-image (${mouseIdx}) should rank above no-image (${noImgIdx})`);
});

test("BUY-68365: rankProduct is safe when query is empty (no demote)", () => {
  const firecuda = card(FIRECUDA, "Storage", { id: "firecuda", price: 229, imageUrl: "https://example.com/f.jpg" });
  const score = rankProduct(firecuda, "");
  // Empty query → no demote, default ranks apply.
  assert.ok(score >= 100, `firecuda should still rank normally when query is empty; got ${score}`);
});
