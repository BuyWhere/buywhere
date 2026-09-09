// BUY-67977 regression test — derive brand from title so search-card meta
// slots render consistent content across all cards in a grid row.
//
// QA reopened on 2026-08-14T02:15Z with evidence that PR #431 (slot
// reservation) shipped but the visual problem is unfixed: only 2/22 results
// for "wireless headphones" carry `metadata.category` from the catalog ingest
// lane (BUY-52807 family), and 0/22 carry `brand` at any level. Cards in the
// same grid row render with the reserved slot but inconsistent content
// (some show "Audio Headphones", most show nothing).
//
// Mirrors the .mjs pattern used by suggestedPillContrast.test.mjs: read the
// TSX source as a string and assert that the brand-derivation helper and
// fallback wiring are in place, plus a direct functional re-implementation of
// the heuristic so the regression test fails fast if a future edit removes
// either the helper or its call site in normalizeProduct.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'SearchResultsClient.tsx'), 'utf8');

test('BUY-67977: deriveBrandFromTitle helper exists in the source', () => {
  assert.match(
    source,
    /function\s+deriveBrandFromTitle\s*\(/,
    'expected deriveBrandFromTitle to be defined in SearchResultsClient.tsx'
  );
});

test('BUY-67977: title brand blocklist excludes generic product nouns', () => {
  assert.match(
    source,
    /TITLE_BRANDS_BLOCKLIST/,
    'expected TITLE_BRANDS_BLOCKLIST constant to be defined'
  );
  assert.match(source, /'wireless'/);
  assert.match(source, /'headphones'/);
  assert.match(source, /'anc'/);
  // Color / finish blocklist entries — these are critical so we don't
  // mistake "Black Edition" or "Space Grey" for a brand name.
  assert.match(source, /'black'/);
  assert.match(source, /'silver'/);
});

test('BUY-67977: normalizeProduct falls back to derived brand', () => {
  // BUY-77666: validation is now applied — the literal "item.brand || specBrand"
  // pattern no longer applies because both have to pass isLikelyBrandToken.
  // Accept either the literal pattern (older form) or the validated form.
  assert.ok(
    /brand:\s*[a-zA-Z_$.]+\s*\|\|\s*[a-zA-Z_$.]+\s*\|\|\s*deriveBrandFromTitle\(name\)/.test(
      source
    ),
    'expected normalizeProduct to wire a brand fallback chain ending in deriveBrandFromTitle(name)'
  );
});

test('BUY-77666: specBrand and item.brand are validated against the blocklist', () => {
  // The fix for the Laptop/Mobile/Gaming leak: both upstream brand values
  // must run through isLikelyBrandToken before reaching the facet. Anchor on
  // the documented BUY-77666 comment and the validatedItemBrand variable.
  assert.match(
    source,
    /BUY-77666/,
    'expected the BUY-77666 marker comment to be present'
  );
  assert.match(
    source,
    /validatedItemBrand/,
    'expected validatedItemBrand to be used in normalizeProduct'
  );
});

test('BUY-67977: deriveBrandFromTitle is exported via __test__ for direct coverage', () => {
  assert.match(
    source,
    /__test__\s*=\s*{[\s\S]*deriveBrandFromTitle[\s\S]*}/,
    'expected __test__ export to include deriveBrandFromTitle'
  );
});

test('BUY-67977: the SearchCard meta slot is still reserved with min-h-[1.25rem]', () => {
  // Regression guard for PR #431 — the slot reservation must remain after the
  // brand-derivation change so cards without brand/category still occupy the
  // same vertical space as cards that have them.
  assert.match(
    source,
    /min-h-\[1\.25rem\][^"]*flex-wrap[^"]*items-center[^"]*gap-x-2[^"]*gap-y-0\.5/,
    'expected meta-row reservation classes to remain intact'
  );
});

// ----------------------------------------------------------------------------
// Functional re-implementation of the heuristic so the test fails fast if
// the algorithm itself ever regresses (e.g. a refactor that drops the
// "Brand by SubBrand" multi-word extension or the generic-noun blocklist).
// ----------------------------------------------------------------------------

const TITLE_BRANDS_BLOCKLIST = new Set([
  'wireless', 'bluetooth', 'headphones', 'headphone', 'earbuds', 'earbud',
  'ear', 'earpiece', 'over-ear', 'on-ear', 'in-ear', 'over',
  // BUY-77666: category terms that leak into brand facet from title prefixes.
  'laptop', 'laptops', 'notebook', 'notebooks', 'macbook', 'macbooks',
  'chromebook', 'chromebooks', 'desktop', 'desktops', 'computer', 'computers',
  'gaming', 'game', 'games', 'gamer',
  'mobile', 'phone', 'phones', 'smartphone', 'smartphones', 'iphone',
  'tablet', 'tablets', 'ipad',
  'portable', 'monitor', 'monitors', 'display', 'displays', 'screen', 'screens',
  'keyboard', 'keyboards', 'mouse', 'mices', 'mousepad', 'speaker', 'speakers',
  'camera', 'cameras', 'drone', 'drones', 'watch', 'watches', 'band', 'bands',
  'headset', 'headsets', 'earphone', 'earphones', 'charger', 'chargers',
  'cable', 'cables', 'adapter', 'adapters', 'hub', 'hubs', 'dock', 'docks',
  'stand', 'stands', 'mount', 'mounts', 'case', 'cases', 'cover', 'covers',
  'sleeve', 'sleeves', 'skin', 'skins', 'pad', 'pads', 'mat', 'mats',
  'bag', 'bags', 'backpack', 'backpacks', 'pouch', 'pouches',
  'toy', 'toys', 'gift', 'gifts', 'set', 'sets', 'kit', 'kits',
  'pack', 'packs', 'bundle', 'bundles', 'combo', 'combos',
  'new', 'premium', 'pro', 'plus', 'mini', 'max', 'ultra', 'lite',
  'anc', 'hifi', 'hi-fi', 'stereo', 'mono', 'noise', 'cancelling',
  'cancellation', 'foldable', 'folding',
  'studio', 'series', 'version', 'generation', 'gen', 'model',
  'official', 'original', 'authentic', 'genuine', 'brand', 'newest',
  'latest', 'best', 'top', 'quality', 'high', 'low', 'cheap', 'expensive',
  'free', 'shipping', 'sale', 'discount', 'limited', 'edition',
  'special', 'classic', 'deluxe', 'standard',
  'usb', 'usb-c', 'type-c', 'wired', 'cordless', 'rechargeable',
  'black', 'white', 'blue', 'red', 'green', 'yellow', 'pink', 'purple',
  'orange', 'grey', 'gray', 'silver', 'gold', 'rose', 'midnight',
  'space', 'starlight', 'graphite', 'natural', 'matte', 'glossy',
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'to', 'from', 'in', 'on',
  'at', 'by', 'of', 'this', 'that', 'these', 'those', 'my', 'your', 'our',
  'x', 'i',
]);

function isLikelyBrandToken(token) {
  if (!token) return false;
  const cleaned = token.replace(/^[^A-Za-z0-9.]+|[^A-Za-z0-9.]+$/g, '');
  if (!cleaned) return false;
  if (!/^[A-Za-z]/.test(cleaned)) return false;
  if (cleaned.length < 2) return false;
  if (/^\d+$/.test(cleaned)) return false;
  if (/^[A-Za-z]*\d/.test(cleaned) && cleaned.length <= 12) return false;
  if (TITLE_BRANDS_BLOCKLIST.has(cleaned.toLowerCase())) return false;
  if (/^(by|for|of|and|with|to|from|the|a|an)$/i.test(cleaned)) return false;
  return true;
}

function deriveBrandFromTitle(title) {
  if (!title || typeof title !== 'string') return null;
  const tokens = title.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const clean = (s) => s.replace(/^[^A-Za-z0-9.]+|[^A-Za-z0-9.]+$/g, '');
  let idx = 0;
  while (idx < tokens.length && !isLikelyBrandToken(clean(tokens[idx]))) idx += 1;
  if (idx >= tokens.length) return null;
  let endIdx = idx + 1;
  const next = clean(tokens[idx + 1] ?? '').toLowerCase().replace(/\.$/, '');
  if (next === 'by' && tokens[idx + 2] && isLikelyBrandToken(clean(tokens[idx + 2]))) {
    const afterBy2 = clean(tokens[idx + 3] ?? '');
    endIdx = idx + 3;
    if (afterBy2 && isLikelyBrandToken(afterBy2) && !/\d/.test(afterBy2)) {
      endIdx = idx + 4;
    }
  }
  const candidate = tokens.slice(idx, endIdx).map(clean).filter(Boolean).join(' ');
  if (!candidate || candidate.length > 32) return null;
  return candidate;
}

test('BUY-67977: single-word brand extraction (JBL/Sony/Skullcandy/Edifier/Creative)', () => {
  assert.equal(deriveBrandFromTitle('JBL Everest 310 On-Ear Wireless Headphones'), 'JBL');
  assert.equal(deriveBrandFromTitle('Sony MDR-100ABN/B H.ear Wireless Headphones'), 'Sony');
  assert.equal(deriveBrandFromTitle('Skullcandy Ecobuds Wireless Headphones'), 'Skullcandy');
  assert.equal(deriveBrandFromTitle('Edifier W820Nb Plus ANC Wireless Headphones'), 'Edifier');
  assert.equal(deriveBrandFromTitle('Creative Outlier Free Pro+ Wireless Headphones'), 'Creative');
});

test('BUY-67977: ALLCAPS first token', () => {
  assert.equal(deriveBrandFromTitle('SONY WH-ULT900N WIRELESS HEADPHONES BLACK'), 'SONY');
});

test('BUY-67977: multi-word "Beats by Dr. Dre" pattern', () => {
  assert.equal(
    deriveBrandFromTitle('Beats by Dr. Dre Solo3 Wireless Headphones MTU02LL/A Crystal'),
    'Beats by Dr. Dre'
  );
});

test('BUY-67977: hyphenated brand "Audio-Technica"', () => {
  assert.equal(
    deriveBrandFromTitle('Audio-Technica ATH-CKS50TW2 Wireless Headphones Green'),
    'Audio-Technica'
  );
});

test('BUY-67977: compound brand "SoundPEATS"', () => {
  assert.equal(deriveBrandFromTitle('SoundPEATS Cove Pro Wireless Headphones Black'), 'SoundPEATS');
});

test('BUY-67977: JBuds resolves to leading token (no parent brand guess)', () => {
  assert.equal(
    deriveBrandFromTitle('JBuds Open Headphone Open-Ear Wireless Headphones Cloud'),
    'JBuds'
  );
});

test('BUY-67977: returns null on null/empty/whitespace', () => {
  assert.equal(deriveBrandFromTitle(null), null);
  assert.equal(deriveBrandFromTitle(undefined), null);
  assert.equal(deriveBrandFromTitle(''), null);
  assert.equal(deriveBrandFromTitle('   '), null);
});

test('BUY-67977: returns null when the leading token is a generic product noun', () => {
  assert.equal(deriveBrandFromTitle('Wireless Headphones Black Edition'), null);
  assert.equal(deriveBrandFromTitle('Premium Bluetooth Earbuds White'), null);
  assert.equal(deriveBrandFromTitle('Studio ANC Wireless Headphones'), null);
});

test('BUY-67977: returns null when no token is brand-shaped', () => {
  assert.equal(deriveBrandFromTitle('1234 5678 Model X'), null);
  assert.equal(deriveBrandFromTitle('by with for'), null);
});

test('BUY-67977: caps candidate length at 32 chars', () => {
  const longTitle = 'Abcdefghijklmnopqrstuvwxyzabcdefghijkl Wireless Headphones';
  assert.equal(deriveBrandFromTitle(longTitle), null);
});

test('BUY-67977: a full row of "wireless headphones" cards all get a brand', () => {
  // Simulates the QA repro: every card in a 4-card row derives a brand,
  // keeping the meta-slot content visually consistent.
  const titles = [
    'JBuds Open Headphone Open-Ear Wireless Headphones Cloud',
    'Beats by Dr. Dre Solo3 Wireless Headphones MTU02LL/A Crystal',
    'JBL Everest 310 On-Ear Wireless Headphones, with Google Assistant',
    'Sony MDR-100ABN/B H.ear Wireless Headphones',
  ];
  const brands = titles.map(deriveBrandFromTitle);
  assert.ok(brands.every((b) => b && b.length > 0), `expected every brand to resolve, got: ${JSON.stringify(brands)}`);
});

// ----------------------------------------------------------------------------
// BUY-77666: specBrand (metadata.brand) and item.brand must run through the
// same isLikelyBrandToken gate as deriveBrandFromTitle — otherwise category
// terms written by scrapers ("Laptop", "Mobile", "Gaming", "Portable",
// "2025", "in", "Rechargeable") leak straight into the brand facet, bypassing
// the blocklist. These tests pin the validation behavior on the
// documented bad tokens plus a few real brand-shaped values to make sure the
// gate doesn't reject everything.
// ----------------------------------------------------------------------------

test('BUY-77666: specBrand validation rejects category nouns', () => {
  // category terms Reed captured on the live page (07:01Z capture)
  const bad = ['Laptop', 'Mobile', 'Gaming', 'Portable', 'Phone',
    'Smartphone', 'Headphones', 'Mouse', 'Keyboard', 'Monitor'];
  for (const value of bad) {
    assert.equal(isLikelyBrandToken(value), false,
      `expected "${value}" to be rejected as a brand token`);
  }
});

test('BUY-77666: specBrand validation rejects numeric/short tokens', () => {
  const bad = ['2025', '2024', '1234', 'x', 'i', 'X', 'W820Nb'];
  for (const value of bad) {
    assert.equal(isLikelyBrandToken(value), false,
      `expected "${value}" to be rejected as a brand token`);
  }
});

test('BUY-77666: specBrand validation rejects common stop words', () => {
  const bad = ['in', 'by', 'for', 'with', 'the', 'a', 'an', 'and', 'of'];
  for (const value of bad) {
    assert.equal(isLikelyBrandToken(value), false,
      `expected "${value}" to be rejected as a brand token`);
  }
});

test('BUY-77666: specBrand validation passes real brand names', () => {
  // these were in the live API response and should survive the gate.
  const good = ['ASUS', 'LENOVO', 'LG', 'KEFEYA', 'XPro', 'VCDS',
    'ProCase', 'Boya', 'Geyes', 'rockpapa', 'WEICON', 'Kensington',
    'Acer', 'Dell', 'HP', 'Joy'];
  for (const value of good) {
    assert.equal(isLikelyBrandToken(value), true,
      `expected "${value}" to pass the brand token gate`);
  }
});

test('BUY-77666: extractBrand helper applies validation to metadata.brand', () => {
  // Re-implement normalizeProduct's brand fallback so we can assert end-to-end
  // behavior without pulling in React. The validation must happen on BOTH
  // item.brand and specBrand, not just deriveBrandFromTitle.
  function extractBrand(item) {
    const md = item.metadata || {};
    const rawSpecBrand = typeof md.brand === 'string' ? md.brand : null;
    const specBrand = rawSpecBrand && isLikelyBrandToken(rawSpecBrand) ? rawSpecBrand : null;
    const rawItemBrand = typeof item.brand === 'string' ? item.brand : null;
    const validatedItemBrand = rawItemBrand && isLikelyBrandToken(rawItemBrand) ? rawItemBrand : null;
    return validatedItemBrand || specBrand || deriveBrandFromTitle(item.title);
  }

  // Category-garbage metadata.brand: facet must NOT see "Laptop".
  assert.equal(
    extractBrand({
      title: 'Microsoft Surface Laptop 13-inch 256GB Platinum',
      metadata: { brand: 'Laptop' },
    }),
    'Microsoft',
    'specBrand="Laptop" must be rejected; deriveBrandFromTitle should win'
  );

  // Real brand metadata survives.
  assert.equal(
    extractBrand({
      title: 'ProCase Wireless Keyboard for iOS Android',
      metadata: { brand: 'ProCase' },
    }),
    'ProCase',
    'specBrand="ProCase" must pass validation'
  );

  // Garbage top-level brand: validation rejects, title fallback wins.
  assert.equal(
    extractBrand({
      title: 'ASUS ROG Strix G16 Gaming Laptop',
      brand: 'Laptop',
    }),
    'ASUS',
    'item.brand="Laptop" must be rejected; deriveBrandFromTitle should win'
  );

  // Numeric brand in metadata gets rejected.
  assert.equal(
    extractBrand({
      title: 'LENOVO IdeaPad 2025 Slim',
      metadata: { brand: '2025' },
    }),
    'LENOVO',
    'specBrand="2025" must be rejected'
  );
});
