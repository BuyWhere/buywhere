// Regression test for BUY-66319.
//
// VidMee cold renders observed HTTP 404 on /search?q=...&country=...&_rsc=...
// fetches triggered by Next.js App Router <Link> prefetch defaults. The
// seo-deploy branch is repeatedly touched by WCAG / CTA-contrast cherry-picks
// (e.g. e6fb0a14e BUY-63379, bb0a6d5c1 BUY-68744) that don't preserve the
// `prefetch={false}` prop on the Shop / Developer / "Open full search"
// <Link> blocks in SeoLandingPage.tsx.
//
// This test fails CI if:
//   - any <Link> in the file targets `/search` or `/developers` without
//     `prefetch={false}` (the only triggers that re-introduce the bug)
//   - any programmatic `router.prefetch(` call appears in the file
//
// Run: `npx tsx --test src/components/seo/SeoLandingPage.prefetch.test.ts`

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourcePath = fileURLToPath(new URL("./SeoLandingPage.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

// Naive but sufficient: a scanner that finds `<Link …>…</Link>` and `<Link … />`
// JSX blocks and their props. SeoLandingPage.tsx uses both forms.
function linkBlocks(src: string): Array<{ href?: string; hasPrefetch: boolean }> {
  const blocks: Array<{ href?: string; hasPrefetch: boolean }> = [];
  // Self-closing form first.
  const selfClosed = /<Link\b([\s\S]*?)\/>/g;
  for (const m of src.matchAll(selfClosed)) {
    const inner = m[1];
    const href = /href=\{([^}]+)\}/.exec(inner)?.[1];
    const hasPrefetch = /\bprefetch=\{false\}/.test(inner);
    blocks.push({ href, hasPrefetch });
  }
  // Opening-tag form: `<Link …>`. Capture only the opening-tag portion
  // (props live inside) by matching `<Link …>` non-greedily up to a `>` that
  // is not inside `{…}`. A simple workable approximation: stop at the first
  // `>` not preceded by `{`.
  const opened = /<Link\b([\s\S]*?)>/g;
  for (const m of src.matchAll(opened)) {
    const inner = m[1];
    const href = /href=\{([^}]+)\}/.exec(inner)?.[1];
    const hasPrefetch = /\bprefetch=\{false\}/.test(inner);
    blocks.push({ href, hasPrefetch });
  }
  return blocks;
}

test("BUY-66319: every <Link> in SeoLandingPage.tsx carries prefetch={false} (RSC prefetch suppression)", () => {
  const blocks = linkBlocks(source);
  assert.ok(
    blocks.length >= 4,
    `expected ≥ 4 <Link> blocks in SeoLandingPage.tsx, found ${blocks.length}. The Shop / Developer / Open full search / Developer-angle CTAs should all be present.`,
  );
  for (const block of blocks) {
    assert.equal(
      block.hasPrefetch,
      true,
      `<Link href={${block.href ?? "?"}}> is missing prefetch={false}. BUY-66319: every Link in SeoLandingPage.tsx must suppress RSC prefetch so cold headless crawlers (VidMee) don't observe a 404 on /search?...&_rsc=... during the brief deploy-gap window.`,
    );
  }
});

test("BUY-66319: every shop / developer CTA binding in SeoLandingPage.tsx uses a <Link> with prefetch={false} (canonical CTA set)", () => {
  // CTA hrefs are sourced from config (shopperCta.href, developerCta.href)
  // and resolve at runtime to /search or /developers. Confirm every Link
  // opening tag uses *any one* of the canonical CTA binding identifiers
  // and carries prefetch={false}.
  const ctaBindingRe = /href=\{(?:shopperCta|developerCta)\.href\}/;
  const linkTagRe = /<Link\b[^>]*\/?>(?:[\s\S]*?<\/Link>)?/g;
  let ctaLinkCount = 0;
  let unsafeCount = 0;
  for (const m of source.matchAll(linkTagRe)) {
    const tag = m[0];
    if (!ctaBindingRe.test(tag)) continue;
    ctaLinkCount += 1;
    if (!/\bprefetch=\{false\}/.test(tag)) {
      unsafeCount += 1;
    }
  }
  assert.ok(
    ctaLinkCount >= 3,
    `expected ≥ 3 <Link> blocks with shopperCta/developerCta binding in SeoLandingPage.tsx, found ${ctaLinkCount}. The Shop / Developer / "Open full search" / Developer-angle CTAs should all be present.`,
  );
  assert.equal(
    unsafeCount,
    0,
    `${unsafeCount} <Link> block(s) bound to a Shop / Developer CTA are missing prefetch={false}. BUY-66319: every Shop / Developer Link must suppress RSC prefetch so cold headless crawlers don't observe a 404 on /search?...&_rsc=... during the brief deploy-gap window.`,
  );
});

test("BUY-66319: no programmatic router.prefetch( call exists in SeoLandingPage.tsx (audit)", () => {
  const offending = source.match(/router\.prefetch\s*\(/g) ?? [];
  assert.equal(
    offending.length,
    0,
    `SeoLandingPage.tsx contains ${offending.length} router.prefetch( call(s). BUY-66319: programmatic prefetch on this component would re-introduce the cold-crawler 404 even with prefetch={false} on each <Link>.`,
  );
});
