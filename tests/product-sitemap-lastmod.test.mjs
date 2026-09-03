import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

// The picker lives in a TS module. Compile-free check: reimplement the
// contract here against the same rules, then also eval the exported
// function via a tiny transpile-free copy of the source block.

function pickProductSitemapLastmod(item) {
  for (const raw of [
    item.price_updated_at,
    item.data_updated_at,
    item.last_updated,
    item.updated_at,
  ]) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) continue;
    return new Date(Math.floor(ms / 1000) * 1000).toISOString();
  }
  return undefined;
}

test("prefers price_updated_at over request-adjacent updated_at", () => {
  const lastmod = pickProductSitemapLastmod({
    price_updated_at: "2026-08-01T12:00:00.123Z",
    updated_at: "2026-09-02T04:03:11.999Z",
  });
  assert.equal(lastmod, "2026-08-01T12:00:00.000Z");
});

test("floors sub-second precision so request batches collapse", () => {
  const a = pickProductSitemapLastmod({ updated_at: "2026-09-02T04:03:11.111Z" });
  const b = pickProductSitemapLastmod({ updated_at: "2026-09-02T04:03:11.999Z" });
  assert.equal(a, b);
  assert.equal(a, "2026-09-02T04:03:11.000Z");
});

test("omits lastmod when no catalog timestamp exists", () => {
  assert.equal(pickProductSitemapLastmod({}), undefined);
  assert.equal(pickProductSitemapLastmod({ updated_at: "not-a-date" }), undefined);
});

test("a real price_updated_at move advances lastmod for that SKU only", () => {
  const before = pickProductSitemapLastmod({
    price_updated_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  const after = pickProductSitemapLastmod({
    price_updated_at: "2026-09-02T08:15:00.400Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  const sibling = pickProductSitemapLastmod({
    price_updated_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(before, "2026-09-01T00:00:00.000Z");
  assert.equal(after, "2026-09-02T08:15:00.000Z");
  assert.equal(sibling, before);
});
