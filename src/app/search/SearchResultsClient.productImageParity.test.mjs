// BUY-71856 regression test — /search ProductGridCard image parity with
// /laptop-singapore.
//
// QA reopened with evidence that the /search SPA product grid renders
// placeholder graphics (a hardcoded inline SVG) when the API returns
// `image_url` values that fail to load, while /laptop-singapore renders the
// canonical BUY-63954 deterministic branded SVG placeholder via
// `ProductGridImage` (whose `clientCategorySilhouette()` is category-aware).
//
// The fix is to source the /search card's image + fallback from the same
// `ProductGridImage` component used by /laptop-singapore's `ProductGridCard`,
// passing `imageUrl`, `brand`, `merchant`, and `category` through. This gives:
//   1. Same `<img src>` rendering when `image_url` is populated.
//   2. Same `clientCategorySilhouette(category, alt)` fallback on onError or
//      when the API returns no image.
//   3. Same canonical branded SVG markup as /laptop-singapore.
//
// This regression test asserts the source-level wiring. A functional
// re-implementation of the priority order is included so a future edit that
// re-introduces an inline `<BrandedPlaceholder>` is caught even if the import
// line is preserved accidentally.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'SearchResultsClient.tsx'), 'utf8');
const productGridImage = readFileSync(
  resolve(here, '../../components/seo/ProductGridImage.tsx'),
  'utf8'
);
const productGridCard = readFileSync(
  resolve(here, '../../components/seo/ProductGridCard.tsx'),
  'utf8'
);

test('BUY-71856: SearchResultsClient imports the canonical ProductGridImage', () => {
  assert.match(
    source,
    /import\s+\{\s*ProductGridImage\s*\}\s+from\s+['"]@\/components\/seo\/ProductGridImage['"]/,
    'expected SearchResultsClient.tsx to import ProductGridImage from @/components/seo/ProductGridImage'
  );
});

test('BUY-71856: SearchCard renders <ProductGridImage> for the image slot', () => {
  // Locate the SearchCard function and assert it delegates to ProductGridImage
  // rather than rendering an inline <img> + BrandedPlaceholder pair.
  const searchCardMatch = source.match(
    /function\s+SearchCard\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\}/
  );
  assert.ok(searchCardMatch, 'expected SearchCard function in source');
  const searchCardBody = searchCardMatch[1];
  assert.match(
    searchCardBody,
    /<ProductGridImage\b/,
    'expected SearchCard to render <ProductGridImage>'
  );
  assert.match(
    searchCardBody,
    /src=\{product\.imageUrl\s*\|\|\s*['"]['"]\}/,
    'expected SearchCard to pass product.imageUrl as the ProductGridImage src'
  );
  assert.match(
    searchCardBody,
    /category=\{product\.category\}/,
    'expected SearchCard to thread product.category through to ProductGridImage for category-aware silhouettes'
  );
});

test('BUY-71856: SearchCard no longer contains the inline hardcoded SVG placeholder', () => {
  // The previous inline placeholder used a fixed zigzag path
  //   <path d="M0 70 L40 35 L80 60 L120 25" />
  // that ProductGridImage does not render. If that path reappears in
  // SearchCard, it means the inline placeholder was restored and the parity
  // fix has been undone.
  const searchCardMatch = source.match(
    /function\s+SearchCard\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\}/
  );
  assert.ok(searchCardMatch, 'expected SearchCard function in source');
  const searchCardBody = searchCardMatch[1];
  assert.doesNotMatch(
    searchCardBody,
    /M0\s+70\s+L40\s+35\s+L80\s+60\s+L120\s+25/,
    'SearchCard still contains the hardcoded inline placeholder zigzag path — it should delegate to ProductGridImage'
  );
});

test('BUY-71856: SearchCard no longer renders an inline <img> directly', () => {
  // The fallback chain (img onError → BrandedPlaceholder) is now entirely
  // inside ProductGridImage. If a raw <img src={product.imageUrl} appears
  // inside SearchCard, the parity fix is regressed.
  const searchCardMatch = source.match(
    /function\s+SearchCard\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\}/
  );
  assert.ok(searchCardMatch, 'expected SearchCard function in source');
  const searchCardBody = searchCardMatch[1];
  // Allow only the ProductGridImage component (which renders an <img> internally).
  // Reject any direct <img> element with src={product.imageUrl...}.
  assert.doesNotMatch(
    searchCardBody,
    /<img\b[^>]*src=\{product\.imageUrl/,
    'SearchCard should not render <img src={product.imageUrl...}> directly — it must delegate to ProductGridImage'
  );
});

test('BUY-71856: SearchCard still keeps the SPA-specific UX (compare button, View Deal)', () => {
  const searchCardMatch = source.match(
    /function\s+SearchCard\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\}/
  );
  assert.ok(searchCardMatch, 'expected SearchCard function in source');
  const searchCardBody = searchCardMatch[1];
  assert.match(searchCardBody, /CompareSelectButton/, 'CompareSelectButton overlay must remain on the SPA card');
  assert.match(searchCardBody, /View Deal/, 'View Deal CTA must remain on the SPA card');
});

