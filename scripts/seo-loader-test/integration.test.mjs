/**
 * Integration check: place a well-formed fixture in a tmp dir, run the loader,
 * confirm the merged map includes both the existing TS-only slug and the JSON
 * fixture, and the JSON wins on a slug clash.
 *
 * Run with: node --test scripts/seo-loader-test/integration.test.mjs
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Inline reproduction of the loader for stand-alone testing. Mirrors
// src/lib/seo-intent-page-loader.ts at the time of writing. Keep in sync.
import { readdirSync, readFileSync } from "node:fs";

const REQUIRED_STRING_KEYS = [
  "slug", "title", "description", "heroEyebrow", "heroTitle", "heroBody",
  "canonicalPath", "country", "currency", "locale", "searchQuery",
  "productSectionTitle", "comparisonSectionTitle", "highlightSectionTitle",
  "adviceSectionTitle", "faqSectionTitle",
];
const REQUIRED_ARRAY_KEYS = ["comparisonColumns", "comparisonRows", "highlights", "advicePoints", "faqs", "fallbackProducts"];
const META_KEYS = new Set(["owner", "reviewer", "queueRow"]);
const ALLOWED_COUNTRIES = new Set(["US", "SG"]);

function isObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
function stripMetaKeys(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) if (!META_KEYS.has(k)) out[k] = v;
  return out;
}
function validate(raw, filePath) {
  if (!isObject(raw)) throw new Error(`${filePath}: not object`);
  for (const key of REQUIRED_STRING_KEYS) {
    if (typeof raw[key] !== "string" || raw[key].length === 0) throw new Error(`${filePath}: missing ${key}`);
  }
  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(raw[key])) throw new Error(`${filePath}: missing array ${key}`);
  }
  if (!ALLOWED_COUNTRIES.has(raw.country)) throw new Error(`${filePath}: country ${raw.country} not supported`);
  if (raw.canonicalPath !== `/${raw.slug}`) throw new Error(`${filePath}: canonicalPath mismatch`);
  return stripMetaKeys(raw);
}

function load(contentDir) {
  const out = {};
  let entries;
  try { entries = readdirSync(contentDir).filter(f => f.endsWith(".json")); }
  catch (err) { if (err.code === "ENOENT") return out; throw err; }
  for (const file of entries.sort()) {
    const p = path.join(contentDir, file);
    const cfg = validate(JSON.parse(readFileSync(p, "utf8")), file);
    if (out[cfg.slug]) throw new Error(`duplicate ${cfg.slug}`);
    out[cfg.slug] = cfg;
  }
  return out;
}

function fixture(slug, overrides = {}) {
  return {
    slug, title: "T", description: "D", heroEyebrow: "E", heroTitle: "H", heroBody: "B",
    canonicalPath: `/${slug}`, country: "US", currency: "USD", locale: "en_US", searchQuery: "Q",
    productSectionTitle: "P", comparisonSectionTitle: "C", comparisonColumns: ["X"], comparisonRows: [],
    highlightSectionTitle: "Hi", highlights: [{ title: "t", body: "b" }],
    adviceSectionTitle: "A", advicePoints: ["p"], faqSectionTitle: "F",
    faqs: [{ question: "q", answer: "a" }], fallbackProducts: [],
    ...overrides,
  };
}

test("loader output merged with TS map preserves all entries; JSON wins on clash", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ip-int-"));
  writeFileSync(path.join(dir, "new-page.json"), JSON.stringify(fixture("new-page-us", {
    title: "FROM JSON",
    heroTitle: "FROM JSON HERO",
  })));
  writeFileSync(path.join(dir, "clash-page.json"), JSON.stringify(fixture("clash-page-us", {
    title: "JSON WINS",
  })));

  const tsMap = {
    "existing-ts-only": { slug: "existing-ts-only", title: "TS ONLY" },
    "clash-page-us":    { slug: "clash-page-us",    title: "TS VERSION" },
  };
  const jsonMap = load(dir);
  const merged = { ...tsMap, ...jsonMap };

  assert.equal(merged["existing-ts-only"].title, "TS ONLY");
  assert.equal(merged["clash-page-us"].title, "JSON WINS");
  assert.equal(merged["new-page-us"].title, "FROM JSON");
  rmSync(dir, { recursive: true, force: true });
});

test("sitemap iteration (Object.keys) sees the merged map", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ip-int-"));
  writeFileSync(path.join(dir, "json-page.json"), JSON.stringify(fixture("json-page-sg", {
    country: "SG", currency: "SGD", locale: "en_SG", canonicalPath: "/json-page-sg",
  })));
  const tsMap = { "ts-page": { slug: "ts-page" } };
  const jsonMap = load(dir);
  const merged = { ...tsMap, ...jsonMap };
  const slugs = Object.keys(merged);
  assert.ok(slugs.includes("ts-page"));
  assert.ok(slugs.includes("json-page-sg"));
  rmSync(dir, { recursive: true, force: true });
});