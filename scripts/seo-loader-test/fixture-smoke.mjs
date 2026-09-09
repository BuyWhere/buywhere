/**
 * Smoke test: validate the real /home/paperclip/buywhere/content/intent-pages/*.json
 * files using the same algorithm as src/lib/seo-intent-page-loader.ts. The actual
 * loader is a TypeScript module that requires `next build` to compile; this
 * parallel implementation lets CI run without a Next.js compile step.
 *
 * Run with: node scripts/seo-loader-test/fixture-smoke.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const REQUIRED_STRING_KEYS = [
  "slug", "title", "description", "heroEyebrow", "heroTitle", "heroBody",
  "canonicalPath", "country", "currency", "locale", "searchQuery",
  "productSectionTitle", "comparisonSectionTitle", "highlightSectionTitle",
  "adviceSectionTitle", "faqSectionTitle",
];
const REQUIRED_ARRAY_KEYS = ["comparisonColumns", "comparisonRows", "highlights", "advicePoints", "faqs", "fallbackProducts"];
const META_KEYS = new Set(["owner", "reviewer", "queueRow"]);
const ALLOWED_COUNTRIES = new Set(["US", "SG"]);

function validate(raw, filePath) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${filePath}: not object`);
  for (const key of REQUIRED_STRING_KEYS) {
    if (typeof raw[key] !== "string" || raw[key].length === 0) throw new Error(`${filePath}: missing ${key}`);
  }
  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(raw[key])) throw new Error(`${filePath}: missing array ${key}`);
  }
  if (!ALLOWED_COUNTRIES.has(raw.country)) throw new Error(`${filePath}: country ${raw.country} not supported`);
  if (raw.canonicalPath !== `/${raw.slug}`) throw new Error(`${filePath}: canonicalPath mismatch`);
  const stripped = {};
  for (const [k, v] of Object.entries(raw)) if (!META_KEYS.has(k)) stripped[k] = v;
  return stripped;
}

const dir = path.join(process.cwd(), "content", "intent-pages");
const files = readdirSync(dir).filter(f => f.endsWith(".json")).sort();
const out = {};
for (const file of files) {
  const cfg = validate(JSON.parse(readFileSync(path.join(dir, file), "utf8")), file);
  out[cfg.slug] = cfg;
}

console.log("smoke: loaded", files.length, "file(s) from content/intent-pages/");

// The shipped loader's contract is identical across countries; pick a real
// writer-produced slug to assert against. If writers haven't shipped
// cheapest-airpods-pro-3-singapore.json yet, this fails loudly so we notice —
// it does NOT silently pass.
const pickSlug = "cheapest-airpods-pro-3-singapore";
assert.ok(out[pickSlug], `expected shipped writer slug "${pickSlug}" to be in the merged map`);
assert.ok(["US", "SG"].includes(out[pickSlug].country), `country ${out[pickSlug].country} not in US/SG`);
assert.equal(out[pickSlug].owner, undefined, "owner stripped");
assert.equal(out[pickSlug].reviewer, undefined, "reviewer stripped");
assert.equal(out[pickSlug].queueRow, undefined, "queueRow stripped");
assert.equal(out[pickSlug].canonicalPath, `/${pickSlug}`, "canonicalPath === /<slug>");

// Every loaded file must satisfy the slug == basename invariant; catch any
// writer typo that slipped past the loader's throw-on-validate.
for (const [slug, cfg] of Object.entries(out)) {
  assert.equal(cfg.canonicalPath, `/${slug}`, `slug "${slug}" canonicalPath mismatch`);
  assert.ok(["US", "SG"].includes(cfg.country), `slug "${slug}" country ${cfg.country} not in US/SG`);
}

console.log("ok —", files.length, "files validated,", Object.keys(out).length, "unique slugs");
