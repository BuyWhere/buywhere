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
  isAccessoryProduct,
  isCategoryMismatchedForDeviceQuery,
  rankProduct,
  sortProductsByRelevance,
} = __test__;

interface SearchCardProduct {
  id: string;
  name: string;
  category: string | null;
  categoryPath?: string[] | null;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  brand: string | null;
  merchant: string;
  url: string;
  href: string;
}

function card(name: string, category: string | null, opts: Partial<SearchCardProduct> = {}): SearchCardProduct {
  return {
    id: opts.id ?? Math.random().toString(36).slice(2),
    name,
    category,
    categoryPath: opts.categoryPath ?? null,
    price: opts.price ?? 1499.99,
    currency: opts.currency ?? "USD",
    imageUrl: opts.imageUrl ?? "https://example.com/img.jpg",
    brand: opts.brand ?? null,
    merchant: opts.merchant ?? "",
    url: opts.url ?? "https://example.com/p",
    href: opts.href ?? opts.url ?? "https://example.com/p",
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
  // BUY-77675: switched query and product titles away from "mouse" and
  // "cooler" because both are now in ACCESSORY_KEYWORDS and would falsely
  // demote the products. The pre-existing test's intent — that relevance
  // ranking applies normally on a non-device query — is preserved by using
  // "espresso machine" + non-accessory espresso products.
  const items = [
    card("Espresso Machine Compact",   "Espresso Machines",  { id: "e1", price: 30.0, imageUrl: null }),
    card("Espresso Machine Pro Barista","Espresso Machines", { id: "e2", price: 60.0, imageUrl: "https://example.com/e2.jpg" }),
    card("Espresso Machine Mini",       "Espresso Machines", { id: "e3", price: 25.0, imageUrl: null }),
  ];
  // Reaffirm the no-image rows truly have imageUrl=null so rankProduct's
  // "+100 for has image" bonus doesn't apply (the test card() defaults
  // imageUrl to a placeholder when opts.imageUrl is omitted).
  for (const it of items) {
    if (it.id === "e1" || it.id === "e3") {
      it.imageUrl = null;
    } else {
      assert.ok(it.imageUrl !== null, `with-image row ${it.id} should still have an imageUrl`);
    }
  }
  const sorted = sortProductsByRelevance(items, "espresso machine");
  // The exact order depends on rankProduct tie-breaks but the espresso with image
  // must sort strictly above BOTH no-image entries.
  const withImgIdx = sorted.findIndex((p) => p.id === "e2");
  const noImgIdxs = sorted
    .map((p, i) => (p.id === "e2" ? -1 : i))
    .filter((i) => i >= 0);
  const minNoImgIdx = Math.min(...noImgIdxs);
  assert.ok(withImgIdx < minNoImgIdx, `espresso-with-image (${withImgIdx}) should rank above no-image entries (lowest at ${minNoImgIdx})`);
});

test("BUY-68365: rankProduct is safe when query is empty (no demote)", () => {
  const firecuda = card(FIRECUDA, "Storage", { id: "firecuda", price: 229, imageUrl: "https://example.com/f.jpg" });
  const score = rankProduct(firecuda, "");
  // Empty query → no demote, default ranks apply.
  assert.ok(score >= 100, `firecuda should still rank normally when query is empty; got ${score}`);
});

// =============================================================================
// BUY-77675: SG laptop search returned 72% non-laptops on the 06:15Z VidMee
// capture (microphones / IEMs / laptop desks / portable monitors / privacy
// screens / keyboards / screen cleaners). The accessory keyword list and the
// category-path check must catch all 7 leak classes — and must NOT demote a
// real laptop whose title contains nothing accessory-shaped.
// =============================================================================

const LAPTOP_TITLES = {
  razerBlade13: "Razer RZ09-03272E82-R341 Blade Stealth 13 Ultrabook Laptop OLED Full HD Touch",
  thinkBook14: "Lenovo ThinkBook Laptop 14 G7 U7 /8GB/512GB SSD 21MR008SSB",
  thinkPadE14: "Lenovo ThinkPad Laptop E14 G5 i5-1340P/8GB+8GB/512GB SSD 21JKS00C00",
  dellLatitude: "Dell Latitude 14 5000 5430 Laptop Intel i5-1235U 16GB 512GB SSD",
  asusVivobook: "ASUS Vivobook 15 Laptop Intel Core i3 8GB 256GB SSD",
  macbookAir: "Apple MacBook Air A1466 13 inch Intel Core i5 1.6GHz 8GB 128GB",
  hp14Student: "HP 14 Student-Laptop Intel Celeron N4120 4GB 128GB eMMC",
};

