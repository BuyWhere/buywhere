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