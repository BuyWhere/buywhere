// Regression test for BUY-65559.
//
// QA found the "Gigabyte Gaming A16 GA63TH RTX 5050" laptop listed at $1.00 on
// https://buywhere.ai/search?q=gaming+laptop. The catalog row carried
// `price.amount = 1` — a sentinel the Google Shopping scraper writes when it
// cannot parse the merchant's product page — and the search card rendered it
// as an ordinary currency string because the only guard was `price === null`.
//
// isPlausiblePrice must:
//   - reject zero / negative / non-finite / absurd amounts outright
//   - reject sub-$50 amounts for high-value goods (laptops, phones, TVs …)
//   - KEEP legitimately cheap accessories, even when their title mentions a
//     high-value keyword ("Laptop Cooling Pad", "laptop stand")
//   - KEEP ordinary cheap goods that never trip the high-value pattern
//
// and normalizeProduct must route every rejected price to `null` so the card
// falls back to the existing "Price unavailable" copy rather than inventing a
// number. A missing price is honest; a wrong price is not.
import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./SearchResultsClient";

const { isPlausiblePrice, formatPrice, normalizeProduct, HIGH_VALUE_MIN_PRICE } = __test__;

const GIGABYTE = "Gigabyte Gaming A16 GA63TH RTX 5050 Laptop AMD Ryzen 7 260 16GB DDR5 16 Inch 165Hz IPS WUXGA Gaming Laptop";

function p(name: string, category: string | null = null) {
  return { name, category };
}

test("BUY-65559: the exact reported row is rejected", () => {
  // price.amount = 1, the sentinel on catalog row 871873063695734596.
  assert.equal(isPlausiblePrice(1, p(GIGABYTE)), false);
});

test("rejects zero, negative, non-finite and absurd amounts", () => {
  for (const bad of [0, -1, -999.99, Number.NaN, Number.POSITIVE_INFINITY, null]) {
    assert.equal(isPlausiblePrice(bad as number | null, p("Anything at all")), false, `expected ${bad} to be rejected`);
  }
  assert.equal(isPlausiblePrice(10_000_001, p("Anything at all")), false);
});

test("rejects sub-floor prices for high-value goods", () => {
  const cases: Array<[string, number]> = [
    [GIGABYTE, 1],
    ["ASUS TUF Gaming F16 Laptop Intel Core i7", 5],
    ["Apple MacBook Pro 16-inch M4", 12.5],
    ["Apple iPhone 16 Pro Max 512GB", 3],
    ['Samsung 65" QLED Television', 20],
    ["Sony PlayStation 5 Pro Console", 49.99],
  ];
  for (const [name, price] of cases) {
    assert.equal(isPlausiblePrice(price, p(name)), false, `expected "${name}" at ${price} to be rejected`);
  }
});

test("keeps high-value goods at or above the floor", () => {
  assert.equal(isPlausiblePrice(HIGH_VALUE_MIN_PRICE, p(GIGABYTE)), true);
  assert.equal(isPlausiblePrice(1349.99, p(GIGABYTE)), true);
  assert.equal(isPlausiblePrice(3509.64, p("ASUS ROG Strix G16 (2025) Gaming Laptop")), true);
});

test("keeps cheap accessories that mention a high-value keyword", () => {
  // These are real rows from q=gaming+laptop. The floor must not hide them:
  // an accessory legitimately costs a fraction of the product it serves.
  const cases: Array<[string, number]> = [
    ["Laptop Cooling Pad, Laptop Cooler with 6 Quiet Led Fans", 38.05],
    ["Elestoria 10-Slot Vertical Laptop Stand & Holder", 45.0],
    ["Laptop Sleeve Case Cover 15.6 inch", 12.99],
    ["Gaming Laptop Backpack Travel Bag", 29.99],
    ["Robotic Doodle Laptop Skin Decal", 8.5],
  ];
  for (const [name, price] of cases) {
    assert.equal(isPlausiblePrice(price, p(name)), true, `expected accessory "${name}" at ${price} to be kept`);
  }
});

test("keeps ordinary cheap goods that are not high-value products", () => {
  // Real sub-$10 rows sampled from live search; a flat threshold would hide these.
  const cases: Array<[string, number]> = [
    ["Leather Keychain Keyring", 5.5],
    ["USB-C to USB-A Cable 3ft", 8.99],
    ["Vinyl Sticker Pack", 9.5],
    ["Screen Protector Tempered Glass", 9.99],
  ];
  for (const [name, price] of cases) {
    assert.equal(isPlausiblePrice(price, p(name)), true, `expected "${name}" at ${price} to be kept`);
  }
});

