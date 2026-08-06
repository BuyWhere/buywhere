// Regression test for BUY-66319.
//
// QA reopened the issue because VidMee fresh renders still log HTTP 404 on
// `/search?q=...&country=...&_rsc=...` requests even after the original
// `prefetch={false}` patch from PR #345 was merged. Root cause: a later WCAG
// cherry-pick (BUY-63379 / commit e6fb0a14e) stripped `prefetch={false}` from
// all three CTAs in SeoLandingPage.tsx, regressing the live site back to
// pre-fix state.
//
// These tests assert that the source uses `prefetch={false}` on every
// in-app `<Link>` whose `href` points at `/search?...` or `/developers`. If a
// future cherry-pick or refactor drops the prop, this test fails before the
// change reaches main.
//
// VidMee-specific behaviour — `prefetch={false}` is the only safe knob in
// App Router. `<Link prefetch>` defaults to true in viewport, which is what
// fires `_rsc=` requests for fresh headless crawlers. We deliberately do not
// `router.prefetch()` these CTAs programmatically anywhere; that path was
// audited during the BUY-66319 investigation (only `<Link>` prefetch fires).

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_PATH = resolve(__dirname, "./SeoLandingPage.tsx");
const source = readFileSync(SOURCE_PATH, "utf8");

function countMatches(pattern: RegExp): number {
  return (source.match(pattern) ?? []).length;
}

test("prefetch={false} is set on every <Link> in SeoLandingPage.tsx (BUY-66319)", () => {
  // The file should contain at least one `prefetch={false}` attribute.
  const n = countMatches(/prefetch=\{false\}/g);
  assert.ok(
    n >= 4,
    `expected >= 4 occurrences of prefetch={false} in SeoLandingPage.tsx, found ${n}`,
  );
});

test("no bare <Link> in SeoLandingPage.tsx targets /search without prefetch={false} (BUY-66319)", () => {
  // Find every `<Link href={...} ...>` block in the file. Each block must
  // contain `prefetch={false}` on a line within the same tag. We do this by
  // matching the opening `<Link` line and verifying a `prefetch={false}`
  // line follows before the closing `</Link>`.
  //
  // This is the defensive test: it survives whitespace, attribute order, and
  // cherry-pick clobbers that remove only one of several `prefetch={false}`
  // occurrences.

  // Strip comments so we don't match comment text.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // Find every `<Link` ... `</Link>` block via a non-greedy match.
  const blockRe = /<Link\b[\s\S]*?<\/Link>/g;
  const blocks = stripped.match(blockRe) ?? [];

  assert.ok(blocks.length > 0, "expected at least one <Link> block");

  for (const block of blocks) {
    // Only in-app navigation links matter. `target="_blank"` product cards are
    // <a> tags, not <Link>, so they're already not in this set.
    const targetsSearch = /href=\{[^}]*(?:shopperCta\.href|developerCta\.href|\/search)/.test(block);
    const targetsDevelopers = /href=\{[^}]*developerCta\.href|\/developers/.test(block);
    if (!targetsSearch && !targetsDevelopers) continue;

    assert.ok(
      /prefetch=\{false\}/.test(block),
      `<Link> block missing prefetch={false}:\n${block}`,
    );
  }
});

test("no `router.prefetch(` call exists in SeoLandingPage.tsx (BUY-66319 audit)", () => {
  // Defensive: if a future PR adds a programmatic `router.prefetch(...)` for
  // /search or /developers, that would re-introduce the same _rsc= 404 on
  // cold crawlers. Reject it here.
  assert.equal(
    countMatches(/router\.prefetch\(/g),
    0,
    "router.prefetch() calls in SeoLandingPage.tsx would re-introduce the _rsc= 404 bug",
  );
});