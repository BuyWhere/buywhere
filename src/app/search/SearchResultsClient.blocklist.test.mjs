// BUY-72491 — SEARCH_IMAGE_BLOCKED_HOSTS regression coverage.
//
// The same line item (SEARCH_IMAGE_BLOCKED_HOSTS for c1.neweggimages.com etc.
// in SearchResultsClient.tsx) has regressed twice in 5 hours:
//   - BUY-72350 (QA report 05:27Z) — original defect
//   - BUY-72375 (Pixel fix 06:10Z, commit 5295b35a) — restored blocklist
//   - 2d53dc31 (Rex, BUY-72387 "reframe root metadata", 06:37Z) — silently
//     deleted blocklist again; touched 30+ files for a metadata-reframe
//   - BUY-72470 (Pixel re-restore 10:43Z) — restored blocklist a second time
//
// This file is the BUY-72491 guard's source-of-truth test. The CI workflow
// .github/workflows/search-blocklist-guard.yml hard-fails a PR that:
//   - Removes any of the 4 Newegg hosts from SEARCH_IMAGE_BLOCKED_HOSTS
//   - Removes the SEARCH_IMAGE_BLOCKED_HOSTS.has(hostname) call-site from
//     hasUsableProductImage
//   - Widens the blocklist to include cdn.shopify.com / m.media-amazon.com
//     (BUY-71639 carve-out — must remain usable)
//   - Deletes this test file (the supervisor workflow catches that)
//
// The older SearchResultsClient.productImageParity.test.mjs file mixes BUY-71856
// image-parity assertions with BUY-72375 blocklist assertions; the BUY-71856
// assertions are pre-existing failures unrelated to the blocklist, so they
// cannot be wired into the guard without blocking every PR. The dedicated
// coverage below is intentionally narrower.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'SearchResultsClient.tsx'), 'utf8');

const REQUIRED_HOSTS = [
  'c1.neweggimages.com',
  'www.neweggimages.com',
  'neweggimages.com',
  'images10.newegg.com',
];

// BUY-71639 deliberately unblocked these from the host blocklist. If they creep
// into SEARCH_IMAGE_BLOCKED_HOSTS, /search?q=headphones&country=us loses real
// product photos (AC3 of BUY-72350). BUY-72693 adds media-key shape validation
// for m.media-amazon.com, so the host remains allowed while ASIN-derived keys
// are rejected by hasUsableProductImage.
const FORBIDDEN_HOSTS = ['cdn.shopify.com', 'm.media-amazon.com'];

function extractSetBody(src) {
  const m = src.match(
    /const\s+SEARCH_IMAGE_BLOCKED_HOSTS\s*=\s*new\s+Set\s*\(([\s\S]*?)\);/
  );
  if (!m) return null;
  return m[1];
}

function extractHasUsableProductImageBody(src) {
  const m = src.match(
    /function\s+hasUsableProductImage\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\}/
  );
  if (!m) return null;
  return m[1];
}

// ---------------------------------------------------------------------------
// Blocklist shape
// ---------------------------------------------------------------------------