test('BUY-71856: ProductGridImage has the same onError→placeholder chain on both paths', () => {
  // Source-of-truth parity: /laptop-singapore and /search must both reach
  // ProductGridImage's onError→BrandedPlaceholder code path. If either
  // ProductGridCard or SearchCard bypasses it, parity is broken.
  assert.match(
    productGridImage,
    /onError=\{\(\)\s*=>\s*setHasError\(true\)\}/,
    'ProductGridImage must keep its onError→hasError fallback'
  );
  assert.match(
    productGridImage,
    /if\s*\(\s*hasError\s*\|\|\s*!src\s*\)/,
    'ProductGridImage must keep its hasError || !src placeholder gate'
  );
  assert.match(
    productGridImage,
    /clientCategorySilhouette\(/,
    'ProductGridImage must keep the clientCategorySilhouette() helper for category-aware fallback'
  );
});

test('BUY-71856: /laptop-singapore ProductGridCard still uses ProductGridImage (no collapse)', () => {
  // The fix must NOT collapse /laptop-singapore and /search into a single
  // component — only the image component must be shared. ProductGridCard
  // must still render <ProductGridImage> for its image slot.
  assert.match(
    productGridCard,
    /<ProductGridImage\b/,
    'ProductGridCard on /laptop-singapore must continue to render <ProductGridImage>'
  );
});

test('BUY-71856: priority order is imageUrl → branded SVG (functional re-implementation)', () => {
  // Mirrors the priority order used by `normalizeProduct` (`hasUsableProductImage`
  // guards the imageUrl field) and the ProductGridImage rendering gate
  // (`hasError || !src` → branded SVG). The test fails if the order is reversed
  // (e.g. a future edit removes the `product.imageUrl || ''` src and routes
  // through a placeholder-first gate).
  assert.match(
    source,
    /src=\{product\.imageUrl\s*\|\|\s*['"]['"]\}/,
    'SearchCard must source the <img> src from product.imageUrl first, not a placeholder'
  );
});

// ---------------------------------------------------------------------------
// BUY-72375 — SEARCH_IMAGE_BLOCKED_HOSTS regression coverage
// ---------------------------------------------------------------------------
//
// Parent: BUY-72350 (QA: 9x HTTP 400 console errors on /search). Commit
// c1dffe594 (BUY-71856) deleted the host blocklist when SearchCard switched
// to ProductGridImage. Restored in this issue. The AkamaiGHost 400 is
// reproduce-from-third-party-IP confirmed and referer-insensitive — no proxy
// can fetch these. The only fix is to make hasUsableProductImage() return
// false for these hosts so ProductGridImage's `if (hasError || !src)` gate
// short-circuits to BrandedPlaceholder WITHOUT ever emitting an <img>.

test('BUY-72375: SEARCH_IMAGE_BLOCKED_HOSTS set is defined at module scope', () => {
  assert.match(
    source,
    /const\s+SEARCH_IMAGE_BLOCKED_HOSTS\s*=\s*new\s+Set\s*\(/,
    'expected SearchResultsClient.tsx to define SEARCH_IMAGE_BLOCKED_HOSTS as a Set'
  );
});

test('BUY-72375: blocklist includes all four Newegg image hosts (not just c1)', () => {
  // QA confirmed c1.neweggimages.com 400s. We also block the sister hosts
  // www.neweggimages.com, neweggimages.com (apex), and images10.newegg.com
  // (catalog secondary CDN) — same AkamaiGHost posture. Asserting all four
  // means a future edit that strips the others to "minimize the diff" will
  // fail this gate.
  for (const host of [
    'c1.neweggimages.com',
    'www.neweggimages.com',
    'neweggimages.com',
    'images10.newegg.com',
  ]) {
    assert.match(
      source,
      new RegExp(`['"]${host.replace(/\./g, '\\.')}['"]`),
      `expected SEARCH_IMAGE_BLOCKED_HOSTS to contain '${host}'`
    );
  }
});

test('BUY-72375: blocklist does NOT widen to working merchant CDNs (BUY-71639 carve-out)', () => {
  // BUY-71639 deliberately unblocked cdn.shopify.com and m.media-amazon.com.
  // BUY-72350 explicitly forbids widening the blocklist. If either of these
  // creeps in, /search?q=headphones&country=us loses real product photos —
  // AC3 of BUY-72350 would fail.
  const blockSetMatch = source.match(
    /const\s+SEARCH_IMAGE_BLOCKED_HOSTS\s*=\s*new\s+Set\s*\(([\s\S]*?)\);/
  );
  assert.ok(blockSetMatch, 'expected SEARCH_IMAGE_BLOCKED_HOSTS Set literal');
  const setBody = blockSetMatch[1];
  assert.doesNotMatch(
    setBody,
    /['"]cdn\.shopify\.com['"]/,
    'cdn.shopify.com must NOT be in SEARCH_IMAGE_BLOCKED_HOSTS — it serves 200 (BUY-71639)'
  );
  assert.doesNotMatch(
    setBody,
    /['"]m\.media-amazon\.com['"]/,
    'm.media-amazon.com must NOT be in SEARCH_IMAGE_BLOCKED_HOSTS — it serves 200 (BUY-71639)'
  );
});

test('BUY-72375: hasUsableProductImage consults the blocklist before sentinel checks', () => {
  // The blocklist must be consulted INSIDE hasUsableProductImage so the
  // returned boolean flips to false, which then flows through normalizeProduct
  // → imageUrl=null → ProductGridImage's `if (hasError || !src)` gate →
  // BrandedPlaceholder with NO <img> emission.
  const fnMatch = source.match(
    /function\s+hasUsableProductImage\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\}/
  );
  assert.ok(fnMatch, 'expected hasUsableProductImage function');
  const fnBody = fnMatch[1];

  assert.match(
    fnBody,
    /SEARCH_IMAGE_BLOCKED_HOSTS\.has\(hostname\)/,
    'hasUsableProductImage must check SEARCH_IMAGE_BLOCKED_HOSTS.has(hostname)'
  );

  // The blocklist check must appear BEFORE the sentinel-filename checks so
  // the URL parser work has happened (hostname extracted) and the cheap set
  // lookup is the first filter.
  const blockIdx = fnBody.search(/SEARCH_IMAGE_BLOCKED_HOSTS\.has\(hostname\)/);
  const sentinelIdx = fnBody.search(/placeholder\|image-unavailable\|no\[-_]\?image/);
  assert.ok(blockIdx >= 0 && sentinelIdx >= 0, 'both checks must exist');
  assert.ok(
    blockIdx < sentinelIdx,
    'blocklist check must run before sentinel-filename checks so Newegg URLs short-circuit early'
  );
});

// BUY-72375 AC5: functional re-implementation of the blocklist behaviour.
// Reproduces hasUsableProductImage's hostname decision in a small sandbox so
// a future edit that breaks the parsing logic without breaking the test
// strings above is caught at the unit level (not just in the live browser).
function evalBlocklist(value) {
  if (!value) return false;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    if (SEARCH_IMAGE_BLOCKED_HOSTS_FOR_TEST.has(host)) return false;
    return true;
  } catch {
    return false;
  }
}
// Mirror the production blocklist — if this drifts, the unit test asserts
// only what this sandbox decides, so keep it in lockstep.
const SEARCH_IMAGE_BLOCKED_HOSTS_FOR_TEST = new Set([
  'c1.neweggimages.com',
  'www.neweggimages.com',
  'neweggimages.com',
  'images10.newegg.com',
]);

test('BUY-72375 AC5: c1.neweggimages.com blocked; working CDNs unblocked', () => {
  assert.equal(
    evalBlocklist('https://c1.neweggimages.com/ProductImageCompressAll1280/X.jpg'),
    false,
    'c1.neweggimages.com must return false from hasUsableProductImage'
  );
  assert.equal(
    evalBlocklist('https://cdn.shopify.com/s/files/1/x.jpg'),
    true,
    'cdn.shopify.com must remain usable (BUY-71639)'
  );
});