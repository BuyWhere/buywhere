#!/usr/bin/env node
import assert from "node:assert/strict";

const BASE = process.env.BUY74905_BASE_URL || "https://buywhere.ai";
const UA = "OAI-SearchBot/1.0 (+BUY-74905 honest-lastmod verifier)";

const TARGETS = [
  { kind: "intent", path: "/best-gaming-laptops-us", sitemap: "/sitemap-pages.xml" },
  { kind: "intent", path: "/best-android-tablets-us", sitemap: "/sitemap-pages.xml" },
  { kind: "compare", path: "/compare/buywhere-vs-amazon", sitemap: "/sitemap-compare.xml" },
  { kind: "compare", path: "/compare/buywhere-vs-google-shopping", sitemap: "/sitemap-compare.xml" },
  { kind: "blog", path: "/blog/best-gaming-laptops-us-2026", sitemap: "/sitemap-blog.xml" },
  { kind: "blog", path: "/blog/cheapest-iphone-singapore-2026", sitemap: "/sitemap-blog.xml" },
];

function absolute(path) {
  return new URL(path, BASE).toString();
}

async function get(path) {
  const res = await fetch(absolute(path), { headers: { "User-Agent": UA } });
  const text = await res.text();
  return { status: res.status, text, url: absolute(path) };
}

function extractStamp(html) {
  const data = html.match(/data-ssr-prices-checked=["']([^"']+)["']/i)?.[1];
  const time = html.match(/<time\b[^>]*dateTime=["']([^"']+)["']/i)?.[1]
    || html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1];
  const visible = html.match(/(?:Prices checked|Updated|Last updated)\s*<time\b[^>]*>([^<]+)<\/time>/i)?.[1]?.trim();
  return { data, time, visible, iso: data || time || null };
}

function sitemapLastmod(xml, loc) {
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
  for (const block of blocks) {
    const url = block.match(/<loc>([\s\S]*?)<\/loc>/)?.[1]?.trim();
    if (url !== loc) continue;
    return block.match(/<lastmod>([\s\S]*?)<\/lastmod>/)?.[1]?.trim() || null;
  }
  return undefined;
}

function normalizeIso(value) {
  if (!value) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

async function verifyTarget(target) {
  const first = await get(target.path);
  assert.equal(first.status, 200, `${target.path} status`);
  const firstStamp = extractStamp(first.text);
  assert.ok(firstStamp.iso, `${target.path} exposes data-ssr-prices-checked or time[datetime]`);

  const second = await get(target.path);
  assert.equal(second.status, 200, `${target.path} second status`);
  const secondStamp = extractStamp(second.text);
  assert.equal(
    normalizeIso(secondStamp.iso),
    normalizeIso(firstStamp.iso),
    `${target.path} stamp is stable across successive unchanged renders`,
  );

  const sitemap = await get(target.sitemap);
  assert.equal(sitemap.status, 200, `${target.sitemap} status`);
  const loc = absolute(target.path);
  const lastmod = sitemapLastmod(sitemap.text, loc);
  // Some routes (e.g. /compare markdown docs) are intentionally not listed
  // in any sitemap today; that is a separate indexation issue, not a
  // BUY-74905 violation. The honest-lastmod invariant only applies when a
  // <lastmod> is actually emitted. Treat a missing <lastmod> as a non-event
  // and proceed to assert equality only when the sitemap does emit one.
  if (lastmod) {
    assert.equal(
      normalizeIso(lastmod),
      normalizeIso(firstStamp.iso),
      `${target.path} visible stamp matches sitemap lastmod`,
    );
  }

  return {
    path: target.path,
    kind: target.kind,
    stamp: normalizeIso(firstStamp.iso),
    sitemapLastmod: normalizeIso(lastmod),
    status: "PASS",
  };
}

const results = [];
let bad = 0;
for (const target of TARGETS) {
  try {
    const result = await verifyTarget(target);
    results.push(result);
    console.log(`PASS ${target.kind} ${target.path} stamp=${result.stamp} sitemapLastmod=${result.sitemapLastmod ?? "omitted"}`);
  } catch (err) {
    bad += 1;
    results.push({ path: target.path, kind: target.kind, status: "FAIL", error: err.message });
    console.error(`FAIL ${target.kind} ${target.path}: ${err.message}`);
  }
}

console.log(JSON.stringify({ base: BASE, total: TARGETS.length, bad, results }, null, 2));
process.exitCode = bad === 0 ? 0 : 1;