const ACCESSORY_TITLES = {
  boyaMic: "Boya BY-M1V Wireless Lavalier Microphone for Laptop Recording",
  boyaMic2: "Boya BY-M1 Pro Lavalier Microphone for iPhone Laptop DSLR",
  iem: "KZ ZSN Pro X IEM In-Ear Monitors for Laptop Mobile",
  overEar: "Sony WH-1000XM5 Wireless Noise Canceling Headphones for Laptop Office",
  standingDesk: "FlexiSpot EC1 Standing Desk Electric Height Adjustable for Home Office Laptop",
  laptopDesk: "SAYGEER Laptop Bed Desk for Bed Sofa Portable Lap Desk",
  portableMonitor: "Arzopa 15.6 inch Portable Monitor 1080P FHD USB C Second Screen for Laptop",
  privacyScreen: "Kensington MP13 Laptop Privacy Screen Filter 13.3 inch",
  privacyFilter: "3M Privacy Filter for 15.6 inch Laptop Display",
  keyboard: "Logitech K380 Multi-Device Bluetooth Keyboard for Laptop Phone Tablet",
  mechKeyboard: "Keychron K2 V2 Mechanical Keyboard Wireless for Mac Laptop PC",
  screenCleaner: "Endust for Electronics Screen Cleaner Spray 8 oz + Microfiber for Laptop",
  cleaningKit: "Screen Cleaning Kit 2-in-1 Microfiber Spray Bottle for Laptop Monitor Tablet",
};

test("BUY-77675: 7 leak accessory titles are flagged as accessories by isAccessoryProduct", () => {
  // Microphones (Boya / lavalier).
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.boyaMic, null)), true);
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.boyaMic2, null)), true);
  // IEMs / headphones.
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.iem, null)), true);
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.overEar, null)), true);
  // Desks / standing desks.
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.standingDesk, null)), true);
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.laptopDesk, null)), true);
  // Portable monitors.
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.portableMonitor, null)), true);
  // Privacy screens / filters.
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.privacyScreen, null)), true);
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.privacyFilter, null)), true);
  // Keyboards (no laptop token in title).
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.keyboard, null)), true);
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.mechKeyboard, null)), true);
  // Screen cleaners.
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.screenCleaner, null)), true);
  assert.equal(isAccessoryProduct(card(ACCESSORY_TITLES.cleaningKit, null)), true);
});

test("BUY-77675 follow-up: wireless mice + tempered-glass screen protectors are demoted", () => {
  // The post-deploy live API still leaked these two accessory classes:
  //   - "Rechargeable Bluetooth Mouse for Laptop iPad Pro iPad Air MacBook..."
  //   - "16 Inch Tempered Glass Screen Protector for HP 16\" Laptop..."
  // Both contain the word "laptop" (so they survive the laptop-title boost)
  // but neither is a laptop. The accessory keyword list catches both.
  assert.equal(
    isAccessoryProduct(card("Rechargeable Bluetooth Mouse for Laptop iPad Pro iPad Air MacBook Pro MacBook Air Wireless Mouse", null)),
    true,
  );
  assert.equal(
    isAccessoryProduct(card('16 Inch Tempered Glass Screen Protector for HP 16" Laptop, HP Envy 16', null)),
    true,
  );
  // Real mouse-shaped brand names shouldn't false-match — but for laptops
  // specifically, "Logitech MX Master 3S Wireless Mouse" is an accessory.
  assert.equal(
    isAccessoryProduct(card("Logitech MX Master 3S Wireless Bluetooth Mouse for Laptop MacBook PC", null)),
    true,
  );
});

