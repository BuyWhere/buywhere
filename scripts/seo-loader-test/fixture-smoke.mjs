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

console.log("smoke: loaded", files.length, "file(s):", files);
assert.equal(files.length, 1, "expected exactly one example fixture");
assert.ok(out["cheapest-airpods-pro-3-us"]);
assert.equal(out["cheapest-airpods-pro-3-us"].country, "US");
assert.equal(out["cheapest-airpods-pro-3-us"].owner, undefined, "owner stripped");
assert.equal(out["cheapest-airpods-pro-3-us"].reviewer, undefined, "reviewer stripped");
console.log("ok");