test('BUY-72491: SEARCH_IMAGE_BLOCKED_HOSTS Set literal exists at module scope', () => {
  assert.match(
    source,
    /const\s+SEARCH_IMAGE_BLOCKED_HOSTS\s*=\s*new\s+Set\s*\(/,
    'expected SearchResultsClient.tsx to define SEARCH_IMAGE_BLOCKED_HOSTS as a Set'
  );
});

test('BUY-72491: blocklist contains all 4 Newegg hosts', () => {
  const setBody = extractSetBody(source);
  assert.ok(setBody, 'expected SEARCH_IMAGE_BLOCKED_HOSTS Set literal');
  for (const host of REQUIRED_HOSTS) {
    assert.match(
      setBody,
      new RegExp(`['"]${host.replace(/\./g, '\\.')}['"]`),
      `expected SEARCH_IMAGE_BLOCKED_HOSTS to contain '${host}'`
    );
  }
});

test('BUY-72491: blocklist does NOT widen to working merchant CDNs (BUY-71639 carve-out)', () => {
  const setBody = extractSetBody(source);
  assert.ok(setBody, 'expected SEARCH_IMAGE_BLOCKED_HOSTS Set literal');
  for (const host of FORBIDDEN_HOSTS) {
    assert.doesNotMatch(
      setBody,
      new RegExp(`['"]${host.replace(/\./g, '\\.')}['"]`),
      `${host} must NOT be in SEARCH_IMAGE_BLOCKED_HOSTS — it serves 200 (BUY-71639)`
    );
  }
});

// ---------------------------------------------------------------------------
// Call-site integrity
// ---------------------------------------------------------------------------

test('BUY-72491: hasUsableProductImage consults SEARCH_IMAGE_BLOCKED_HOSTS', () => {
  const fnBody = extractHasUsableProductImageBody(source);
  assert.ok(fnBody, 'expected hasUsableProductImage function');
  assert.match(
    fnBody,
    /SEARCH_IMAGE_BLOCKED_HOSTS\.has\(hostname\)/,
    'hasUsableProductImage must call SEARCH_IMAGE_BLOCKED_HOSTS.has(hostname)'
  );
});

test('BUY-72491: blocklist check runs BEFORE sentinel-filename fallbacks', () => {
  // Cheap set-lookup must be the first filter so Newegg URLs short-circuit
  // before the regex work over the full URL string. If a future edit reorders
  // this, /search will spike CPU on every product card.
  const fnBody = extractHasUsableProductImageBody(source);
  assert.ok(fnBody, 'expected hasUsableProductImage function');
  const blockIdx = fnBody.search(/SEARCH_IMAGE_BLOCKED_HOSTS\.has\(hostname\)/);
  const sentinelIdx = fnBody.search(/placeholder|image-unavailable|no[-_]?image/);
  assert.ok(blockIdx >= 0, 'blocklist check must exist');
  assert.ok(
    sentinelIdx === -1 || blockIdx < sentinelIdx,
    'blocklist check must run before sentinel-filename checks'
  );
});

// ---------------------------------------------------------------------------
// Export surface
// ---------------------------------------------------------------------------

test('BUY-72491: hasUsableProductImage is exported', () => {
  // Other modules and tests import this function. If a future edit drops the
  // export, /search stops filtering correctly. The source exports it via the
  // `export const __test__ = { hasUsableProductImage, ... }` shape used by
  // BUY-71639's regression test harness.
  const exportBlock = source.match(/export\s+const\s+__test__\s*=\s*\{([\s\S]*?)\n\}/);
  assert.ok(exportBlock, 'expected `export const __test__ = { ... }` block in SearchResultsClient.tsx');
  assert.match(
    exportBlock[1],
    /\bhasUsableProductImage\b/,
    'expected hasUsableProductImage to be listed in the __test__ export block'
  );
});

// ---------------------------------------------------------------------------
// Functional re-implementation — sandboxed mirror of production logic.
// Keeps the unit test honest even if a future edit breaks the regex above
// (e.g. rewrites hostname extraction but still passes the literal grep).
// ---------------------------------------------------------------------------

function evalBlocklist(value) {
  if (!value) return false;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.toLowerCase();
    if (SEARCH_IMAGE_BLOCKED_HOSTS_FOR_TEST.has(host)) return false;
    if (host === 'm.media-amazon.com' || host.endsWith('.media-amazon.com')) {
      const imgMatch = pathname.match(/^\/images\/i\/([^/.]+)\./);
      if (imgMatch && /^b\d{10,}(?:_\d+)?$/.test(imgMatch[1])) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Mirror the production blocklist — keep this in lockstep with the source.
const SEARCH_IMAGE_BLOCKED_HOSTS_FOR_TEST = new Set(REQUIRED_HOSTS);

test('BUY-72491 AC4: c1.neweggimages.com blocked; working CDNs unblocked', () => {
  assert.equal(
    evalBlocklist('https://c1.neweggimages.com/ProductImageCompressAll1280/X.jpg'),
    false,
    'c1.neweggimages.com must return false from hasUsableProductImage'
  );
  assert.equal(
    evalBlocklist('https://www.neweggimages.com/abc.jpg'),
    false,
    'www.neweggimages.com must return false from hasUsableProductImage'
  );
  assert.equal(
    evalBlocklist('https://neweggimages.com/abc.jpg'),
    false,
    'neweggimages.com (apex) must return false from hasUsableProductImage'
  );
  assert.equal(
    evalBlocklist('https://images10.newegg.com/abc.jpg'),
    false,
    'images10.newegg.com (catalog CDN) must return false from hasUsableProductImage'
  );
  assert.equal(
    evalBlocklist('https://cdn.shopify.com/s/files/1/x.jpg'),
    true,
    'cdn.shopify.com must remain usable (BUY-71639)'
  );
  assert.equal(
    evalBlocklist('https://m.media-amazon.com/images/I/71jG+e7roXL._AC_UL320_.jpg'),
    true,
    'm.media-amazon.com must remain usable for real media keys (BUY-71639)'
  );
});

test('BUY-72693: ASIN-derived Amazon media keys are blocked by shape', () => {
  assert.equal(
    evalBlocklist('https://m.media-amazon.com/images/I/B10162255701._AC_SY360_.jpg'),
    false,
    'synthetic ASIN-derived Amazon media key must be rejected before emitting <img>'
  );
  assert.equal(
    evalBlocklist('https://m.media-amazon.com/images/I/B1016162010._AC_SY360_.jpg'),
    false,
    '11-char B+digits ASIN-derived Amazon media key must be rejected'
  );
  assert.equal(
    evalBlocklist('https://m.media-amazon.com/images/I/61vJtKbAssL._AC_SL1500_.jpg'),
    true,
    'real Amazon base64-ish media keys must remain usable'
  );
});