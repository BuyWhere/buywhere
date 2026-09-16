// BUY-82738: desktop PDP must be 2-col from md, wrap crumbs, overflow-x snippets.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("BUY-82738: SSR PDP uses 2-col grid at md and wrapping breadcrumbs", () => {
  const layout = readFileSync(new URL("./SsrProductDetailLayout.tsx", import.meta.url), "utf8");
  assert.match(layout, /md:grid-cols-\[minmax\(240px,1fr\)_minmax\(320px,1fr\)\]/);
  assert.match(layout, /flex flex-wrap/);
  assert.match(layout, /line-clamp-2/);
  assert.doesNotMatch(layout, /aspect-square max-h-64/);
  assert.doesNotMatch(layout, /line-clamp-1/);
});

test("BUY-82738: US/SG/region PDPs consume SsrProductDetailLayout", () => {
  const files = [
    "../../app/products/us/[slug]/[productId]/page.tsx",
    "../../app/products/sg/[slug]/[productId]/page.tsx",
    "../../app/products/[region]/[slug]/[productId]/page.tsx",
  ];
  for (const rel of files) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.match(src, /SsrProductDetailLayout/, rel);
    assert.doesNotMatch(src, /aspect-square max-h-64/, rel);
  }
});

test("BUY-82738: footer/agent code snippets keep overflow-x-auto", () => {
  const agent = readFileSync(new URL("../AgentMarketingBlock.tsx", import.meta.url), "utf8");
  assert.match(agent, /overflow-x-auto max-w-full/);
});