test("BUY-77675 second follow-up: power banks, holders, and risers are demoted", () => {
  // SG laptop top-20 after the first deploy still had 4 power banks, 2 holders,
  // 1 riser that escaped the keyword list. Each is accessory-shaped but not
  // a laptop itself.
  assert.equal(
    isAccessoryProduct(card("Cygnett CY5128PBCHE VertPWR 25K Laptop Power Bank (Champagne)", null)),
    true,
  );
  assert.equal(
    isAccessoryProduct(card("Belkin BPB020btBK BoostCharge Pro 3-Port Laptop Power Bank 20K", null)),
    true,
  );
  assert.equal(
    isAccessoryProduct(card("DLab SPB30P 27000mAh PD 140W Laptop PowerBank", null)),
    true,
  );
  assert.equal(
    isAccessoryProduct(card("ORICO NSN-C1-GY Laptop Holder (Gray)", null)),
    true,
  );
  assert.equal(
    isAccessoryProduct(card("Fellowes F8032001 Laptop Riser", null)),
    true,
  );
});

test("BUY-77675 third follow-up: handbag/hangbag compound nouns are demoted", () => {
  // Word-bounded regex saw 'bag' alone (matched 'Handbag' as 'bag' substring)
  // but the boundary '\bbag\b' does NOT match inside 'Handbag' (no boundary
  // between 'D' and 'b'). Explicit 'handbag' / 'hangbag' entries are
  // needed to catch the actual catalog titles.
  assert.equal(
    isAccessoryProduct(card("tomtoc TheHerA21 Laptop Handbag - Gray 14inch", null)),
    true,
  );
  assert.equal(
    isAccessoryProduct(card("Tomtoc TheHer A21 Laptop Hangbag 14-inch (Blue)", null)),
    true,
  );
  assert.equal(
    isAccessoryProduct(card("tomtoc A21F2D1 TheHer A21 Laptop Handbag 16-inch (Grey)", null)),
    true,
  );
});

test("BUY-77675: real laptop titles are NOT flagged as accessories", () => {
  // Each of these is a real laptop title without any accessory keyword.
  assert.equal(isAccessoryProduct(card(LAPTOP_TITLES.razerBlade13, null)), false);
  assert.equal(isAccessoryProduct(card(LAPTOP_TITLES.thinkBook14, null)), false);
  assert.equal(isAccessoryProduct(card(LAPTOP_TITLES.thinkPadE14, null)), false);
  assert.equal(isAccessoryProduct(card(LAPTOP_TITLES.dellLatitude, null)), false);
  assert.equal(isAccessoryProduct(card(LAPTOP_TITLES.asusVivobook, null)), false);
  assert.equal(isAccessoryProduct(card(LAPTOP_TITLES.macbookAir, null)), false);
  assert.equal(isAccessoryProduct(card(LAPTOP_TITLES.hp14Student, null)), false);
});

test("BUY-77675: category-mismatch check fires via category_path when category column is null", () => {
  // The live SG laptop rows are returned with category=null but
  // category_path=["home-living"]. That path is clearly not a laptop-class
  // path → the product must be flagged so it gets demoted via rankProduct.
  const accessoryWithHomeLivingPath = card(ACCESSORY_TITLES.boyaMic, null, {
    categoryPath: ["home-living"],
  });
  assert.equal(
    isCategoryMismatchedForDeviceQuery("laptop", accessoryWithHomeLivingPath),
    true,
    "boya mic with category_path=[home-living] must be flagged for laptop query",
  );
});

test("BUY-77675: category-mismatch check passes when category_path signals a laptop class", () => {
  // SG laptop rows have category=null + category_path=["home-living"] in the
  // buggy state. A real laptop with category_path=["electronics","computers","laptops"]
  // must NOT be flagged — the path includes "laptops".
  const laptopWithLaptopPath = card(LAPTOP_TITLES.thinkBook14, null, {
    categoryPath: ["electronics", "computers", "laptops"],
  });
  assert.equal(
    isCategoryMismatchedForDeviceQuery("laptop", laptopWithLaptopPath),
    false,
    "laptop with category_path ending in laptops must NOT be flagged",
  );
});

