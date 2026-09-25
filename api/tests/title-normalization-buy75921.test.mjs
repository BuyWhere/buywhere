// BUY-75921 (2026-09-17 re-verification): title normalization v2 regression guard.
// Live QA evidence (buywhere.ai/search?q=laptop&country=SG, 2026-09-17T10:11Z) showed
// the v1 regexes left spec-stuffed marketplace titles ("HP Omnibook 5 AI Laptop,16\" 2K
// (1920 x 1200) ... Win 11") fully intact while clean titles passed through. Every case
// below is a real title shape observed on the live site or a close variant.
// EXPECTED OUTCOME on failure: file a board issue against BUY-75921.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { normalizeProductTitle } = require('../dist/lib/response');

const CASES = [
  // [raw marketplace title, expected normalized title]
  [
    'HP Omnibook 5 AI Laptop,16" 2K (1920 x 1200) Laptop PC,Next Gen AI PC AMD Ryzen AI 7 350(NPU 50 TOPS),16GB RAM,1TB SSD Laptops for Business, College, School, Photo Editing,Lifetime Office,Win 11',
    'HP Omnibook 5 AI',
  ],
  [
    'NIAKUN Laptop Computer, Win 11 Pro Lap Top, 15.6 Inch Laptop PC 2026, 16GB RAM 256GB SSD, M3',
    'NIAKUN Laptop',
  ],
  [
    'BYDTOOPCBD A8 PRO Wireless Earbuds with Deep Bass Clear Call, Bluetooth Ear Buds & in-Ear Headphones, IPX7 Waterproof Sport Workout Earphones Built-in Mic for Android iOS,Black',
    'BYDTOOPCBD A8 PRO Wireless Earbuds',
  ],
  [
    'Samsung Galaxy S24 Ultra 5G 12GB RAM 256GB Titanium Black',
    'Samsung Galaxy S24 Ultra 5G',
  ],
  [
    'Apple iPhone 17 Pro Max 256GB Natural Titanium',
    'Apple iPhone 17 Pro Max',
  ],
  [
    'Xiaomi Redmi Note 13 Pro 5G 8GB RAM 256GB ROM Ocean Teal',
    'Xiaomi Redmi Note 13 Pro 5G',
  ],
  [
    'Lenovo ThinkPad X1 Carbon Gen 12, 14" 2.8K OLED, Intel Core Ultra 7 155H, 32GB RAM, 1TB SSD, Windows 11 Pro',
    'Lenovo ThinkPad X1 Carbon Gen 12',
  ],
  [
    'ASUS ROG Strix G16 (2024) Gaming Laptop, 16" 16:10 FHD 165Hz, NVIDIA GeForce RTX 4060, Intel Core i7-13650HX, 16GB DDR5, 1TB PCIe SSD, Wi-Fi 6E, Windows 11, G614JV-AS74',
    'ASUS ROG Strix G16',
  ],
  [
    'Razer BlackWidow V4 Pro Mechanical Gaming Keyboard with Command Dial and Dedicated Macro Keys, Green Switches, RGB, US Layout',
    'Razer BlackWidow V4 Pro Mechanical Gaming Keyboard',
  ],
  [
    'Anker Soundcore Life Q30 Hybrid Active Noise Cancelling Headphones Bluetooth with Multiple Modes, Hi-Res Sound, 40H Playtime, Fast Charge, Black',
    'Anker Soundcore Life Q30 Hybrid Active Noise Cancelling Headphones Bluetooth',
  ],
  // Clean titles must pass through UNCHANGED (QA re-verification counts these as pass).
  ['MSI Cyborg15', 'MSI Cyborg15'],
  ['Hasee T8 Pro', 'Hasee T8 Pro'],
  ['Acer Predator Triton Neo 16', 'Acer Predator Triton Neo 16'],
  ['GIGABYTE GAMING A16', 'GIGABYTE GAMING A16'],
  ['Ningmei NL150 Laptop, 15.6 Inch Notebook', 'Ningmei NL150 Laptop, 15.6 Inch Notebook'],
  ['Sony WH-1000XM5 Wireless Noise Canceling Headphones, Black', 'Sony WH-1000XM5 Wireless Noise Canceling Headphones, Black'],
  ['Instant Pot Duo 7-in-1 Electric Pressure Cooker, 6 Quart, Stainless Steel', 'Instant Pot Duo 7-in-1 Electric Pressure Cooker, 6 Quart, Stainless Steel'],
  ['DJI Mini 4 Pro Drone with RC 2 Remote Controller', 'DJI Mini 4 Pro Drone'],
];

describe('BUY-75921 normalizeProductTitle v2', () => {
  for (const [raw, expected] of CASES) {
    it(`normalizes: ${raw.slice(0, 60)}…`, () => {
      const got = normalizeProductTitle({ title: raw });
      assert.equal(got, expected);
      assert.ok(got.length > 0, 'must never return empty');
      assert.ok(got.length <= raw.length, 'must never grow the title');
    });
  }

  it('handles empty/missing title', () => {
    assert.equal(normalizeProductTitle({ title: '' }), '');
    assert.equal(normalizeProductTitle({}), '');
  });
});
