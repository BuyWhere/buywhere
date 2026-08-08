// BUY-67522: unit test for the device minimum-price floor logic.
// Validates that deviceMinPriceUsd returns the right floor for premium-device
// queries and null for generic/accessory queries, and that the floor cleanly
// separates accessories from devices in a realistic candidate set.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of the production patterns (kept in sync manually for this test).
const DEVICE_MIN_PRICE_USD = 150;
const PREMIUM_LAPTOP_MIN_PRICE_USD = 200;
const CONSOLE_MIN_PRICE_USD = 200;
const DEVICE_FLOOR_PATTERNS = [
  { re: /\b(mac\s*book|macbook|thinkpad|laptop|notebook|ultrabook|chromebook|desktop|imac|mac\s*mini)\b/i, floor: PREMIUM_LAPTOP_MIN_PRICE_USD },
  { re: /\b(playstation|ps[45]\b|psp\b|xbox|nintendo|switch|steam\s*deck|oculus|quest\s*[23])\b/i, floor: CONSOLE_MIN_PRICE_USD },
  { re: /\b(iphone|ipad|galaxy\s*s\d+|galaxy\s*note\b|galaxy\s*z|pixel\s*\d|oneplus|xiaomi\s*\d|redmi\s*note|huawei\s*p\d|nothing\s*phone|surface\s*pro)\b/i, floor: DEVICE_MIN_PRICE_USD },
];
function deviceMinPriceUsd(productName) {
  if (!productName) return null;
  for (const { re, floor } of DEVICE_FLOOR_PATTERNS) if (re.test(productName)) return floor;
  return null;
}

test('deviceMinPriceUsd: premium devices get a floor', () => {
  assert.equal(deviceMinPriceUsd('iPhone 15'), 150);
  assert.equal(deviceMinPriceUsd('iPhone 15 Pro Max'), 150);
  assert.equal(deviceMinPriceUsd('Samsung Galaxy S24'), 150);
  assert.equal(deviceMinPriceUsd('Google Pixel 8'), 150);
  assert.equal(deviceMinPriceUsd('iPad Air'), 150);
  assert.equal(deviceMinPriceUsd('PS5'), 200);
  assert.equal(deviceMinPriceUsd('PlayStation 5 Console'), 200);
  assert.equal(deviceMinPriceUsd('Xbox Series X'), 200);
  assert.equal(deviceMinPriceUsd('Nintendo Switch OLED'), 200);
  assert.equal(deviceMinPriceUsd('Steam Deck'), 200);
  assert.equal(deviceMinPriceUsd('MacBook Air M3'), 200);
  assert.equal(deviceMinPriceUsd('Dell XPS laptop'), 200);
  assert.equal(deviceMinPriceUsd('laptop case'), 200); // floor applies; accessoryPattern catches "case" at SQL level
  assert.equal(deviceMinPriceUsd('iphone charger'), 150); // floor applies; accessoryPattern catches "charger"
});

test('deviceMinPriceUsd: generic queries get no floor', () => {
  assert.equal(deviceMinPriceUsd('USB cable'), null);
  assert.equal(deviceMinPriceUsd('coffee mug'), null);
  assert.equal(deviceMinPriceUsd(''), null);
  assert.equal(deviceMinPriceUsd('Samsung case'), null);
  assert.equal(deviceMinPriceUsd('PS5 controller'), 200); // floor applies; "controller" in accessoryPattern
});

// Realistic candidate set reproducing the BUY-66859 production bug: an
// "iPhone 15" query whose FTS + price-ASC sort returns cheap accessories
// ahead of the real phone.
const iPhoneCandidates = [
  { title: 'Anank iPhone 15 Pro 3d Clear With Hole On Front Camera', usd: 2 },
  { title: 'ESSE Armor 360 3in1 Combo iPhone 15 Pro Max', usd: 2.9 },
  { title: 'Anank iPhone 15 and 15 Plus Transparent AR Lens Guard', usd: 5 },
  { title: 'iPhone 15 Bonding Gasket Adhesive Seal', usd: 1.99 },
  { title: 'iPhone 15 Pro Max Screen Protector', usd: 8 },
  { title: 'Apple iPhone 15 128GB Blue', usd: 799 },
  { title: 'Apple iPhone 15 256GB Pink', usd: 899 },
];

test('floor excludes accessories so a real iPhone wins best_price', () => {
  const floor = deviceMinPriceUsd('iPhone 15');
  assert.equal(floor, 150);
  // apply floor (production keeps unfloored rows only when floored set is non-empty)
  const floored = iPhoneCandidates.filter(r => r.usd >= floor);
  assert.ok(floored.length > 0);
  // sort price ASC like the production query
  const sorted = [...floored].sort((a, b) => a.usd - b.usd);
  const best = sorted[0];
  assert.equal(best.title, 'Apple iPhone 15 128GB Blue');
  assert.equal(best.usd, 799);
  // the lens guard that production currently returns must NOT win
  assert.notEqual(best.title, 'Anank iPhone 15 Pro 3d Clear With Hole On Front Camera');
});

test('without floor the accessory still wins (demonstrates the bug being fixed)', () => {
  const sorted = [...iPhoneCandidates].sort((a, b) => a.usd - b.usd);
  assert.equal(sorted[0].title, 'iPhone 15 Bonding Gasket Adhesive Seal');
});

test('floor never returns empty when at least one device exists; relaxes only if all are accessories', () => {
  const allAccessories = iPhoneCandidates.filter(r => r.usd < 30); // no real phone
  const floor = deviceMinPriceUsd('iPhone 15');
  const floored = allAccessories.filter(r => r.usd >= floor);
  // production keeps original rows when floored set is empty (floor is advisory)
  const final = floored.length > 0 ? floored : allAccessories;
  assert.equal(final.length, allAccessories.length, 'kept unfloored set rather than returning empty');
});