test("BUY-77675: 7 leak classes never outrank a real laptop on rankProduct", () => {
  const query = "laptop";
  const laptop = card(LAPTOP_TITLES.thinkBook14, "Computers", {
    id: "laptop",
    price: 1499,
    imageUrl: "https://example.com/l.jpg",
  });
  const accessories = [
    card(ACCESSORY_TITLES.boyaMic, "Audio", { id: "mic", price: 89, imageUrl: "https://example.com/m.jpg" }),
    card(ACCESSORY_TITLES.iem, "Headphones", { id: "iem", price: 39, imageUrl: "https://example.com/i.jpg" }),
    card(ACCESSORY_TITLES.standingDesk, "Furniture", { id: "desk", price: 499, imageUrl: "https://example.com/d.jpg" }),
    card(ACCESSORY_TITLES.portableMonitor, "Monitors", { id: "monitor", price: 199, imageUrl: "https://example.com/m2.jpg" }),
    card(ACCESSORY_TITLES.privacyScreen, "Accessories", { id: "privacy", price: 39, imageUrl: "https://example.com/p.jpg" }),
    card(ACCESSORY_TITLES.keyboard, "Keyboards", { id: "kb", price: 49, imageUrl: "https://example.com/k.jpg" }),
    card(ACCESSORY_TITLES.screenCleaner, "Cleaning Supplies", { id: "cleaner", price: 12, imageUrl: "https://example.com/c.jpg" }),
  ];
  const laptopScore = rankProduct(laptop, query);
  for (const acc of accessories) {
    const accScore = rankProduct(acc, query);
    assert.ok(
      laptopScore > accScore,
      `laptop (${laptopScore}) must outrank ${acc.id} (${accScore}) for query="${query}"`,
    );
  }
});

test("BUY-77675: sortProductsByRelevance demotes all 7 leak classes below real laptops", () => {
  const query = "laptop";
  const items = [
    card(LAPTOP_TITLES.razerBlade13, "Laptops", { id: "laptop1", price: 2299, imageUrl: "https://example.com/l1.jpg" }),
    card(LAPTOP_TITLES.thinkBook14, "Laptops", { id: "laptop2", price: 1499, imageUrl: "https://example.com/l2.jpg" }),
    card(ACCESSORY_TITLES.boyaMic, "Audio", { id: "mic", price: 89, imageUrl: "https://example.com/m.jpg" }),
    card(ACCESSORY_TITLES.iem, "Headphones", { id: "iem", price: 39, imageUrl: "https://example.com/i.jpg" }),
    card(ACCESSORY_TITLES.standingDesk, "Furniture", { id: "desk", price: 499, imageUrl: "https://example.com/d.jpg" }),
    card(ACCESSORY_TITLES.portableMonitor, "Monitors", { id: "monitor", price: 199, imageUrl: "https://example.com/m2.jpg" }),
    card(ACCESSORY_TITLES.privacyScreen, "Accessories", { id: "privacy", price: 39, imageUrl: "https://example.com/p.jpg" }),
    card(ACCESSORY_TITLES.keyboard, "Keyboards", { id: "kb", price: 49, imageUrl: "https://example.com/k.jpg" }),
    card(ACCESSORY_TITLES.screenCleaner, "Cleaning Supplies", { id: "cleaner", price: 12, imageUrl: "https://example.com/c.jpg" }),
  ];
  const sorted = sortProductsByRelevance(items, query);
  const ids = sorted.map((p) => p.id);
  // Top 2 must be the laptops.
  assert.deepEqual(
    new Set(ids.slice(0, 2)),
    new Set(["laptop1", "laptop2"]),
    `top 2 must be the laptops; got ${ids.slice(0, 2).join(", ")}`,
  );
  // None of the 7 accessory ids may appear in the top 2.
  for (const accId of ["mic", "iem", "desk", "monitor", "privacy", "kb", "cleaner"]) {
    assert.ok(
      ids.indexOf(accId) >= 2,
      `${accId} must be ranked below laptops; got ${ids.indexOf(accId)} in ${ids.join(", ")}`,
    );
  }
});

test("BUY-77675: short stems like 'mic' don't false-match unrelated titles", () => {
  // Word boundary must anchor "mic" so it only matches the standalone token,
  // not substrings ("Mickey", "economic"). Existing accessory keywords like
  // "sticker" still apply where relevant.
  assert.equal(isAccessoryProduct(card("Microeconomics 101 Textbook", null)), false);
  assert.equal(isAccessoryProduct(card("Micro Machines Collectible Toy", null)), false);
  assert.equal(isAccessoryProduct(card("Mickey Mouse Clubhouse Toys Laptop Decal Sticker", null)), true);
});
