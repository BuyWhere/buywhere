// BUY-67973 regression: SearchCard must never render the literal "Product image"
// overlay text on top of loaded imagery. The previous implementation rendered
// an <div>Product image</div> sibling under every <img>, so the alt text leaked
// visually on the loaded image. The fix removes the literal text and replaces
// it with a state machine (loading / loaded / error) plus a silent branded
// SVG silhouette fallback.
//
// This is a structural / source-string test by design: the rendering unit is a
// React component (SearchCardImage) but the project ships no React Testing
// Library harness. The structural test is sufficient to fail CI if anyone
// reintroduces the literal string or removes the state machine.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE_PATH = resolve(__dirname, "SearchResultsClient.tsx");
const source = readFileSync(SOURCE_PATH, "utf8");

test("SearchCard never renders the literal 'Product image' overlay text", () => {
  // The previous bug: <div>Product image</div> rendered as a sibling of <img>
  // and never hidden when the image loaded. The literal string must not
  // appear in any JSX-shipping context. Comments are exempt — this is a
  // source-as-shipped check, so we strip line comments first.
  const stripped = source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.equal(
    stripped.includes("Product image"),
    false,
    "Source still ships literal 'Product image' string — overlay text bug regressed.",
  );
});

test("SearchCardImage uses a loading/loaded/error state machine", () => {
  // The fix must drive placeholder visibility through React state, not a
  // conditional render of a sibling div.
  assert.match(
    source,
    /type\s+SearchCardMediaState\s*=\s*['"]loading['"]\s*\|\s*['"]loaded['"]\s*\|\s*['"]error['"]/,
    "SearchCardMediaState type missing or no longer uses 3-state machine.",
  );
  // The image element must have onLoad + onError to drive the state.
  assert.match(source, /onLoad=\{\(\)\s*=>\s*setMediaState\(['"]loaded['"]\)/);
  assert.match(source, /onError=\{\(\)\s*=>\s*setMediaState\(['"]error['"]\)/);
});

test("SearchCard has no leftover inline onError display='none' pattern", () => {
  // The pre-fix code hid the img on error but never hid the sibling
  // placeholder, so the text stayed visible. The fix unmounts the placeholder
  // unconditionally and renders a silent fallback instead.
  assert.equal(
    source.includes("event.currentTarget.style.display = 'none'"),
    false,
    "Source still uses pre-fix img.style.display='none' on error — placeholder text leak route still possible.",
  );
});

test("SearchCardImage renders a silent SVG silhouette fallback (no text)", () => {
  // The fallback must be a graphic silhouette, not text. The pre-fix
  // `Product image` literal was the visible artifact on dead-URL products.
  assert.match(source, /function\s+ProductImageSilhouette/);
});

test("SearchCardImage exposes a deterministic data-testid for QA probing", () => {
  // QA + e2e probes should be able to detect the fallback state without
  // scraping alt text. data-testid is the supported pattern.
  assert.match(source, /data-testid="search-product-media-fallback"/);
  assert.match(source, /data-testid="search-product-media-skeleton"/);
});