test("keeps 'false friend' titles that only borrow a high-value keyword", () => {
  // Every one of these is a real live catalog row that an earlier revision of
  // this guard wrongly rejected. "Pop Television" is Funko's collectible line,
  // not a TV; a keyboard is not a laptop; a protector is not an iPhone.
  const cases: Array<[string, number]> = [
    ["Pop Television Wednesday 3.75 Inch Action Figure - Wednesday Addams #1811", 9.99],
    ["Pop Television The Last of Us 3.75 Inch Action Figure - Ellie #1844", 11.99],
    ["Pop Television Invincible 3.75 Inch Action Figure Exclusive - Rex Splode", 34.99],
    ["NEWMEN GM325Pro Mechanical Keyboard, 104 Keys Rainbow LED Backlit Wired Gaming Laptop", 47.7],
    ["Impact Glass - Apple iPhone 16 Pro Screen Protector with Camera Protector", 39.99],
    ["Tempered Glass Screen Protectors - iPhone", 19.99],
  ];
  for (const [name, price] of cases) {
    assert.equal(isPlausiblePrice(price, p(name)), true, `expected "${name}" at ${price} to be kept`);
  }
});

test("rejects prices below the universal sentinel floor", () => {
  for (const bad of [0.01, 0.5, 1, 2.99]) {
    assert.equal(isPlausiblePrice(bad, p("Ordinary Widget")), false, `expected ${bad} to be rejected`);
  }
  // …but keeps the cheapest genuine rows observed live.
  assert.equal(isPlausiblePrice(5.5, p("Leather Keychain Keyring")), true);
  assert.equal(isPlausiblePrice(6.99, p("Pop Television Beavis and Butt-Head Action Figure")), true);
});

test("normalizeProduct nulls a sentinel price so the card says Price unavailable", () => {
  const product = normalizeProduct(
    { id: "871873063695734596", title: GIGABYTE, price: { amount: 1, currency: "USD" }, merchant: "google_shopping" },
    "USD",
  );
  assert.equal(product.price, null);
  assert.equal(formatPrice(product.price, product.currency), "Price unavailable");
});

test("normalizeProduct preserves a healthy price end to end", () => {
  const product = normalizeProduct(
    {
      id: "54452825",
      title: "GIGABYTE GAMING A16 Gaming Laptop - RTX 5060 - AMD Ryzen 7 260",
      price: { amount: 1349.99, currency: "USD" },
      merchant: "newegg_us",
    },
    "USD",
  );
  assert.equal(product.price, 1349.99);
  assert.equal(formatPrice(product.price, product.currency), "$1,349.99");
});

test("formatPrice never emits NaN, a bare .00, or an empty string", () => {
  for (const bad of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
    const out = formatPrice(bad as number | null, "USD");
    assert.equal(out, "Price unavailable");
    assert.doesNotMatch(out, /NaN/);
  }
});

// Regression tests for BUY-71638 (re-applied after the silent scope-creep
// revert in 2d53dc31 / BUY-72387 — f369fdc9).
//
// QA repro: /search?q=laptop&country=US rendered mixed currencies (SGD,
// INR, TRY) under the US country filter. The fix is to ALWAYS honor the
// selected-country currency at display time, regardless of the API row's
// source-row currency. The numeric price value is not FX-converted (no
// rates table exists); only the displayed currency code tracks the country
// the user picked.
//
// A parallel runnable guard lives in
// SearchResultsClient.currencyDisplay.test.mjs that runs under `node --test`
// in CI (the .ts file is documentation-only — Node 22 cannot resolve the
// `from "./SearchResultsClient"` extensionless import without a TS loader).
test("normalizeProduct always stores the selected-country currency (US filter)", () => {
  const product = normalizeProduct(
    {
      id: "54452825",
      title: "GIGABYTE GAMING A16 Gaming Laptop - RTX 5060 - AMD Ryzen 7 260",
      price: { amount: 1349.99, currency: "SGD" }, // API row carries SGD
      merchant: "newegg_us",
    },
    "USD", // user picked United States
  );
  assert.equal(product.price, 1349.99);
  assert.equal(product.currency, "USD", "expected normalizeProduct to override API currency with selected-country currency");
  assert.equal(formatPrice(product.price, product.currency), "$1,349.99");
});

test("normalizeProduct honors selected-country currency for INR/TRY rows too", () => {
  // The exact QA-reported cases: an INR row and a TRY row under the US filter.
  for (const apiCurrency of ["INR", "TRY"]) {
    const product = normalizeProduct(
      {
        id: "1",
        title: `Cross-border ${apiCurrency} listing that should not leak through`,
        price: { amount: 7499, currency: apiCurrency },
        merchant: "google_shopping",
      },
      "USD",
    );
    assert.equal(
      product.currency,
      "USD",
      `expected ${apiCurrency} API row under US filter to display in USD`,
    );
  }
});

test("normalizeProduct falls back to selected-country currency when API omits one", () => {
  const product = normalizeProduct(
    {
      id: "1",
      title: "Laptop without price currency in API response",
      price: { amount: 1299 }, // no currency on the row
      merchant: "best_buy_us",
    },
    "SGD",
  );
  assert.equal(product.currency, "SGD");
  assert.equal(formatPrice(product.price, product.currency), "SGD 1,299.00");
});
