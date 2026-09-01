import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "posthog-client.ts"), "utf8");

test("BUY-79258 queue helper exists and product_card_click is dual-emitted", () => {
  assert.match(src, /const pending:/)
  assert.match(src, /function flushPosthogQueue/);
  assert.match(src, /function captureWhenReady/);
  assert.match(src, /captureWhenReady\("product_card_click"/);
  assert.match(src, /captureWhenReady\("affiliate_click"/);
  assert.match(src, /posthog\.__loaded/);
});

test("BUY-79258 AnalyticsTracker no longer drops on !__loaded", () => {
  const tracker = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../components/AnalyticsTracker.tsx"),
    "utf8",
  );
  assert.match(tracker, /captureWhenReady\('\$pageview'/);
  assert.doesNotMatch(tracker, /posthog\.__loaded/);
});

test("BUY-79258 client host is first-party proxy", () => {
  const cfg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../lib/posthog.ts"), "utf8");
  assert.match(cfg, /\/ingest\/ph/);
});
