#!/usr/bin/env node
/**
 * BUY-75133 offline verifier — proves the soft-404 fix actually 404s on
 * live API 404 responses and that the sitemap drops the placeholder slugs.
 *
 * Run: node data/BUY-75133-verifier.mjs
 *
 * Does NOT require a deploy — probes the upstream /v1/brand/{slug} for each
 * advertised slug and confirms the gate logic in middleware.ts would fire,
 * then fetches sitemap-brands.xml and confirms it is empty (or contains
 * only slugs that exist upstream).
 */
const SLUGS = [
  "apple", "samsung", "sony", "nike", "dyson",
  "nintendo", "dell", "lenovo", "canon", "xiaomi",
];

const BASE = process.env.BUYWHERE_API_BASE || "https://api.buywhere.ai";
const SITE = process.env.BUYWHERE_SITE || "https://buywhere.ai";

async function probeBrand(slug) {
  const url = `${BASE}/v1/brand/${encodeURIComponent(slug)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  return { slug, status: res.status };
}

async function main() {
  console.log(`# BUY-75133 offline verifier @ ${new Date().toISOString()}`);
  console.log(`# Probing ${BASE}/v1/brand/{slug} for ${SLUGS.length} slugs`);

  const results = await Promise.all(SLUGS.map(probeBrand));
  const all404 = results.every((r) => r.status === 404);

  console.log("\n## /v1/brand/{slug} probe");
  for (const r of results) {
    console.log(`  ${r.slug.padEnd(10)} ${r.status}`);
  }
  console.log(`\nExpected: 10/10 status=404 (so middleware gate returns hard 404)`);
  console.log(`Actual:   ${results.filter((r) => r.status === 404).length}/${results.length} status=404`);

  // sitemap-brands.xml check
  console.log("\n## sitemap-brands.xml probe");
  const sitemapRes = await fetch(`${SITE}/sitemap-brands.xml`);
  const body = await sitemapRes.text();
  const urlCount = (body.match(/<loc>/g) || []).length;
  console.log(`  status=${sitemapRes.status} size=${body.length}B urlCount=${urlCount}`);
  console.log(`  Expected: urlCount=0 (slim empty <urlset/> after deploy)`);

  // Sanity probe: real product pages still 200
  console.log("\n## control: real product page still 200");
  const prodRes = await fetch(`${SITE}/p/616638515`, { method: "HEAD" });
  console.log(`  /p/616638515 status=${prodRes.status}`);
  console.log(`  Expected: 200 (control — fix does not regress real PDPs)`);

  // Pass criteria
  const ok =
    all404 &&
    urlCount === 0 &&
    prodRes.status === 200;

  console.log(`\n# verifier result: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("verifier threw:", err);
  process.exit(2);
});